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
      payload: { custom_proxies: [], custom_rules: [] },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'data', 'clash', 'config.json'))).toBe(true);
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
    const r = await app.inject({ method: 'GET', url: '/api/clash/subscribe' });
    expect(r.statusCode).toBe(400);
  });
});
