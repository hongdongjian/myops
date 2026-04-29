import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { codexSettingsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxset-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxset-rt-home-'));
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  return {
    config: { port: 0, models: [] } as any,
    paths,
    runner: { run: async () => ({ stdout: '', stderr: '', code: 0 }) } as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(codexSettingsModule, { deps: makeDeps() });
  return app;
}

describe('codex settings routes', () => {
  it('GET /api/codex/settings returns defaults', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/codex/settings' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.baseUrl).toBe('http://localhost:4141');
  });

  it('POST /api/codex/settings/save saves successfully', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/codex/settings/save',
      payload: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().success).toBe(true);
  });

  it('GET /api/codex/settings/template returns missing template', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/codex/settings/template' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.exists).toBe(false);
  });
});
