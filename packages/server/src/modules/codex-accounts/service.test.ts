import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  buildStoredAccountId,
  findMatchingAccountIndex,
  generateOAuthToken,
  buildCodeChallenge,
  oauthRedirectUri,
  buildAuthorizeURL,
  parseJWTClaims,
  extractAccountIdFromAccessToken,
  extractOrganizationIdFromAccessToken,
  sortAccounts,
  normalizeString,
  firstNonEmpty,
  stringFromAny,
  boolFromAny,
  mapFromAny,
  normalizeRemark,
  clampPercentage,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_CALLBACK_PORT,
} from './service.js';
import type { CodexStoredAccount } from './schema.js';

function makeAccount(over: Partial<CodexStoredAccount>): CodexStoredAccount {
  return {
    id: 'codex_x',
    email: 'a@b.c',
    tokens: { idToken: 'i', accessToken: 'a' },
    createdAt: 0,
    lastUsedAt: 0,
    ...over,
  };
}

describe('codex-accounts helpers', () => {
  it('buildStoredAccountId is deterministic', () => {
    const a = buildStoredAccountId('USER@ex.com', 'acct1', 'org1');
    const b = buildStoredAccountId('user@ex.com', 'acct1', 'org1');
    expect(a).toBe(b);
    expect(a.startsWith('codex_')).toBe(true);
  });

  it('findMatchingAccountIndex matches on email + ids', () => {
    const accs = [makeAccount({ email: 'x@y.z', accountId: 'acc', organizationId: 'org' })];
    expect(findMatchingAccountIndex(accs, { email: 'x@y.z', accountId: 'acc', organizationId: 'org', userId: '', planType: '', authProvider: '' })).toBe(0);
    expect(findMatchingAccountIndex(accs, { email: 'x@y.z', accountId: 'other', organizationId: 'org', userId: '', planType: '', authProvider: '' })).toBe(-1);
  });

  it('findMatchingAccountIndex allows email fallback for unique', () => {
    const accs = [makeAccount({ email: 'x@y.z' })];
    expect(findMatchingAccountIndex(accs, { email: 'x@y.z', accountId: '', organizationId: '', userId: '', planType: '', authProvider: '' })).toBe(0);
  });

  it('generateOAuthToken returns base64url string', () => {
    const t = generateOAuthToken();
    expect(t.length).toBeGreaterThan(20);
    expect(t).not.toMatch(/[+/=]/);
  });

  it('buildCodeChallenge is sha256(verifier) base64url', () => {
    const v = 'verifier-1';
    const expected = crypto.createHash('sha256').update(v).digest('base64url');
    expect(buildCodeChallenge(v)).toBe(expected);
  });

  it('oauthRedirectUri uses port 1455', () => {
    expect(oauthRedirectUri()).toBe(`http://localhost:${CODEX_OAUTH_CALLBACK_PORT}/auth/callback`);
  });

  it('buildAuthorizeURL contains client_id, code_challenge, state', () => {
    const u = buildAuthorizeURL('http://x', 'cc', 'st');
    expect(u).toContain(`client_id=${CODEX_OAUTH_CLIENT_ID}`);
    expect(u).toContain('code_challenge=cc');
    expect(u).toContain('state=st');
    expect(u).toContain('code_challenge_method=S256');
  });

  it('parseJWTClaims decodes payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'me' })).toString('base64url');
    const tok = `h.${payload}.s`;
    expect(parseJWTClaims(tok)['sub']).toBe('me');
  });

  it('extractAccountIdFromAccessToken / extractOrganizationIdFromAccessToken', () => {
    const claims = {
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc1',
        organization_id: 'org1',
      },
    };
    const tok = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
    expect(extractAccountIdFromAccessToken(tok)).toBe('acc1');
    expect(extractOrganizationIdFromAccessToken(tok)).toBe('org1');
  });

  it('sortAccounts orders by lastUsedAt desc, email asc', () => {
    const accs = [
      makeAccount({ id: '1', email: 'b@x', lastUsedAt: 1 }),
      makeAccount({ id: '2', email: 'a@x', lastUsedAt: 2 }),
      makeAccount({ id: '3', email: 'a@y', lastUsedAt: 2 }),
    ];
    sortAccounts(accs);
    expect(accs[0]!.id).toBe('2');
    expect(accs[1]!.id).toBe('3');
    expect(accs[2]!.id).toBe('1');
  });

  it('primitive helpers', () => {
    expect(normalizeString(' x ')).toBe('x');
    expect(firstNonEmpty('', ' ', 'x')).toBe('x');
    expect(stringFromAny(1.7)).toBe('1');
    expect(boolFromAny('TRUE')).toBe(true);
    expect(mapFromAny([])).toEqual({});
    expect(normalizeRemark('a\r\nb')).toBe('a\nb');
    expect(clampPercentage(150)).toBe(100);
    expect(clampPercentage(-1)).toBe(0);
  });
});
