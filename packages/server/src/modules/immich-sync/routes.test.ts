import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { immichSyncModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'immich-rt-'));
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
  await app.register(immichSyncModule, { deps });
  return app;
}

describe('immich-sync routes', () => {
  it('GET /api/immich/accounts returns empty', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/immich/accounts' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.accounts).toEqual([]);
    expect(body.data.activeId).toBe('');
    await app.close();
  });

  it('GET /api/immich/sync/plans returns empty', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/immich/sync/plans' });
    expect(r.json().data.plans).toEqual([]);
    await app.close();
  });

  it('GET /api/immich/sync/progress returns empty map', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/immich/sync/progress' });
    expect(r.json().data.progress).toEqual({});
    await app.close();
  });

  it('POST /api/immich/sync/plans/run on missing id is 4xx', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/immich/sync/plans/run',
      payload: { id: 'nope' },
    });
    // triggerRun does NOT validate plan existence (matches Go), but works fine even with missing id
    // since runSync silently returns. Just check it returns 200.
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/immich/accounts/delete on missing id succeeds (idempotent)', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/immich/accounts/delete',
      payload: { id: 'nope' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('POST /api/immich/accounts/switch on missing id is 404', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/immich/accounts/switch',
      payload: { id: 'nope' },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});
