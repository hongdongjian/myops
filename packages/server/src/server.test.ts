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
    paths,
    runner: new Runner(),
    store,
    processMgr,
  };
}

describe('buildApp', () => {
  it('serves health', async () => {
    const app = await buildApp(makeDeps());
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.json()).toEqual({ ok: true });
  });

  it('retires Copilot endpoints while keeping Codex agents available', async () => {
    const app = await buildApp(makeDeps());
    try {
      for (const [method, url] of [
        ['GET', '/api/copilot/status'],
        ['POST', '/api/copilot/start'],
        ['GET', '/api/copilot/accounts'],
      ] as const) {
        const response = await app.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
      const agents = await app.inject({ method: 'GET', url: '/api/codex/agents' });
      expect(agents.statusCode).toBe(200);
      expect(agents.json().success).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('retires standalone MCP endpoints while keeping Claude and Codex MCP routes available', async () => {
    const app = await buildApp(makeDeps());
    try {
      for (const [method, url] of [
        ['GET', '/api/mcp/xiaohongshu/status'],
        ['POST', '/api/mcp/xiaohongshu/start'],
        ['POST', '/api/mcp/xiaohongshu/stop'],
        ['POST', '/api/mcp/xiaohongshu/restart'],
        ['POST', '/api/mcp/xiaohongshu/login'],
        ['GET', '/api/mcp/xiaohongshu/logs'],
        ['POST', '/api/mcp/xiaohongshu/logs/clear'],
        ['GET', '/api/mcp/xiaohongshu/autostart'],
        ['POST', '/api/mcp/xiaohongshu/autostart/set'],
        ['GET', '/api/mcp/xiaohongshu/config'],
        ['POST', '/api/mcp/xiaohongshu/config/save'],
        ['GET', '/api/mcp/xiaohongshu/releases'],
      ] as const) {
        const response = await app.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
      for (const tool of ['claude', 'codex']) {
        expect(app.hasRoute({ method: 'GET', url: `/api/${tool}/mcp/list` })).toBe(true);
        expect(app.hasRoute({ method: 'POST', url: `/api/${tool}/mcp/preset/install` })).toBe(true);
      }
    } finally {
      await app.close();
    }
  });
});
