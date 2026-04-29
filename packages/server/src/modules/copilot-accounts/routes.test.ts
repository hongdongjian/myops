import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { copilotAccountsModule } from './routes.js';
import { CopilotAccountsService } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): Deps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-acc-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-acc-rt-home-'));
  const paths = createPaths(tmp);
  (paths as { homeDir: string }).homeDir = home;
  const copilotAccounts = new CopilotAccountsService(paths);
  return {
    config: { port: 0, models: [], copilot_proxy_url: '' } as never,
    paths,
    runner: {} as never,
    store: {} as never,
    processMgr: {} as never,
    copilotAccounts,
  };
}

async function buildTestApp(deps: Deps) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(copilotAccountsModule, { deps });
  return app;
}

describe('copilot-accounts routes', () => {
  it('GET /api/copilot/accounts returns empty list initially', async () => {
    const deps = makeDeps();
    const app = await buildTestApp(deps);
    const r = await app.inject({ method: 'GET', url: '/api/copilot/accounts' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.accounts).toEqual([]);
    expect(body.data.currentAccountId).toBe('');
    expect(body.data.hasToken).toBe(false);
  });

  it('POST /api/copilot/accounts/switch updates currentAccountId', async () => {
    const deps = makeDeps();
    await deps.copilotAccounts!.upsertStored('alice', 'ghu_alice');
    await deps.copilotAccounts!.upsertStored('bob', 'ghu_bob');
    const app = await buildTestApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/copilot/accounts/switch',
      payload: { accountId: 'alice' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('switched to alice');
    expect(body.data.currentAccountId).toBe('alice');
    expect(body.data.switchedAccount.login).toBe('alice');
    expect(body.data.restarted).toBe(false);
  });

  it('POST /api/copilot/accounts/delete removes the account', async () => {
    const deps = makeDeps();
    await deps.copilotAccounts!.upsertStored('todelete', 'ghu_x');
    const app = await buildTestApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/copilot/accounts/delete',
      payload: { accountId: 'todelete' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.success).toBe(true);
    expect(body.data.accounts).toEqual([]);
  });

  it('POST /api/copilot/accounts/remark/save trims remark', async () => {
    const deps = makeDeps();
    await deps.copilotAccounts!.upsertStored('user', 'ghu_u');
    const app = await buildTestApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/copilot/accounts/remark/save',
      payload: { accountId: 'user', remark: '  hi  ' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.remarkedAccount.remark).toBe('hi');
  });

  it('POST /api/copilot/accounts/switch returns 400 for unknown account', async () => {
    const deps = makeDeps();
    const app = await buildTestApp(deps);
    const r = await app.inject({
      method: 'POST',
      url: '/api/copilot/accounts/switch',
      payload: { accountId: 'ghost' },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/copilot account not found/);
  });

  it('GET /api/copilot/accounts/oauth/status returns missing for unknown loginId', async () => {
    const deps = makeDeps();
    const app = await buildTestApp(deps);
    const r = await app.inject({
      method: 'GET',
      url: '/api/copilot/accounts/oauth/status?loginId=unknown',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.status).toBe('missing');
  });
});
