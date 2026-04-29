import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { codexAccountsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxacc-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxacc-rt-home-'));
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
  await app.register(codexAccountsModule, { deps: makeDeps() });
  return app;
}

describe('codex accounts routes', () => {
  it('GET /api/codex/accounts returns empty list when no store', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/codex/accounts' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.accounts)).toBe(true);
    expect(body.data.accounts.length).toBe(0);
  });

  it('POST /api/codex/accounts/oauth/cancel succeeds with empty body', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/codex/accounts/oauth/cancel',
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().success).toBe(true);
  });

  it('POST /api/codex/accounts/switch requires accountId', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/codex/accounts/switch',
      payload: { accountId: '' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('GET /api/codex/accounts/oauth/status missing loginId', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/codex/accounts/oauth/status' });
    expect(r.statusCode).toBe(400);
  });
});
