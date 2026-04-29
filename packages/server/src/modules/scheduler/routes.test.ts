import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { schedulerModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-rt-'));
  const paths = createPaths(tmp);
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: {
        async run() {
          return { stdout: '', stderr: '', code: 0 };
        },
      } as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

async function buildApp(deps: Deps) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(schedulerModule, { deps });
  return app;
}

describe('scheduler routes', () => {
  it('GET list empty', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/scheduler/tasks/list' });
    const body = r.json();
    expect(r.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tasks).toEqual([]);
  });

  it('POST create + GET list shows task', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/scheduler/tasks/create',
      payload: { name: 'demo', prompt: 'hi', enabled: false },
    });
    expect(r.statusCode).toBe(200);
    const created = r.json();
    expect(created.data.id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/api/scheduler/tasks/list' });
    expect(list.json().data.tasks).toHaveLength(1);
  });

  it('POST run on missing task returns 404', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/scheduler/tasks/run',
      payload: { id: 'nope' },
    });
    expect(r.statusCode).toBe(404);
  });
});
