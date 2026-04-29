import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CopilotAccountsService,
  buildView,
  maskToken,
  normalizeRemark,
  resolveCurrent,
  parseDeviceCodeLine,
  parseTokenLine,
  parseLoginLine,
  sortAccounts,
} from './service.js';
import { createPaths } from '../../paths.js';

function makeService(): { svc: CopilotAccountsService; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-acc-svc-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-acc-home-'));
  const paths = createPaths(tmp);
  // Override homeDir for isolated github_token writes.
  (paths as { homeDir: string }).homeDir = home;
  const svc = new CopilotAccountsService(paths);
  return { svc, tmp, home };
}

describe('copilot-accounts pure helpers', () => {
  it('maskToken hides middle for long tokens', () => {
    expect(maskToken('')).toBe('');
    expect(maskToken('short')).toBe('short');
    expect(maskToken('ghu_1234567890ABCDEF')).toBe('ghu_12...CDEF');
  });

  it('normalizeRemark normalizes line endings and trims', () => {
    expect(normalizeRemark('  primary\r\nfor work  ')).toBe('primary\nfor work');
    expect(normalizeRemark('a\rb')).toBe('a\nb');
  });

  it('parses CLI output lines', () => {
    const dev = parseDeviceCodeLine('Please enter the code "1519-10F5" in https://github.com/login/device');
    expect(dev).toEqual({ code: '1519-10F5', url: 'https://github.com/login/device' });
    expect(parseTokenLine('GitHub token: ghu_abc')).toBe('ghu_abc');
    expect(parseLoginLine('Logged in as nuonuohdj')).toBe('nuonuohdj');
  });

  it('sortAccounts orders by lastUsedAt desc, then login asc', () => {
    const list = [
      { id: 'b', login: 'b', githubToken: 't', createdAt: 0, lastUsedAt: 1 },
      { id: 'a', login: 'a', githubToken: 't', createdAt: 0, lastUsedAt: 1 },
      { id: 'c', login: 'c', githubToken: 't', createdAt: 0, lastUsedAt: 5 },
    ];
    sortAccounts(list);
    expect(list.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('resolveCurrent prefers currentAccountId then first', () => {
    const a1 = { id: 'a', login: 'a', githubToken: 't', createdAt: 0, lastUsedAt: 1 };
    const a2 = { id: 'b', login: 'b', githubToken: 't', createdAt: 0, lastUsedAt: 2 };
    expect(resolveCurrent({ version: '1.0', accounts: [], currentAccountId: '' }).id).toBe('');
    expect(resolveCurrent({ version: '1.0', accounts: [a1, a2], currentAccountId: 'b' }).id).toBe('b');
    expect(resolveCurrent({ version: '1.0', accounts: [a1, a2], currentAccountId: '' }).id).toBe('a');
  });

  it('buildView marks current and includes preview', () => {
    const v = buildView(
      { id: 'me', login: 'me', githubToken: 'ghu_1234567890ABCDEF', createdAt: 1, lastUsedAt: 2 },
      'me',
    );
    expect(v.current).toBe(true);
    expect(v.tokenPreview).toBe('ghu_12...CDEF');
  });
});

describe('CopilotAccountsService persistence', () => {
  it('upsertStored persists and prepareCurrent updates lastUsedAt', async () => {
    const { svc } = makeService();
    const a = await svc.upsertStored('user1', 'ghu_token1');
    expect(a.id).toBe('user1');
    const before = a.lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    const prepared = await svc.prepareCurrent();
    expect(prepared.id).toBe('user1');
    expect(prepared.lastUsedAt).toBeGreaterThanOrEqual(before);

    const store = await svc.loadStore();
    expect(store.currentAccountId).toBe('user1');
    expect(store.accounts).toHaveLength(1);
  });

  it('writeCurrentToken writes both github_token and current cache files', async () => {
    const { svc } = makeService();
    const account = await svc.upsertStored('user2', 'ghu_token2');
    await svc.writeCurrentToken(account);
    expect(fs.readFileSync(svc.githubTokenPath(), 'utf-8')).toBe('ghu_token2');
    expect(fs.readFileSync(svc.currentTokenCachePath(), 'utf-8')).toBe('ghu_token2');
  });

  it('prepareForSwitch sets currentAccountId and getAuthSnapshot reflects state', async () => {
    const { svc } = makeService();
    await svc.upsertStored('alice', 'ghu_a');
    await svc.upsertStored('bob', 'ghu_b');
    const switched = await svc.prepareForSwitch('alice');
    expect(switched.id).toBe('alice');
    const snap = await svc.getAuthSnapshot();
    expect(snap.accountCount).toBe(2);
    expect(snap.currentAccountId).toBe('alice');
    expect(snap.hasToken).toBe(true);
    expect(snap.currentAccount?.current).toBe(true);
  });

  it('saveAccountRemark trims and normalizes line endings', async () => {
    const { svc } = makeService();
    await svc.upsertStored('remark-user', 'ghu_remark');
    const updated = await svc.saveAccountRemark('remark-user', '  primary account \r\nfor work  ');
    expect(updated.remark).toBe('primary account \nfor work');
  });

  it('deleteStored removes account and clears current pointer', async () => {
    const { svc } = makeService();
    await svc.upsertStored('only-user', 'ghu_only');
    await svc.deleteStored('only-user');
    const store = await svc.loadStore();
    expect(store.accounts).toHaveLength(0);
    expect(store.currentAccountId ?? '').toBe('');
  });

  it('prepareCurrent throws when no accounts configured', async () => {
    const { svc } = makeService();
    await expect(svc.prepareCurrent()).rejects.toThrow(/please login first/);
  });

  it('buildAccountsPayload exposes paths and currentAccount', async () => {
    const { svc } = makeService();
    await svc.upsertStored('p-user', 'ghu_p');
    const payload = await svc.buildAccountsPayload();
    expect(payload.cachePath).toBe(svc.storePath());
    expect(payload.authPath).toBe(svc.githubTokenPath());
    expect(payload.currentCachePath).toBe(svc.currentTokenCachePath());
    expect(payload.currentAccount?.login).toBe('p-user');
    expect(payload.hasToken).toBe(true);
  });
});
