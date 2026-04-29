import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { claudeSettingsModule } from './routes.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rt-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  return {
    config: { port: 0, models: [] } as any,
    paths,
    runner: {} as any,
    store: {} as any,
    processMgr: {} as any,
  };
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(claudeSettingsModule, { deps: makeDeps() });
  return app;
}

describe('claude settings routes', () => {
  it('GET /api/claude/settings returns defaults', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/settings' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.baseUrl).toBe('');
    expect(body.data.autoCompactEnabled).toBe(true);
  });

  it('GET /api/claude/onboarding returns skipped=false default', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/onboarding' });
    expect(r.json()).toEqual({ success: true, data: { skipped: false } });
  });

  it('POST /api/claude/onboarding/skip writes the flag', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'POST', url: '/api/claude/onboarding/skip' });
    expect(r.json().success).toBe(true);
  });

  it('POST /api/claude/powerline/save rejects invalid JSON', async () => {
    const app = await buildTestApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/claude/powerline/save',
      payload: { content: 'not json' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().success).toBe(false);
  });

  it('GET /api/claude/settings/template returns exists=false when missing', async () => {
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/claude/settings/template' });
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.exists).toBe(false);
  });
});
