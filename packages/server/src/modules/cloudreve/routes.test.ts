import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { cloudreveModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-rt-'));
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
  await app.register(cloudreveModule, { deps });
  return app;
}

describe('cloudreve routes', () => {
  it('GET /api/cloudreve/config returns defaults with masked password', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/cloudreve/config' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.password).toBe('');
  });

  it('POST /api/cloudreve/config/save trims slashes and persists masked-equiv password', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    let r = await app.inject({
      method: 'POST',
      url: '/api/cloudreve/config/save',
      payload: { baseUrl: 'https://x/', email: 'a@b', password: 'real' },
    });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'GET', url: '/api/cloudreve/config' });
    expect(r.json().data.baseUrl).toBe('https://x');
    expect(r.json().data.password).toBe('••••••••');
  });

  it('GET /api/cloudreve/tasks/list empty', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/cloudreve/tasks/list' });
    expect(r.json().data.tasks).toEqual([]);
  });
});
