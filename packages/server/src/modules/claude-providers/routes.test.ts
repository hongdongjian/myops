import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeProvidersModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-rt-home-'));
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
  await app.register(claudeProvidersModule, { deps: makeDeps() });
  return app;
}

describe('claude providers routes', () => {
  it('GET /api/claude/providers returns empty initially', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/providers' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.providers).toEqual([]);
  });

  it('add then list then apply', async () => {
    const app = await buildTestApp();
    const add = await app.inject({
      method: 'POST',
      url: '/api/claude/providers/add',
      payload: { name: 'p1', baseUrl: 'http://x', token: 'tok', model: 'm', haikuModel: 'h' },
    });
    expect(add.statusCode).toBe(200);
    const apply = await app.inject({
      method: 'POST',
      url: '/api/claude/providers/apply',
      payload: { name: 'p1' },
    });
    expect(apply.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/claude/providers' });
    expect(list.json().data.activeProvider).toBe('p1');
  });

  it('delete unknown returns 404', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/providers/delete',
      payload: { name: 'nope' },
    });
    expect(r.statusCode).toBe(404);
  });
});
