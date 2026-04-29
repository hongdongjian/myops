import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { AppError } from '../../core/errors.js';
import type { Deps, CodexAccountsHook } from '../../deps.js';
import {
  findTomlStringValue,
  hasSectionInToml,
} from '../../core/toml/index.js';
import type {
  CodexAccountIdentity,
  CodexAccountStoreFile,
  CodexAccountView,
  CodexOAuthLoginState,
  CodexQuotaError,
  CodexStoredAccount,
  CodexStoredQuota,
  CodexStoredTokens,
} from './schema.js';

// ── constants ─────────────────────────────────────────────────────────────

export const CODEX_ACCOUNTS_STORE_VERSION = '1.0';
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_OAUTH_AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
export const CODEX_OAUTH_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
export const CODEX_ACCOUNTS_CHECK_URL = 'https://chatgpt.com/backend-api/wham/accounts/check';
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_OAUTH_SCOPES = 'openid profile email offline_access';
export const CODEX_OAUTH_ORIGINATOR = 'codex_vscode';
export const CODEX_OAUTH_CALLBACK_PORT = 1455;
export const CODEX_OAUTH_CALLBACK_PATH = '/auth/callback';
export const CODEX_OAUTH_CANCEL_PATH = '/cancel';
export const CODEX_OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
export const CODEX_OAUTH_RETENTION_MS = 15 * 60 * 1000;
export const CODEX_TOKEN_REFRESH_LEEWAY_MS = 60 * 1000;
export const CODEX_QUOTA_STALE_INTERVAL_MS = 10 * 60 * 1000;

// ── primitive helpers ─────────────────────────────────────────────────────

export function normalizeString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    const t = (v ?? '').trim();
    if (t !== '') return t;
  }
  return '';
}

export function stringFromAny(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(Math.trunc(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export function boolFromAny(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    return n === 'true' || n === '1';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

export function mapFromAny(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function sliceFromAny(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeRemark(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function clampPercentage(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

// ── JWT ────────────────────────────────────────────────────────────────────

export function parseJWTClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('invalid jwt token');
  const payload = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  return JSON.parse(payload) as Record<string, unknown>;
}

export function extractAccountIdFromAccessToken(accessToken: string): string {
  try {
    const claims = parseJWTClaims(accessToken);
    const auth = mapFromAny(claims['https://api.openai.com/auth']);
    return firstNonEmpty(stringFromAny(auth['chatgpt_account_id']), stringFromAny(auth['account_id']));
  } catch {
    return '';
  }
}

export function extractOrganizationIdFromAccessToken(accessToken: string): string {
  try {
    const claims = parseJWTClaims(accessToken);
    const auth = mapFromAny(claims['https://api.openai.com/auth']);
    return firstNonEmpty(
      stringFromAny(auth['organization_id']),
      stringFromAny(auth['chatgpt_organization_id']),
      stringFromAny(auth['chatgpt_org_id']),
      stringFromAny(auth['org_id']),
    );
  } catch {
    return '';
  }
}

export interface CodexWorkspaceInfo {
  id: string;
  title: string;
  role: string;
  isDefault: boolean;
}

export function extractWorkspaceInfo(tokens: CodexStoredTokens, organizationId: string | undefined): CodexWorkspaceInfo {
  const empty: CodexWorkspaceInfo = { id: '', title: '', role: '', isDefault: false };
  let claims: Record<string, unknown>;
  try {
    claims = parseJWTClaims(tokens.idToken);
  } catch {
    return empty;
  }
  const auth = mapFromAny(claims['https://api.openai.com/auth']);
  const orgs = sliceFromAny(auth['organizations']);
  if (orgs.length === 0) return empty;
  const list: CodexWorkspaceInfo[] = [];
  for (const item of orgs) {
    const r = mapFromAny(item);
    if (Object.keys(r).length === 0) continue;
    const ws: CodexWorkspaceInfo = {
      id: firstNonEmpty(stringFromAny(r['id']), stringFromAny(r['organization_id']), stringFromAny(r['workspace_id'])),
      title: firstNonEmpty(
        stringFromAny(r['title']),
        stringFromAny(r['name']),
        stringFromAny(r['display_name']),
        stringFromAny(r['workspace_name']),
        stringFromAny(r['organization_name']),
      ),
      role: stringFromAny(r['role']),
      isDefault: boolFromAny(r['is_default']),
    };
    if (ws.id === '' && ws.title === '') continue;
    list.push(ws);
  }
  if (list.length === 0) return empty;
  const orgId = (organizationId ?? '').trim();
  if (orgId !== '') {
    for (const ws of list) {
      if (ws.id.trim() === orgId) return ws;
    }
  }
  for (const ws of list) {
    if (ws.isDefault) return ws;
  }
  return list[0]!;
}

export function extractIdentity(
  tokens: CodexStoredTokens,
  accountIdHint: string,
  organizationIdHint: string,
): CodexAccountIdentity {
  const claims = parseJWTClaims(tokens.idToken);
  const email = stringFromAny(claims['email']);
  if (email === '') throw new Error('id token missing email');
  const auth = mapFromAny(claims['https://api.openai.com/auth']);
  return {
    email,
    userId: firstNonEmpty(
      stringFromAny(auth['chatgpt_user_id']),
      stringFromAny(auth['user_id']),
      stringFromAny(claims['sub']),
    ),
    planType: firstNonEmpty(
      stringFromAny(auth['chatgpt_plan_type']),
      stringFromAny(auth['plan_type']),
    ),
    accountId: firstNonEmpty(
      extractAccountIdFromAccessToken(tokens.accessToken),
      stringFromAny(auth['account_id']),
      stringFromAny(auth['chatgpt_account_id']),
      accountIdHint,
    ),
    organizationId: firstNonEmpty(
      extractOrganizationIdFromAccessToken(tokens.accessToken),
      stringFromAny(auth['organization_id']),
      stringFromAny(auth['chatgpt_organization_id']),
      organizationIdHint,
    ),
    authProvider: stringFromAny(claims['auth_provider']),
  };
}

export function buildStoredAccountId(email: string, accountId: string, organizationId: string): string {
  const sum = crypto.createHash('md5').update(`${email.trim().toLowerCase()}|${accountId}|${organizationId}`).digest('hex');
  return `codex_${sum}`;
}

export function findMatchingAccountIndex(accounts: CodexStoredAccount[], identity: CodexAccountIdentity): number {
  let firstEmail = -1;
  let count = 0;
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    if (a.email.toLowerCase() !== identity.email.toLowerCase()) continue;
    count++;
    if (firstEmail < 0) firstEmail = i;
    if (
      (a.accountId ?? '').trim() === identity.accountId.trim() &&
      (a.organizationId ?? '').trim() === identity.organizationId.trim()
    ) {
      return i;
    }
  }
  if (identity.accountId === '' && identity.organizationId === '' && count === 1) return firstEmail;
  return -1;
}

// ── token expiry / refresh ─────────────────────────────────────────────────

export function isTokenExpired(accessToken: string): boolean {
  try {
    const claims = parseJWTClaims(accessToken);
    const exp = claims['exp'];
    if (typeof exp !== 'number') return true;
    return exp * 1000 <= Date.now() + CODEX_TOKEN_REFRESH_LEEWAY_MS;
  } catch {
    return true;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<CodexStoredTokens> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_OAUTH_CLIENT_ID,
  });
  const res = await fetch(CODEX_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`refresh token failed: ${res.status} ${res.statusText}`);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`parse refresh token response: ${(err as Error).message}`);
  }
  const tokens: CodexStoredTokens = {
    idToken: stringFromAny(payload['id_token']),
    accessToken: stringFromAny(payload['access_token']),
    refreshToken: firstNonEmpty(stringFromAny(payload['refresh_token']), refreshToken),
  };
  if (tokens.idToken === '' || tokens.accessToken === '') throw new Error('auth.json missing id_token or access_token');
  return tokens;
}

async function refreshStoredAccountTokens(account: CodexStoredAccount): Promise<void> {
  if (!isTokenExpired(account.tokens.accessToken)) return;
  const rt = (account.tokens.refreshToken ?? '').trim();
  if (rt === '') throw new Error('access token expired and refresh token missing');
  const refreshed = await refreshAccessToken(rt);
  account.tokens = refreshed;
  try {
    const id = extractIdentity(account.tokens, account.accountId ?? '', account.organizationId ?? '');
    account.email = id.email;
    account.userId = id.userId;
    account.planType = id.planType;
    account.accountId = id.accountId;
    account.organizationId = id.organizationId;
    account.authProvider = id.authProvider;
  } catch {
    // tolerate
  }
}

// ── store CRUD ─────────────────────────────────────────────────────────────

export function sortAccounts(accounts: CodexStoredAccount[]): void {
  accounts.sort((a, b) => {
    if (a.lastUsedAt === b.lastUsedAt) return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
    return b.lastUsedAt - a.lastUsedAt;
  });
}

export async function writeBytesAtomic(p: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, p);
}

export function buildAccountView(account: CodexStoredAccount, currentAccountId: string): CodexAccountView {
  const ws = extractWorkspaceInfo(account.tokens, account.organizationId);
  return {
    id: account.id,
    email: account.email,
    userId: account.userId,
    remark: account.remark,
    planType: account.planType,
    accountId: account.accountId,
    organizationId: account.organizationId,
    accountName: account.accountName,
    accountType: account.accountType,
    authProvider: account.authProvider,
    workspaceTitle: firstNonEmpty(account.accountName ?? '', ws.title),
    workspaceRole: ws.role,
    quota: account.quota,
    quotaError: account.quotaError,
    quotaUpdatedAt: account.quotaUpdatedAt,
    createdAt: account.createdAt,
    lastUsedAt: account.lastUsedAt,
    current: account.id === currentAccountId,
    hasRefreshToken: (account.tokens.refreshToken ?? '').trim() !== '',
  };
}

// ── service ────────────────────────────────────────────────────────────────

export class CodexAccountsService implements CodexAccountsHook {
  private storeMu: Promise<void> = Promise.resolve();
  private readonly oauthState: Map<string, CodexOAuthLoginState> = new Map();
  private oauthServer: http.Server | null = null;

  constructor(private readonly deps: Deps) {}

  // paths
  storePath(): string {
    return this.deps.paths.dataPath('codex', 'accounts.json');
  }
  currentAuthCachePath(): string {
    return this.deps.paths.dataPath('codex', 'current-auth.json');
  }
  authPath(): string {
    return this.deps.paths.codexPath('auth.json');
  }
  configPath(): string {
    return this.deps.paths.codexPath('config.toml');
  }

  // ── store ────────────────────────────────────────────────────────────────

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.storeMu;
    let release!: () => void;
    this.storeMu = new Promise<void>((res) => { release = res; });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  async loadStore(): Promise<CodexAccountStoreFile> {
    return this.lock(() => this.loadStoreUnlocked());
  }

  private async loadStoreUnlocked(): Promise<CodexAccountStoreFile> {
    let data: string;
    try {
      data = await fs.readFile(this.storePath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: CODEX_ACCOUNTS_STORE_VERSION, accounts: [] };
      }
      throw new AppError('CODEX_STORE_READ_FAILED', `read codex account store: ${(err as Error).message}`, 500);
    }
    let parsed: CodexAccountStoreFile;
    try {
      parsed = JSON.parse(data) as CodexAccountStoreFile;
    } catch (err) {
      throw new AppError('CODEX_STORE_PARSE_FAILED', `parse codex account store: ${(err as Error).message}`, 500);
    }
    if (!parsed.version) parsed.version = CODEX_ACCOUNTS_STORE_VERSION;
    if (!Array.isArray(parsed.accounts)) parsed.accounts = [];
    sortAccounts(parsed.accounts);
    return parsed;
  }

  async saveStore(store: CodexAccountStoreFile): Promise<void> {
    return this.lock(() => this.saveStoreUnlocked(store));
  }

  private async saveStoreUnlocked(store: CodexAccountStoreFile): Promise<void> {
    store.version = CODEX_ACCOUNTS_STORE_VERSION;
    sortAccounts(store.accounts);
    const data = JSON.stringify(store, null, 2);
    await writeBytesAtomic(this.storePath(), data);
  }

  // ── upsert ───────────────────────────────────────────────────────────────

  upsertAccount(
    store: CodexAccountStoreFile,
    tokens: CodexStoredTokens,
    accountIdHint: string,
    organizationIdHint: string,
  ): CodexStoredAccount {
    const identity = extractIdentity(tokens, accountIdHint, organizationIdHint);
    const now = Date.now();
    const idx = findMatchingAccountIndex(store.accounts, identity);
    if (idx >= 0) {
      const a = store.accounts[idx]!;
      a.email = identity.email;
      a.userId = identity.userId;
      a.planType = identity.planType;
      a.accountId = identity.accountId;
      a.organizationId = identity.organizationId;
      a.authProvider = identity.authProvider;
      a.tokens = tokens;
      a.lastUsedAt = now;
      return a;
    }
    const account: CodexStoredAccount = {
      id: buildStoredAccountId(identity.email, identity.accountId, identity.organizationId),
      email: identity.email,
      userId: identity.userId,
      planType: identity.planType,
      accountId: identity.accountId,
      organizationId: identity.organizationId,
      authProvider: identity.authProvider,
      tokens,
      createdAt: now,
      lastUsedAt: now,
    };
    store.accounts.push(account);
    return account;
  }

  // ── auth file helpers ────────────────────────────────────────────────────

  async readAuthFile(p: string): Promise<{ tokens: CodexStoredTokens; raw: string; exists: boolean; accountIdHint: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tokens: { idToken: '', accessToken: '' }, raw: '', exists: false, accountIdHint: '' };
      }
      throw err;
    }
    let parsed: { tokens?: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { tokens: { idToken: '', accessToken: '' }, raw, exists: true, accountIdHint: '' };
    }
    const t = parsed.tokens ?? {};
    return {
      tokens: {
        idToken: (t.id_token ?? '').trim(),
        accessToken: (t.access_token ?? '').trim(),
        refreshToken: (t.refresh_token ?? '').trim(),
      },
      raw,
      exists: true,
      accountIdHint: (t.account_id ?? '').trim(),
    };
  }

  // ── import ───────────────────────────────────────────────────────────────

  async importLocalAccount(): Promise<CodexStoredAccount> {
    const r = await this.readAuthFile(this.authPath());
    if (!r.exists) throw new AppError('AUTH_MISSING', '~/.codex/auth.json does not exist', 400);
    if (r.tokens.idToken === '' || r.tokens.accessToken === '') {
      throw new AppError('AUTH_INVALID', 'auth.json missing id_token or access_token', 400);
    }
    const store = await this.loadStore();
    const account = this.upsertAccount(store, r.tokens, r.accountIdHint, '');
    await this.saveStore(store);
    await writeBytesAtomic(this.currentAuthCachePath(), r.raw);
    return account;
  }

  importFromJSON(content: string): { candidates: { tokens: CodexStoredTokens; accountId: string; organizationId: string }[] } {
    const trimmed = content.trim();
    if (trimmed === '') throw new AppError('INVALID_INPUT', 'content is required', 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new AppError('INVALID_JSON', `parse json: ${(err as Error).message}`, 400);
    }
    const candidates: { tokens: CodexStoredTokens; accountId: string; organizationId: string }[] = [];
    const single = (v: unknown) => {
      const e = extractTokensFromValue(v);
      if (e) candidates.push(e);
    };
    if (Array.isArray(parsed)) {
      for (const item of parsed) single(item);
    } else if (parsed && typeof parsed === 'object') {
      single(parsed);
    }
    if (candidates.length === 0) throw new AppError('INVALID_INPUT', 'no valid codex tokens found', 400);
    return { candidates };
  }

  async importFromJSONApply(content: string): Promise<CodexStoredAccount[]> {
    const { candidates } = this.importFromJSON(content);
    const store = await this.loadStore();
    const imported: CodexStoredAccount[] = [];
    for (const c of candidates) {
      const a = this.upsertAccount(store, c.tokens, c.accountId, c.organizationId);
      imported.push(a);
    }
    await this.saveStore(store);
    return imported;
  }

  // ── switch / delete / remark ─────────────────────────────────────────────

  async prepareAccountForSwitch(accountId: string): Promise<CodexStoredAccount> {
    return this.lock(async () => {
      const store = await this.loadStoreUnlocked();
      const idx = store.accounts.findIndex((a) => a.id === accountId);
      if (idx < 0) throw new AppError('CODEX_ACCOUNT_NOT_FOUND', `codex account not found: ${accountId}`, 400);
      const account = store.accounts[idx]!;
      await refreshStoredAccountTokens(account);
      account.lastUsedAt = Date.now();
      store.accounts[idx] = account;
      store.currentAccountId = account.id;
      await this.saveStoreUnlocked(store);
      return account;
    });
  }

  async deleteAccount(accountId: string): Promise<void> {
    return this.lock(async () => {
      const store = await this.loadStoreUnlocked();
      const next = store.accounts.filter((a) => a.id !== accountId);
      if (next.length === store.accounts.length) {
        throw new AppError('CODEX_ACCOUNT_NOT_FOUND', `codex account not found: ${accountId}`, 400);
      }
      store.accounts = next;
      if (store.currentAccountId === accountId) store.currentAccountId = '';
      await this.saveStoreUnlocked(store);
    });
  }

  async saveAccountRemark(accountId: string, remark: string): Promise<CodexStoredAccount> {
    return this.lock(async () => {
      const store = await this.loadStoreUnlocked();
      const target = accountId.trim();
      const idx = store.accounts.findIndex((a) => a.id === target);
      if (idx < 0) throw new AppError('CODEX_ACCOUNT_NOT_FOUND', `codex account not found: ${target}`, 400);
      const a = store.accounts[idx]!;
      a.remark = normalizeRemark(remark);
      store.accounts[idx] = a;
      await this.saveStoreUnlocked(store);
      return a;
    });
  }

  // ── auth file write ──────────────────────────────────────────────────────

  async writeCurrentAuth(account: CodexStoredAccount): Promise<void> {
    const tokens: Record<string, unknown> = {
      id_token: account.tokens.idToken,
      access_token: account.tokens.accessToken,
    };
    if (account.tokens.refreshToken) tokens['refresh_token'] = account.tokens.refreshToken;
    if (account.accountId) tokens['account_id'] = account.accountId;
    const payload = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens,
      last_refresh: new Date().toISOString(),
    };
    const data = JSON.stringify(payload, null, 2);
    await writeBytesAtomic(this.authPath(), data);
    await writeBytesAtomic(this.currentAuthCachePath(), data);
  }

  async writeSelectedAuthIfAny(): Promise<void> {
    const store = await this.loadStore();
    if (!store.currentAccountId || store.currentAccountId.trim() === '') return;
    const account = await this.prepareAccountForSwitch(store.currentAccountId);
    await this.writeCurrentAuth(account);
  }

  // ── current account resolution ──────────────────────────────────────────

  async resolveCurrent(store: CodexAccountStoreFile): Promise<{ account: CodexStoredAccount | null; id: string }> {
    const r = await this.readAuthFile(this.authPath());
    if (!r.exists || r.tokens.idToken === '' || r.tokens.accessToken === '') return { account: null, id: '' };
    let identity: CodexAccountIdentity;
    try {
      identity = extractIdentity(r.tokens, r.accountIdHint, '');
    } catch {
      return { account: null, id: '' };
    }
    let emailFallback: CodexStoredAccount | null = null;
    for (const a of store.accounts) {
      if (a.email.toLowerCase() !== identity.email.toLowerCase()) continue;
      if (emailFallback === null) emailFallback = a;
      const accIdMatch = identity.accountId.trim() !== '' && (a.accountId ?? '').trim() === identity.accountId.trim();
      const orgOk = identity.organizationId === '' || (a.organizationId ?? '').trim() === identity.organizationId.trim();
      if (accIdMatch && orgOk) return { account: a, id: a.id };
      if (identity.organizationId.trim() !== '' && (a.organizationId ?? '').trim() === identity.organizationId.trim()) {
        return { account: a, id: a.id };
      }
    }
    return emailFallback ? { account: emailFallback, id: emailFallback.id } : { account: null, id: '' };
  }

  authModeEnabled(): boolean {
    let content = '';
    try {
      content = fsSync.readFileSync(this.configPath(), 'utf-8');
    } catch {
      return false;
    }
    const v = findTomlStringValue(content, '', 'model_provider');
    if (v.ok) {
      if (v.value.trim().toLowerCase() === 'openai') return true;
      if (v.value.trim() !== '') return false;
    }
    if (hasSectionInToml(content, 'model_providers.custom')) return false;
    if (hasSectionInToml(content, 'model_providers.openai')) return true;
    return false;
  }

  async buildPayload(force: boolean): Promise<Record<string, unknown>> {
    const store = await this.loadStore();
    // hydrate quotas best-effort (skip if no network); we tolerate failures
    await this.hydrateProfiles(store).catch(() => {});
    await this.hydrateQuotas(store, force).catch(() => {});
    return this.buildPayloadFromStore(store);
  }

  async buildPayloadFromStore(store: CodexAccountStoreFile): Promise<Record<string, unknown>> {
    const { account: current, id: currentId } = await this.resolveCurrent(store);
    const views = store.accounts.map((a) => buildAccountView(a, currentId));
    const payload: Record<string, unknown> = {
      accounts: views,
      currentAccountId: currentId,
      authMode: this.authModeEnabled(),
      authPath: this.authPath(),
      cachePath: this.storePath(),
      currentCachePath: this.currentAuthCachePath(),
    };
    if (current) payload['currentAccount'] = buildAccountView(current, currentId);
    const r = await this.readAuthFile(this.authPath()).catch(() => null);
    if (r) payload['hasLocalAuth'] = r.exists;
    return payload;
  }

  async hydrateProfiles(store: CodexAccountStoreFile): Promise<void> {
    let updated = false;
    for (let i = 0; i < store.accounts.length; i++) {
      const a = store.accounts[i]!;
      if (!needsRemoteProfileHydration(a)) continue;
      try {
        await refreshStoredAccountTokens(a);
      } catch {
        continue;
      }
      try {
        const profile = await fetchRemoteAccountProfile(a);
        let changed = false;
        if (profile.name !== '' && (a.accountName ?? '').trim() !== profile.name) {
          a.accountName = profile.name;
          changed = true;
        }
        if (profile.accountType !== '' && (a.accountType ?? '').trim() !== profile.accountType) {
          a.accountType = profile.accountType;
          changed = true;
        }
        if (profile.remoteAccountId !== '' && (a.accountId ?? '').trim() !== profile.remoteAccountId) {
          a.accountId = profile.remoteAccountId;
          changed = true;
        }
        if (changed) {
          store.accounts[i] = a;
          updated = true;
        }
      } catch {
        // skip
      }
    }
    if (updated) await this.saveStore(store);
  }

  async hydrateQuotas(store: CodexAccountStoreFile, force: boolean): Promise<void> {
    let updated = false;
    for (let i = 0; i < store.accounts.length; i++) {
      const a = store.accounts[i]!;
      if (!shouldRefreshQuota(a, force)) continue;
      try {
        await refreshStoredAccountTokens(a);
      } catch (err) {
        a.quotaError = buildQuotaError((err as Error).message);
        a.quotaUpdatedAt = Date.now();
        store.accounts[i] = a;
        updated = true;
        continue;
      }
      try {
        const { quota, planType } = await fetchQuota(a);
        a.quotaUpdatedAt = Date.now();
        if (planType !== '') a.planType = planType;
        a.quota = quota;
        a.quotaError = undefined;
        store.accounts[i] = a;
        updated = true;
      } catch (err) {
        a.quotaUpdatedAt = Date.now();
        a.quotaError = buildQuotaError((err as Error).message);
        store.accounts[i] = a;
        updated = true;
      }
    }
    if (updated) await this.saveStore(store);
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  cleanupOAuthStates(now: number): void {
    for (const [id, s] of this.oauthState.entries()) {
      if (!s) {
        this.oauthState.delete(id);
        continue;
      }
      if (s.status === 'pending' && now > s.expiresAt) {
        s.status = 'timeout';
        s.error = 'oauth authorization timed out';
      }
      if (s.status !== 'pending' && now - s.createdAt > CODEX_OAUTH_TIMEOUT_MS + CODEX_OAUTH_RETENTION_MS) {
        this.oauthState.delete(id);
      }
    }
  }

  findPending(now: number): CodexOAuthLoginState | undefined {
    for (const s of this.oauthState.values()) {
      if (s && s.status === 'pending' && now < s.expiresAt) return s;
    }
    return undefined;
  }

  async oauthStart(): Promise<{ loginId: string; authUrl: string; expiresAt: number }> {
    const now = Date.now();
    this.cleanupOAuthStates(now);
    const existing = this.findPending(now);
    if (existing) return { loginId: existing.loginId, authUrl: existing.authUrl, expiresAt: existing.expiresAt };

    const codeVerifier = generateOAuthToken();
    const stateToken = generateOAuthToken();
    const loginId = generateOAuthToken();
    const redirectUri = oauthRedirectUri();
    const authUrl = buildAuthorizeURL(redirectUri, buildCodeChallenge(codeVerifier), stateToken);
    const expiresAt = now + CODEX_OAUTH_TIMEOUT_MS;
    const loginState: CodexOAuthLoginState = {
      loginId, state: stateToken, authUrl, codeVerifier, redirectUri,
      status: 'pending', error: '', createdAt: now, expiresAt,
    };
    this.oauthState.set(loginId, loginState);

    try {
      await this.startCallbackServer(loginId, stateToken);
    } catch (err) {
      this.oauthState.delete(loginId);
      throw new AppError('CODEX_OAUTH_PORT_BIND', (err as Error).message, 409);
    }
    return { loginId, authUrl, expiresAt };
  }

  oauthStatus(loginId: string): { loginId: string; status: string; error: string; account?: CodexAccountView; expiresAt: number } {
    this.cleanupOAuthStates(Date.now());
    const s = this.oauthState.get(loginId);
    if (!s) return { loginId, status: 'missing', error: 'oauth session not found', expiresAt: 0 };
    return { loginId: s.loginId, status: s.status, error: s.error, account: s.account, expiresAt: s.expiresAt };
  }

  oauthCancel(loginId: string): void {
    const id = loginId.trim();
    if (id === '') {
      this.oauthState.clear();
    } else {
      this.oauthState.delete(id);
    }
    notifyCancelListener().catch(() => {});
  }

  private startCallbackServer(loginId: string, expectedState: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // shut down any prior server
      if (this.oauthServer) {
        try { this.oauthServer.close(); } catch { /* ignore */ }
        this.oauthServer = null;
      }
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${CODEX_OAUTH_CALLBACK_PORT}`);
        if (url.pathname === CODEX_OAUTH_CANCEL_PATH) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('cancelled');
          setImmediate(() => server.close());
          return;
        }
        if (url.pathname !== CODEX_OAUTH_CALLBACK_PATH) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(oauthFailureHTML('method GET is required'));
          setImmediate(() => server.close());
          return;
        }
        const stateToken = (url.searchParams.get('state') ?? '').trim();
        const code = (url.searchParams.get('code') ?? '').trim();
        const authError = (url.searchParams.get('error') ?? '').trim();
        const authErrorDescription = (url.searchParams.get('error_description') ?? '').trim();
        if (stateToken !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(oauthFailureHTML('oauth state mismatch'));
          return;
        }
        void this.completeOAuthLogin(stateToken, code, authError, authErrorDescription).then(({ status, body }) => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          setImmediate(() => server.close());
        });
      });
      const onListen = () => {
        this.oauthServer = server;
        // schedule timeout shutdown
        const tid = setTimeout(() => {
          const s = this.oauthState.get(loginId);
          if (s && s.status === 'pending') {
            s.status = 'timeout';
            s.error = 'oauth authorization timed out';
          }
          try { server.close(); } catch { /* ignore */ }
        }, CODEX_OAUTH_TIMEOUT_MS);
        server.on('close', () => {
          clearTimeout(tid);
          if (this.oauthServer === server) this.oauthServer = null;
        });
        resolve();
      };
      server.once('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          reject(new Error(`codex oauth callback port ${CODEX_OAUTH_CALLBACK_PORT} is already in use`));
        } else {
          reject(err);
        }
      });
      server.listen(CODEX_OAUTH_CALLBACK_PORT, '127.0.0.1', onListen);
    });
  }

  private async completeOAuthLogin(stateToken: string, code: string, authError: string, authErrorDescription: string): Promise<{ status: number; body: string }> {
    let loginState: CodexOAuthLoginState | undefined;
    for (const s of this.oauthState.values()) {
      if (s.state === stateToken) { loginState = s; break; }
    }
    if (!loginState) return { status: 400, body: oauthFailureHTML('oauth state not found') };
    if (authError !== '') {
      loginState.status = 'error';
      loginState.error = firstNonEmpty(authErrorDescription, authError);
      return { status: 400, body: oauthFailureHTML(loginState.error) };
    }
    if (code === '') {
      loginState.status = 'error';
      loginState.error = 'oauth callback missing code';
      return { status: 400, body: oauthFailureHTML(loginState.error) };
    }
    try {
      const tokens = await exchangeOAuthCode(code, loginState.codeVerifier, loginState.redirectUri);
      const account = await this.cacheOAuthAccount(tokens);
      loginState.status = 'completed';
      loginState.error = '';
      loginState.account = buildAccountView(account, '');
      return { status: 200, body: oauthSuccessHTML() };
    } catch (err) {
      loginState.status = 'error';
      loginState.error = (err as Error).message;
      return { status: 500, body: oauthFailureHTML(loginState.error) };
    }
  }

  private async cacheOAuthAccount(tokens: CodexStoredTokens): Promise<CodexStoredAccount> {
    return this.lock(async () => {
      const store = await this.loadStoreUnlocked();
      const account = this.upsertAccount(store, tokens, '', '');
      await this.saveStoreUnlocked(store);
      return account;
    });
  }
}

// ── value extraction for import ────────────────────────────────────────────

function extractTokensFromValue(value: unknown): { tokens: CodexStoredTokens; accountId: string; organizationId: string } | null {
  const o = mapFromAny(value);
  if (Object.keys(o).length === 0) return null;
  const idTokenTop = firstNonEmpty(stringFromAny(o['id_token']), stringFromAny(o['idToken']));
  if (idTokenTop !== '') {
    const accessToken = firstNonEmpty(stringFromAny(o['access_token']), stringFromAny(o['accessToken']));
    if (accessToken === '') return null;
    return {
      tokens: {
        idToken: idTokenTop,
        accessToken,
        refreshToken: firstNonEmpty(stringFromAny(o['refresh_token']), stringFromAny(o['refreshToken'])),
      },
      accountId: firstNonEmpty(stringFromAny(o['account_id']), stringFromAny(o['accountId'])),
      organizationId: firstNonEmpty(stringFromAny(o['organization_id']), stringFromAny(o['organizationId'])),
    };
  }
  const t = mapFromAny(o['tokens']);
  if (Object.keys(t).length === 0) return null;
  const idToken = firstNonEmpty(stringFromAny(t['id_token']), stringFromAny(t['idToken']));
  const accessToken = firstNonEmpty(stringFromAny(t['access_token']), stringFromAny(t['accessToken']));
  if (idToken === '' || accessToken === '') return null;
  return {
    tokens: {
      idToken,
      accessToken,
      refreshToken: firstNonEmpty(stringFromAny(t['refresh_token']), stringFromAny(t['refreshToken'])),
    },
    accountId: firstNonEmpty(
      stringFromAny(t['account_id']),
      stringFromAny(t['accountId']),
      stringFromAny(o['account_id']),
      stringFromAny(o['accountId']),
    ),
    organizationId: firstNonEmpty(
      stringFromAny(t['organization_id']),
      stringFromAny(t['organizationId']),
      stringFromAny(o['organization_id']),
      stringFromAny(o['organizationId']),
    ),
  };
}

// ── remote profile / quota fetch ───────────────────────────────────────────

function needsRemoteProfileHydration(a: CodexStoredAccount): boolean {
  if ((a.accountName ?? '').trim() === '') return true;
  if (isTeamLikePlan(a.planType ?? '') && (a.accountType ?? '').trim() === '') return true;
  return false;
}

function isTeamLikePlan(planType: string): boolean {
  const u = planType.trim().toUpperCase();
  return u.includes('TEAM') || u.includes('BUSINESS') || u.includes('ENTERPRISE') || u.includes('EDU');
}

interface RemoteProfile { name: string; accountType: string; remoteAccountId: string }

async function fetchRemoteAccountProfile(account: CodexStoredAccount): Promise<RemoteProfile> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.tokens.accessToken}`,
    Accept: 'application/json',
  };
  const accountId = firstNonEmpty(account.accountId ?? '', extractAccountIdFromAccessToken(account.tokens.accessToken));
  if (accountId !== '') headers['ChatGPT-Account-Id'] = accountId;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(CODEX_ACCOUNTS_CHECK_URL, { headers, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(`codex account profile failed: ${res.status} ${res.statusText}`);
    const payload = JSON.parse(body);
    return parseRemoteAccountProfile(payload, account);
  } finally {
    clearTimeout(t);
  }
}

function collectAccountRecords(payload: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const m = mapFromAny(payload);
  if (Object.keys(m).length > 0) {
    const accs = m['accounts'];
    if (Array.isArray(accs)) {
      for (const it of accs) {
        const r = mapFromAny(it);
        if (Object.keys(r).length > 0) records.push(r);
      }
    } else if (accs && typeof accs === 'object') {
      for (const it of Object.values(accs as Record<string, unknown>)) {
        const r = mapFromAny(it);
        if (Object.keys(r).length > 0) records.push(r);
      }
    }
    if (records.length > 0) return records;
  }
  for (const it of sliceFromAny(payload)) {
    const r = mapFromAny(it);
    if (Object.keys(r).length > 0) records.push(r);
  }
  return records;
}

function extractProfileField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = stringFromAny(record[k]);
    if (v !== '') return v;
  }
  return '';
}

function parseRemoteAccountProfile(payload: unknown, account: CodexStoredAccount): RemoteProfile {
  const records = collectAccountRecords(payload);
  if (records.length === 0) return { name: '', accountType: '', remoteAccountId: '' };
  let orderingFirst = '';
  const m = mapFromAny(payload);
  const ordering = sliceFromAny(m['account_ordering']);
  if (ordering.length > 0) orderingFirst = stringFromAny(ordering[0]);
  const expectedAccountId = firstNonEmpty(account.accountId ?? '', extractAccountIdFromAccessToken(account.tokens.accessToken));
  const expectedOrgId = (account.organizationId ?? '').trim();
  let selected: Record<string, unknown> | null = null;
  if (expectedAccountId !== '') {
    for (const r of records) {
      if (extractProfileField(r, 'id', 'account_id', 'chatgpt_account_id', 'workspace_id') === expectedAccountId) {
        selected = r; break;
      }
    }
  }
  if (!selected && orderingFirst !== '') {
    for (const r of records) {
      if (extractProfileField(r, 'id', 'account_id', 'chatgpt_account_id', 'workspace_id') === orderingFirst) {
        selected = r; break;
      }
    }
  }
  if (!selected && expectedOrgId !== '') {
    for (const r of records) {
      if (extractProfileField(r, 'organization_id', 'org_id', 'workspace_id') === expectedOrgId) {
        selected = r; break;
      }
    }
  }
  if (!selected) selected = records[0]!;
  return {
    name: extractProfileField(selected, 'name', 'display_name', 'account_name', 'organization_name', 'workspace_name', 'title'),
    accountType: extractProfileField(selected, 'structure', 'account_structure', 'kind', 'type', 'account_type'),
    remoteAccountId: extractProfileField(selected, 'id', 'account_id', 'chatgpt_account_id', 'workspace_id'),
  };
}

function shouldRefreshQuota(a: CodexStoredAccount, force: boolean): boolean {
  if (force) return true;
  if (!a.quota) return true;
  if (!a.quotaUpdatedAt || a.quotaUpdatedAt <= 0) return true;
  return Date.now() - a.quotaUpdatedAt >= CODEX_QUOTA_STALE_INTERVAL_MS;
}

interface UsageWindow {
  used_percent?: number | null;
  limit_window_seconds?: number | null;
  reset_after_seconds?: number | null;
  reset_at?: number | null;
}
interface UsageRateLimit {
  primary_window?: UsageWindow | null;
  secondary_window?: UsageWindow | null;
}
interface UsageResponse {
  plan_type?: string;
  rate_limit?: UsageRateLimit | null;
  code_review_rate_limit?: UsageRateLimit | null;
}

async function fetchQuota(account: CodexStoredAccount): Promise<{ quota: CodexStoredQuota; planType: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.tokens.accessToken}`,
    Accept: 'application/json',
  };
  const accountId = firstNonEmpty(account.accountId ?? '', extractAccountIdFromAccessToken(account.tokens.accessToken));
  if (accountId !== '') headers['ChatGPT-Account-Id'] = accountId;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(CODEX_USAGE_URL, { headers, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) {
      const code = extractDetailCodeFromBody(body);
      let message = `API 返回错误 ${res.status}`;
      if (code !== '') message += ` [error_code:${code}]`;
      const preview = body.trim().slice(0, 200);
      if (preview !== '') message += ` - ${preview}`;
      throw new Error(message);
    }
    const usage = JSON.parse(body) as UsageResponse;
    return { quota: parseStoredQuota(usage), planType: (usage.plan_type ?? '').trim() };
  } finally {
    clearTimeout(t);
  }
}

function extractDetailCodeFromBody(body: string): string {
  try {
    const p = JSON.parse(body) as Record<string, unknown>;
    const detail = mapFromAny(p['detail']);
    if (Object.keys(detail).length > 0) {
      const c = stringFromAny(detail['code']);
      if (c !== '') return c;
    }
    return stringFromAny(p['code']);
  } catch {
    return '';
  }
}

function buildQuotaError(message: string): CodexQuotaError | undefined {
  if (message.trim() === '') return undefined;
  return {
    code: extractErrorCodeFromMessage(message),
    message,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

function extractErrorCodeFromMessage(message: string): string {
  const marker = '[error_code:';
  const start = message.indexOf(marker);
  if (start < 0) return '';
  const tail = message.slice(start + marker.length);
  const end = tail.indexOf(']');
  if (end < 0) return '';
  return tail.slice(0, end);
}

function normalizeRemainingPercentage(w: UsageWindow | null | undefined): number {
  if (!w || w.used_percent == null) return 100;
  return 100 - clampPercentage(w.used_percent);
}
function normalizeWindowMinutes(w: UsageWindow | null | undefined): number {
  if (!w || w.limit_window_seconds == null || w.limit_window_seconds <= 0) return 0;
  return Math.floor((w.limit_window_seconds + 59) / 60);
}
function normalizeResetTime(w: UsageWindow | null | undefined): number {
  if (!w) return 0;
  if (w.reset_at != null && w.reset_at > 0) return w.reset_at;
  if (w.reset_after_seconds == null || w.reset_after_seconds < 0) return 0;
  return Math.floor(Date.now() / 1000) + w.reset_after_seconds;
}

function getQuotaWindowLabel(minutes: number, fallback: string): string {
  if (minutes <= 0) return fallback === 'weekly' ? 'Weekly' : '5h';
  const hour = 60, day = 24 * 60, week = 7 * 24 * 60;
  if (minutes >= week - 1) {
    const weeks = Math.ceil(minutes / week);
    return weeks <= 1 ? 'Weekly' : `${weeks} Week`;
  }
  if (minutes >= day - 1) return `${Math.ceil(minutes / day)}d`;
  if (minutes >= hour) return `${Math.ceil(minutes / hour)}h`;
  return `${minutes}m`;
}

function parseStoredQuota(usage: UsageResponse): CodexStoredQuota {
  const q: CodexStoredQuota = {
    hourlyPercentage: 100,
    weeklyPercentage: 100,
    hourlyWindowPresent: false,
    weeklyWindowPresent: false,
    codeReviewPresent: false,
  };
  const rl = usage.rate_limit;
  if (rl) {
    if (rl.primary_window) {
      q.hourlyPercentage = normalizeRemainingPercentage(rl.primary_window);
      q.hourlyResetTime = normalizeResetTime(rl.primary_window);
      q.hourlyWindowMinutes = normalizeWindowMinutes(rl.primary_window);
      q.hourlyWindowPresent = true;
    }
    if (rl.secondary_window) {
      q.weeklyPercentage = normalizeRemainingPercentage(rl.secondary_window);
      q.weeklyResetTime = normalizeResetTime(rl.secondary_window);
      q.weeklyWindowMinutes = normalizeWindowMinutes(rl.secondary_window);
      q.weeklyWindowPresent = true;
    }
  }
  const cr = usage.code_review_rate_limit;
  if (cr) {
    if (cr.primary_window) {
      q.codeReviewPercentage = normalizeRemainingPercentage(cr.primary_window);
      q.codeReviewResetTime = normalizeResetTime(cr.primary_window);
      q.codeReviewLabel = getQuotaWindowLabel(normalizeWindowMinutes(cr.primary_window), 'hourly');
      q.codeReviewPresent = true;
    } else if (cr.secondary_window) {
      q.codeReviewPercentage = normalizeRemainingPercentage(cr.secondary_window);
      q.codeReviewResetTime = normalizeResetTime(cr.secondary_window);
      q.codeReviewLabel = getQuotaWindowLabel(normalizeWindowMinutes(cr.secondary_window), 'weekly');
      q.codeReviewPresent = true;
    }
  }
  return q;
}

// ── OAuth helpers ──────────────────────────────────────────────────────────

export function generateOAuthToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function buildCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function oauthRedirectUri(): string {
  return `http://localhost:${CODEX_OAUTH_CALLBACK_PORT}${CODEX_OAUTH_CALLBACK_PATH}`;
}

export function buildAuthorizeURL(redirectUri: string, codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: CODEX_OAUTH_ORIGINATOR,
  });
  return `${CODEX_OAUTH_AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeOAuthCode(code: string, codeVerifier: string, redirectUri: string): Promise<CodexStoredTokens> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const res = await fetch(CODEX_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`oauth token exchange failed: ${res.status} ${res.statusText}`);
  const payload = JSON.parse(body) as Record<string, unknown>;
  const tokens: CodexStoredTokens = {
    idToken: stringFromAny(payload['id_token']),
    accessToken: stringFromAny(payload['access_token']),
    refreshToken: stringFromAny(payload['refresh_token']),
  };
  if (tokens.idToken === '' || tokens.accessToken === '') throw new Error('auth.json missing id_token or access_token');
  return tokens;
}

async function notifyCancelListener(): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`http://127.0.0.1:${CODEX_OAUTH_CALLBACK_PORT}${CODEX_OAUTH_CANCEL_PATH}`, { signal: ctrl.signal });
  } catch {
    // ignore
  } finally {
    clearTimeout(t);
  }
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function oauthSuccessHTML(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codex OAuth 完成</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07091a; color: #dce8f8; display: grid; place-items: center; min-height: 100vh; }
    .panel { width: min(440px, calc(100vw - 32px)); padding: 24px; border: 1px solid rgba(75,142,233,0.25); background: #0c1429; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 12px; font-size: 20px; }
    p { margin: 0; color: #9bb2d3; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>Codex 账号授权成功</h1>
    <p>现在可以返回个人操作台，账号已缓存到 data/codex/ 中。此页面可直接关闭。</p>
  </div>
  <script>setTimeout(() => { window.close(); }, 1200);</script>
</body>
</html>`;
}

export function oauthFailureHTML(message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codex OAuth 失败</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07091a; color: #dce8f8; display: grid; place-items: center; min-height: 100vh; }
    .panel { width: min(440px, calc(100vw - 32px)); padding: 24px; border: 1px solid rgba(239,82,87,0.3); background: #0c1429; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 12px; font-size: 20px; color: #ef8c90; }
    p { margin: 0; color: #caa8aa; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>Codex 账号授权失败</h1>
    <p>${htmlEscape(message)}</p>
  </div>
</body>
</html>`;
}
