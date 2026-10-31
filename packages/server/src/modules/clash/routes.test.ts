import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { clashModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-rt-'));
  const paths = createPaths(tmp);
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

async function buildApp(deps: Deps) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(clashModule, { deps });
  return app;
}

describe('clash routes', () => {
  it('GET /api/clash/config returns defaults', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/clash/config' });
    const body = r.json();
    expect(r.statusCode).toBe(200);
    expect(body.data.custom_proxies).toEqual([]);
    expect(body.data.custom_rules).toEqual([]);
  });

  it('PUT /api/clash/config persists to data dir', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'PUT',
      url: '/api/clash/config',
      payload: {
        api_key: 'keep-key',
        clash_public_base_url: 'https://clash.example.com:20443',
        qx_public_base_url: 'https://qx.example.com:20443',
        custom_proxies: [], custom_rules: [],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'data', 'clash', 'config.json'))).toBe(true);
    const config = await app.inject('/api/clash/config');
    expect(config.json().data).toMatchObject({
      api_key: 'keep-key',
      clash_public_base_url: 'https://clash.example.com:20443',
      qx_public_base_url: 'https://qx.example.com:20443',
    });
  });

  it('PUT /api/clash/template saves and triggers manifest sync', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    const yaml = [
      'proxies: []',
      "proxy-groups:",
      "  - {name: 香港节点, type: select, proxies: [DIRECT]}",
      'rule-providers:',
      '  R: {type: http, behavior: classical, format: text, url: https://example.com/r.list, interval: 86400}',
      'rules:',
      '  - MATCH,香港节点',
    ].join('\n');
    const r = await app.inject({
      method: 'PUT',
      url: '/api/clash/template',
      payload: { content: yaml },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'conf', 'clash', 'template.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'clash', 'manifest.json'))).toBe(true);
  });

  it('rejects empty manual keys without changing the saved configuration', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    try {
      const config = { api_key: 'keep-key', clash_public_base_url: 'https://clash.example.com', custom_proxies: [], custom_rules: [] };
      expect((await app.inject({ method: 'PUT', url: '/api/clash/config', payload: config })).statusCode).toBe(200);
      for (const key of ['', '   ']) {
        const response = await app.inject({ method: 'PUT', url: '/api/clash/config', payload: { ...config, api_key: key } });
        expect(response.statusCode).toBe(400);
        expect((await app.inject('/api/clash/config')).json().data).toEqual(config);
      }
    } finally {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('GET /api/clash/groups extracts group names from template', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({
      method: 'PUT',
      url: '/api/clash/template',
      payload: {
        content: [
          'proxy-groups:',
          "  - {name: A, type: select, proxies: [DIRECT]}",
          "  - {name: B, type: select, proxies: [DIRECT]}",
        ].join('\n'),
      },
    });
    const r = await app.inject({ method: 'GET', url: '/api/clash/groups' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.groups).toEqual(['A', 'B']);
  });

  it('GET /api/clash/subscribe rejects when template empty', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    await app.inject({ method: 'PUT', url: '/api/clash/config', payload: { api_key: 'test-key' } });
    const r = await app.inject({ method: 'GET', url: '/api/clash/subscribe?api-key=test-key' });
    expect(r.statusCode).toBe(400);
  });

  it('rejects subscriptions and static resources until a key is configured', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    try {
      for (const url of [
        '/api/clash/subscribe', '/api/qx/subscribe',
        '/api/clash/static/list/rules.list', '/api/clash/static/icon/icon.png',
        '/api/static/icon/icon.png', '/api/qx/static/rules/' + '0'.repeat(24),
      ]) {
        expect((await app.inject(url)).statusCode).toBe(401);
        expect((await app.inject(url + '?api-key=arbitrary')).statusCode).toBe(401);
      }
    } finally {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
