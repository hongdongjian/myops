import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeInstructionsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
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
    runner: {} as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(claudeInstructionsModule, { deps: makeDeps() });
  return app;
}

describe('claude instructions routes', () => {
  it('GET /api/claude/instructions returns exists=false initially', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/instructions' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.exists).toBe(false);
  });

  it('save then sync then sync-status', async () => {
    const app = await buildTestApp();
    const save = await app.inject({
      method: 'POST',
      url: '/api/claude/instructions/save',
      payload: { content: '# X' },
    });
    expect(save.statusCode).toBe(200);

    const sync = await app.inject({ method: 'POST', url: '/api/claude/instructions/sync' });
    expect(sync.statusCode).toBe(200);

    const status = await app.inject({ method: 'GET', url: '/api/claude/instructions/sync-status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.synced).toBe(true);
  });

  it('sync without local file returns 400', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'POST', url: '/api/claude/instructions/sync' });
    expect(r.statusCode).toBe(400);
    expect(r.json().success).toBe(false);
  });
});
