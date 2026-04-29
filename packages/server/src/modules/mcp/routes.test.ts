import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { mcpModule } from './routes.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-rt-'));
  const paths = createPaths(tmp);
  const runner = {
    async run() { return { stdout: '', stderr: '', code: 0 }; },
  };
  const processMgr = {
    async spawn() { return { pid: 1 }; },
    status() { return { running: false }; },
    async stop() {},
  };
  return {
    config: { port: 0, models: [] } as any,
    paths,
    runner: runner as any,
    store: {} as any,
    processMgr: processMgr as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(mcpModule, { deps: makeDeps() });
  return app;
}

describe('mcp routes', () => {
  it('GET /api/mcp/xiaohongshu/status returns envelope', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/mcp/xiaohongshu/status' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.process.name).toBe('xiaohongshu-mcp');
    expect(body.data.health.state).toBe('ERROR');
  });

  it('GET /api/mcp/xiaohongshu/logs returns empty when missing', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/mcp/xiaohongshu/logs?lines=50' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.lines).toBe(50);
    expect(body.data.content).toBe('');
    expect(body.message).toBe('log file does not exist yet');
  });

  it('GET /api/mcp/xiaohongshu/autostart returns enabled=false default', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/mcp/xiaohongshu/autostart' });
    expect(r.json()).toEqual({ success: true, data: { enabled: false } });
  });

  it('POST /api/mcp/xiaohongshu/start fails when binary missing', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'POST', url: '/api/mcp/xiaohongshu/start' });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/binary not found/);
  });
});
