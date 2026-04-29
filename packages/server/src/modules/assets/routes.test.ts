import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { assetsModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-rt-'));
  const paths = createPaths(tmp);
  (paths as any).claudePath = (...p: string[]) => path.join(tmp, '.claude', ...p);
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
  await app.register(assetsModule, { deps });
  return app;
}

describe('assets routes', () => {
  it('GET /api/assets/list returns envelope', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/assets/list?category=rules' });
    const body = r.json();
    expect(r.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.category).toBe('rules');
  });

  it('GET /api/assets/list rejects bad category', async () => {
    const { deps } = makeDeps();
    const app = await buildApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/assets/list?category=invalid' });
    expect(r.statusCode).toBe(400);
  });

  it('POST /api/assets/sync copies content', async () => {
    const { deps, tmp } = makeDeps();
    const homeRules = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(homeRules, { recursive: true });
    fs.writeFileSync(path.join(homeRules, 'r1.md'), 'hello');
    const app = await buildApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/assets/sync',
      payload: { category: 'rules' },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'managed', 'rules', 'r1.md'))).toBe(true);
  });
});
