import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { codexVersionModule } from './routes.js';
import { clearCodexVersionCache } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(stdout = 'codex-cli 0.111.0\n'): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxv-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxv-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  const runner = {
    async run() {
      return { stdout, stderr: '', code: 0 };
    },
  };
  return {
    config: { port: 0, models: [] } as any,
    paths,
    runner: runner as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

describe('codex version routes', () => {
  it('GET /api/codex/version returns status', async () => {
    clearCodexVersionCache();
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(codexVersionModule, { deps: makeDeps() });
    const r = await app.inject({ method: 'GET', url: '/api/codex/version' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.installed).toBe(true);
  });

  it('POST /api/codex/upgrade reports installed-state message', async () => {
    clearCodexVersionCache();
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(codexVersionModule, { deps: makeDeps() });
    const r = await app.inject({ method: 'POST', url: '/api/codex/upgrade' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(typeof body.message).toBe('string');
  });
});
