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
    expect(body.data.subscribe_url).toBe('');
  });

  it('PUT /api/clash/config/save persists', async () => {
    const { deps, tmp } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'PUT',
      url: '/api/clash/config/save',
      payload: { subscribe_url: 'https://x', groups: [], rule_sets: [] },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'conf', 'clash', 'config.json'))).toBe(true);
  });

  it('GET /api/clash/upstream rejects when not configured', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/clash/upstream' });
    expect(r.statusCode).toBe(400);
  });
});
