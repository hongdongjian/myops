import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from './server.js';
import { createPaths } from './paths.js';
import { Runner } from './core/system/runner.js';
import { StateStore } from './core/process/state.js';
import { ProcessManager } from './core/process/manager.js';

function makeDeps() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const paths = createPaths(tmp);
  const store = new StateStore(paths.dataPath('state.json'));
  const processMgr = new ProcessManager(store, paths.dataPath('logs'));
  return {
    config: Object.freeze({ port: 0, models: ['m1', 'm2'] }) as any,
    paths,
    runner: new Runner(),
    store,
    processMgr,
  };
}

describe('buildApp', () => {
  it('serves health and models', async () => {
    const app = await buildApp(makeDeps());
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.json()).toEqual({ ok: true });
    const m = await app.inject({ method: 'GET', url: '/api/server/models' });
    expect(m.json()).toEqual({ models: ['m1', 'm2'] });
  });
});
