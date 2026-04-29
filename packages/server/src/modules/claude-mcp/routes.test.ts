import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeMCPModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcp-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcp-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'conf', 'claude'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'conf', 'claude', 'mcp-presets.json'),
    JSON.stringify([
      { name: 'foo', description: 'F', install: { transport: 'http', target: 'http://x' } },
    ]),
  );
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  const runner = {
    async run() { return { stdout: '', stderr: '', code: 0 }; },
  };
  return {
    config: { port: 0, models: [] } as any,
    paths,
    runner: runner as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(claudeMCPModule, { deps: makeDeps() });
  return app;
}

describe('claude mcp routes', () => {
  it('GET /api/claude/mcp/list returns supported list', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/mcp/list' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.supported[0].name).toBe('foo');
  });

  it('POST /api/claude/mcp/add validates required fields', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/mcp/add',
      payload: { name: '', transport: 'http', target: '' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().success).toBe(false);
  });

  it('POST /api/claude/mcp/preset/install rejects unknown preset', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/mcp/preset/install',
      payload: { name: 'unknown', scope: 'project' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/unsupported preset mcp/);
  });
});
