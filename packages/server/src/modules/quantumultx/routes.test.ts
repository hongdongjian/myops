import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { quantumultxModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qx-rt-'));
  const paths = createPaths(tmp);
  return {
    deps: {
      paths,
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    } as Deps,
    tmp,
  };
}

async function buildApp(deps: Deps) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(quantumultxModule, { deps });
  return app;
}

const SAMPLE_CONF = `[general]
profile_img_url = https://cdn.example.com/icons/profile.png

[task_local]
event-interaction https://example.com/ui.js, tag=UI, img-url=https://cdn.example.com/icons/ip.png

[rewrite_remote]
https://example.com/rewrite.conf, tag=R1, img-url=https://cdn.example.com/icons/r1.png

[http_backend]
https://example.com/backend.js, host=boxjs.com

[filter_remote]
https://example.com/rules/apple.list, tag=Apple, enabled=true

[server_remote]
https://example.com/nodes/sub.txt, tag=Nodes, update-interval=86400, opt-parser=false, enabled=true
`;

describe('quantumultx routes', () => {
  const origFetch = globalThis.fetch;
  const proxyEnvKeys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  const origProxyEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of proxyEnvKeys) {
      origProxyEnv[k] = process.env[k];
      delete process.env[k];
    }
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(`content of ${url}`).buffer,
      } as any;
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    for (const k of proxyEnvKeys) {
      if (origProxyEnv[k] === undefined) delete process.env[k];
      else process.env[k] = origProxyEnv[k];
    }
  });

  it('GET /api/qx/conf returns empty initially', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/qx/conf' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.content).toBe('');
  });

  it('PUT /api/qx/conf saves and syncs manifest (downloads run in background)', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'PUT',
      url: '/api/qx/conf',
      payload: { content: SAMPLE_CONF },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'conf', 'quantumultx', 'QuantumultX.conf'))).toBe(true);
    const m = r.json().data;
    expect(m.task_local.length).toBe(1);
    expect(m.rewrite_remote.length).toBe(1);
    expect(m.http_backend.length).toBe(1);
    expect(m.filter_remote.length).toBe(1);
    expect(m.server_remote.length).toBe(1);
    expect(m.images.length).toBe(3);
  });

  it('POST /api/qx/resources/refresh downloads files', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    const r = await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: {} });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'rewrite_remote', 'rewrite.conf'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'task_local', 'ui.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'http_backend', 'backend.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'images', 'r1.png'))).toBe(true);
  });

  it('cleanup removes orphan files on full refresh', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: {} });
    // Drop an orphan file
    const orphan = path.join(tmp, 'data', 'quantumultx', 'rewrite_remote', 'orphan.conf');
    fs.writeFileSync(orphan, 'x');
    await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: { group: 'rewrite_remote' } });
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('manual add persists across refresh', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    await app.inject({
      method: 'POST',
      url: '/api/qx/resources/add',
      payload: { group: 'task_local', url: 'https://manual.example.com/hand.js' },
    });
    // Manual entry registered but not yet downloaded
    const m0 = (await app.inject({ method: 'GET', url: '/api/qx/resources' })).json().data;
    expect(m0.task_local.some((e: any) => e.source === 'manual' && e.url.includes('hand.js'))).toBe(true);
    // After refresh of just that URL, file should be downloaded and manual entry preserved
    await app.inject({
      method: 'POST',
      url: '/api/qx/resources/refresh',
      payload: { group: 'task_local', url: 'https://manual.example.com/hand.js' },
    });
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'task_local', 'hand.js'))).toBe(true);
    await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: {} });
    const m = (await app.inject({ method: 'GET', url: '/api/qx/resources' })).json().data;
    expect(m.task_local.some((e: any) => e.source === 'manual' && e.url.includes('hand.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'quantumultx', 'task_local', 'hand.js'))).toBe(true);
  });

  it('GET /api/qx/static serves downloaded file', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: {} });
    const r = await app.inject({ method: 'GET', url: '/api/qx/static/rewrite_remote/rewrite.conf' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('content of https://example.com/rewrite.conf');
  });

  it('subscribe replaces URLs with local addresses', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    await app.inject({ method: 'POST', url: '/api/qx/resources/refresh', payload: {} });
    const r = await app.inject({
      method: 'GET',
      url: '/api/qx/subscribe',
      headers: { host: '127.0.0.1:3333' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('http://127.0.0.1:3333/api/qx/static/rewrite_remote/rewrite.conf');
    expect(r.body).toContain('http://127.0.0.1:3333/api/qx/static/filter_remote/apple.list');
    expect(r.body).toContain('http://127.0.0.1:3333/api/qx/static/server_remote/sub.txt');
    expect(r.body).toContain('http://127.0.0.1:3333/api/qx/static/images/r1.png');
    expect(r.body).toContain('http://127.0.0.1:3333/api/qx/static/images/profile.png');
    expect(r.body).not.toContain('https://example.com/rewrite.conf');
    expect(r.body).not.toContain('https://example.com/rules/apple.list');
    expect(r.body).not.toContain('https://example.com/nodes/sub.txt');
    expect(r.body).not.toContain('https://cdn.example.com/icons/profile.png');
  });

  it('subscribe rejects bad api-key', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/qx/conf', payload: { content: SAMPLE_CONF } });
    await app.inject({ method: 'PUT', url: '/api/qx/config', payload: { api_key: 'secret' } });
    const r = await app.inject({ method: 'GET', url: '/api/qx/subscribe' });
    expect(r.statusCode).toBe(401);
    const r2 = await app.inject({ method: 'GET', url: '/api/qx/subscribe?api-key=wrong' });
    expect(r2.statusCode).toBe(401);
    const r3 = await app.inject({
      method: 'GET',
      url: '/api/qx/subscribe?api-key=secret',
      headers: { host: '127.0.0.1:3333' },
    });
    expect(r3.statusCode).toBe(200);
  });
});
