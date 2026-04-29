import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { codexMCPModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxmcp-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxmcp-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'conf', 'codex'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'conf', 'codex', 'mcp-presets.json'),
    JSON.stringify([
      { name: 'foo', description: 'F', install: { url: 'https://x.example/mcp' } },
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
    async run(_cmd: string, args: string[]) {
      if (args[0] === 'mcp' && args[1] === 'list') {
        return { stdout: '[]', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
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

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(codexMCPModule, { deps: makeDeps() });
  return app;
}

describe('codex mcp routes', () => {
  it('GET /api/codex/mcp/list returns supported list', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/codex/mcp/list' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.supported[0].name).toBe('foo');
  });

  it('POST /api/codex/mcp/preset/install rejects unknown preset', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/codex/mcp/preset/install',
      payload: { name: 'unknown' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/unsupported preset mcp/);
  });

  it('POST /api/codex/mcp/preset/remove returns success on ok', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/codex/mcp/preset/remove',
      payload: { name: 'foo' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().success).toBe(true);
  });
});
