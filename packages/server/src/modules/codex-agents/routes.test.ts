import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { codexAgentsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-rt-home-'));
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

describe('codex agents routes', () => {
  it('save then get round trips', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(codexAgentsModule, { deps: makeDeps() });

    const save = await app.inject({
      method: 'POST',
      url: '/api/codex/agents/save',
      payload: { content: 'hello world' },
    });
    expect(save.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/codex/agents' });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.content).toBe('hello world');
  });

  it('sync requires saved file', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(codexAgentsModule, { deps: makeDeps() });
    const r = await app.inject({ method: 'POST', url: '/api/codex/agents/sync' });
    expect(r.statusCode).toBe(400);
  });
});
