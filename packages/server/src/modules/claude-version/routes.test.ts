import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeVersionModule } from './routes.js';
import { clearClaudeVersionCache, ClaudeVersionService } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  // runner returning predictable outputs
  const runner = {
    async run(_cmd: string, _args: string[]) {
      return { stdout: '2.1.63 (Claude Code)\n', stderr: '', code: 0 };
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

async function buildTestApp(deps?: Deps) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(claudeVersionModule, { deps: deps ?? makeDeps() });
  return app;
}

describe('claude version routes', () => {
  it('GET /api/claude/version returns status', async () => {
    clearClaudeVersionCache();
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/version' });
    expect(r.statusCode).toBe(200);
    expect(r.json().success).toBe(true);
  });

  it('POST /api/claude/upgrade returns 409 when an operation is in progress', async () => {
    clearClaudeVersionCache();
    const deps = makeDeps();
    // Pre-occupy operation by creating a service and beginning a manual op.
    // Routes register their own service instance, so we re-bind via a wrapper.
    // Simulate concurrent op by registering a custom service-aware module.
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    const svc = new ClaudeVersionService(deps);
    svc.begin('upgrade');
    app.post('/api/claude/upgrade', async () => {
      const result = await svc.upgrade();
      return result;
    });
    const r = await app.inject({ method: 'POST', url: '/api/claude/upgrade' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain('already in progress');
    svc.finish();
  });
});
