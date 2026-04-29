import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { copilotModule } from './routes.js';
import { clearVersionCache } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-rt-'));
  const paths = createPaths(tmp);
  const runner = {
    async run(_cmd: string, args: string[] = []) {
      if (args[0] === 'list') {
        return { stdout: '└── @jeffreycao/copilot-api@1.0.0\n', stderr: '', code: 0 };
      }
      if (args[0] === 'view') {
        return { stdout: 'latest: 1.0.0\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const processMgr = {
    async spawn() { return { pid: 1 }; },
    status() { return { running: false }; },
    async stop() {},
  };
  return {
    config: { port: 0, models: [], copilot_proxy_url: 'http://127.0.0.1:7897' } as any,
    paths,
    runner: runner as any,
    store: {} as any,
    processMgr: processMgr as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(copilotModule, { deps: makeDeps() });
  return app;
}

describe('copilot routes', () => {
  beforeEach(() => clearVersionCache());

  it('GET /api/copilot/status returns envelope with process+health+version+sourceUrl', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/copilot/status' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.process.name).toBe('copilot-api');
    expect(body.data.process.running).toBe(false);
    expect(body.data.health).toEqual({ healthy: false, state: 'ERROR' });
    expect(body.data.sourceUrl).toContain('github.com');
    expect(body.data.auth).toBeNull();
  });

  it('GET /api/copilot/source returns the source url', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/copilot/source' });
    expect(r.json()).toEqual({
      success: true,
      data: { url: 'https://github.com/caozhiyuan/copilot-api/tree/all' },
    });
  });

  it('GET /api/copilot/proxy returns enabled+proxyURL', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/copilot/proxy' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.proxyURL).toBe('http://127.0.0.1:7897');
    expect(body.data.enabled).toBe(false);
  });

  it('POST /api/copilot/config/save rejects invalid JSON via AppError', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/copilot/config/save',
      payload: { content: 'not json' },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/valid JSON/);
  });

  it('GET /api/copilot/logs returns empty when missing', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/copilot/logs?lines=50' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.lines).toBe(50);
    expect(body.data.content).toBe('');
    expect(body.message).toBe('log file does not exist yet');
  });
});
