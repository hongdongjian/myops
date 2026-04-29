import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudePluginModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpl-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cpl-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  // runner returning empty plugin/marketplace lists for /api/claude/plugins
  const runner = {
    async run(_cmd: string, args: string[]) {
      if (args[0] === 'plugin' && args[1] === 'list') return { stdout: '[]', stderr: '', code: 0 };
      if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
        return { stdout: '[]', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: 'unexpected', code: 1 };
    },
  };
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: runner as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  const { deps } = makeDeps();
  await app.register(claudePluginModule, { deps });
  return app;
}

describe('claude plugin routes', () => {
  it('GET /api/claude/plugins returns empty data', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/plugins' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.supported).toEqual([]);
    expect(body.data.installed).toEqual([]);
    expect(body.data.others).toEqual([]);
  });

  it('install with empty package returns 400', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/plugins/install',
      payload: { package: '' },
    });
    expect(r.statusCode).toBe(400);
  });
});
