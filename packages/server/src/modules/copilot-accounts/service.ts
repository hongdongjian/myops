import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { Paths } from '../../paths.js';
import { AppError } from '../../core/errors.js';
import {
  COPILOT_ACCOUNTS_STORE_VERSION,
  type CopilotStoredAccount,
  type CopilotAccountStoreFile,
  type CopilotAccountView,
  type CopilotAccountsPayload,
  type CopilotAuthSnapshot,
  type OAuthStartResponse,
  type OAuthStatusResponse,
} from './schema.js';

export const COPILOT_OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
export const COPILOT_OAUTH_RETENTION_MS = 15 * 60 * 1000;

const DEVICE_CODE_PATTERN = /Please enter the code "([^"]+)" in (https?:\S+)/;
const TOKEN_PATTERN = /GitHub token:\s*(\S+)/;
const LOGIN_PATTERN = /Logged in as\s+([A-Za-z0-9-]+)/;

export interface CopilotEventLogger {
  appendEventLog(eventType: string, message: string): void;
}

export interface CopilotRestartHook {
  /** Returns "started" | "restarted" | "" — mirrors Go restartCopilotForCurrentAccount. */
  restartForCurrentAccount(): Promise<string>;
}

interface OAuthLoginState {
  loginId: string;
  status: 'pending' | 'completed' | 'error' | 'timeout';
  error?: string;
  code?: string;
  verificationUrl?: string;
  clipboardCopied?: boolean;
  browserOpened?: boolean;
  serviceAction?: string;
  serviceError?: string;
  account?: CopilotAccountView;
  createdAt: number;
  expiresAt: number;
  child?: ChildProcess;
  expiryTimer?: NodeJS.Timeout;
}

export interface CopilotAccountsServiceOptions {
  /** Override for `copilot-api auth --show-token` spawner — used by tests. */
  spawnAuth?: (logFilePath: string) => ChildProcess;
  /** Override for clipboard copy. Default uses `pbcopy`. */
  copyToClipboard?: (code: string) => Promise<void>;
  /** Override for opening browser. Default uses `open`. */
  openBrowser?: (url: string) => Promise<void>;
  /** Hook to restart copilot service after a successful OAuth login. */
  restartHook?: CopilotRestartHook;
  /** Hook to append events to the copilot event log. */
  logger?: CopilotEventLogger;
}

export class CopilotAccountsService {
  private readonly oauthState = new Map<string, OAuthLoginState>();
  private storeMutex: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: Paths,
    private readonly options: CopilotAccountsServiceOptions = {},
  ) {}

  setRestartHook(hook: CopilotRestartHook): void {
    this.options.restartHook = hook;
  }

  setLogger(logger: CopilotEventLogger): void {
    this.options.logger = logger;
  }

  // ── paths ────────────────────────────────────────────────────────────────

  storePath(): string {
    return this.paths.dataPath('copilot', 'accounts.json');
  }

  currentTokenCachePath(): string {
    return this.paths.dataPath('copilot', 'current-github-token');
  }

  githubTokenPath(): string {
    return path.join(this.paths.homeDir, '.local', 'share', 'copilot-api', 'github_token');
  }

  copilotLogPath(): string {
    return this.paths.dataPath('logs', 'copilot-api.log');
  }

  // ── store ────────────────────────────────────────────────────────────────

  private async withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.storeMutex;
    let release!: () => void;
    this.storeMutex = new Promise<void>((r) => { release = r; });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  async loadStore(): Promise<CopilotAccountStoreFile> {
    return this.withStoreLock(() => this.loadStoreUnlocked());
  }

  private async loadStoreUnlocked(): Promise<CopilotAccountStoreFile> {
    try {
      const raw = await fsp.readFile(this.storePath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CopilotAccountStoreFile>;
      const store: CopilotAccountStoreFile = {
        version: parsed.version || COPILOT_ACCOUNTS_STORE_VERSION,
        currentAccountId: parsed.currentAccountId,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      };
      sortAccounts(store.accounts);
      return store;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: COPILOT_ACCOUNTS_STORE_VERSION, accounts: [] };
      }
      throw err;
    }
  }

  private async saveStoreUnlocked(store: CopilotAccountStoreFile): Promise<void> {
    store.version = COPILOT_ACCOUNTS_STORE_VERSION;
    sortAccounts(store.accounts);
    const data = `${JSON.stringify(store, null, 2)}\n`;
    await writeFileAtomic(this.storePath(), data, 0o600);
  }

  // ── views / payloads ─────────────────────────────────────────────────────

  async buildAccountsPayload(): Promise<CopilotAccountsPayload> {
    const store = await this.loadStore();
    const { account: currentAccount, id: currentAccountId } = resolveCurrent(store);
    const accounts = store.accounts.map((a) => buildView(a, currentAccountId));
    const payload: CopilotAccountsPayload = {
      accounts,
      currentAccountId,
      cachePath: this.storePath(),
      authPath: this.githubTokenPath(),
      currentCachePath: this.currentTokenCachePath(),
      hasToken: !!currentAccount && (currentAccount.githubToken ?? '').trim() !== '',
    };
    if (currentAccount) {
      payload.currentAccount = buildView(currentAccount, currentAccountId);
    }
    return payload;
  }

  async getAuthSnapshot(): Promise<CopilotAuthSnapshot> {
    const store = await this.loadStore();
    const { account: currentAccount, id: currentAccountId } = resolveCurrent(store);
    const snapshot: CopilotAuthSnapshot = {
      accountCount: store.accounts.length,
      hasToken: !!currentAccount && (currentAccount.githubToken ?? '').trim() !== '',
    };
    if (currentAccount) {
      snapshot.currentAccount = buildView(currentAccount, currentAccountId);
      snapshot.currentAccountId = currentAccountId;
    }
    return snapshot;
  }

  // ── operations ───────────────────────────────────────────────────────────

  async prepareCurrent(): Promise<CopilotStoredAccount> {
    return this.withStoreLock(async () => {
      const store = await this.loadStoreUnlocked();
      const currentId = (store.currentAccountId ?? '').trim();
      let index = currentId ? store.accounts.findIndex((a) => a.id === currentId) : -1;
      if (index < 0 && store.accounts.length > 0) index = 0;
      if (index < 0) {
        throw new AppError('COPILOT_NO_ACCOUNT', 'no copilot account configured, please login first', 400);
      }
      const account = { ...store.accounts[index]! };
      if ((account.githubToken ?? '').trim() === '') {
        throw new AppError('COPILOT_TOKEN_MISSING', 'current copilot account is missing github token, please login again', 400);
      }
      account.lastUsedAt = Date.now();
      store.accounts[index] = account;
      store.currentAccountId = account.id;
      await this.saveStoreUnlocked(store);
      return account;
    });
  }

  async prepareForSwitch(accountId: string): Promise<CopilotStoredAccount> {
    return this.withStoreLock(async () => {
      const store = await this.loadStoreUnlocked();
      const targetId = accountId.trim();
      const index = store.accounts.findIndex((a) => a.id === targetId);
      if (index < 0) {
        throw new AppError('COPILOT_ACCOUNT_NOT_FOUND', `copilot account not found: ${targetId}`, 400);
      }
      const account = { ...store.accounts[index]! };
      if ((account.githubToken ?? '').trim() === '') {
        throw new AppError('COPILOT_TOKEN_MISSING', 'copilot account token is empty, please login again', 400);
      }
      account.lastUsedAt = Date.now();
      store.accounts[index] = account;
      store.currentAccountId = account.id;
      await this.saveStoreUnlocked(store);
      return account;
    });
  }

  async upsertStored(login: string, token: string): Promise<CopilotStoredAccount> {
    return this.withStoreLock(async () => {
      const store = await this.loadStoreUnlocked();
      const now = Date.now();
      const accountId = login.trim();
      const index = store.accounts.findIndex((a) => a.id === accountId);
      const account: CopilotStoredAccount = {
        id: accountId,
        login: accountId,
        githubToken: token.trim(),
        createdAt: now,
        lastUsedAt: now,
      };
      if (index >= 0) {
        const prev = store.accounts[index]!;
        account.createdAt = prev.createdAt;
        if (prev.remark !== undefined) account.remark = prev.remark;
        store.accounts[index] = account;
      } else {
        store.accounts.push(account);
      }
      store.currentAccountId = account.id;
      await this.saveStoreUnlocked(store);
      return account;
    });
  }

  async writeCurrentToken(account: CopilotStoredAccount): Promise<void> {
    const token = (account.githubToken ?? '').trim();
    if (token === '') {
      throw new AppError('COPILOT_TOKEN_MISSING', 'copilot github token is empty', 400);
    }
    await fsp.mkdir(path.dirname(this.githubTokenPath()), { recursive: true });
    await writeFileAtomic(this.githubTokenPath(), token, 0o600);
    await writeFileAtomic(this.currentTokenCachePath(), token, 0o600);
  }

  async saveAccountRemark(accountId: string, remark: string): Promise<CopilotStoredAccount> {
    return this.withStoreLock(async () => {
      const store = await this.loadStoreUnlocked();
      const targetId = accountId.trim();
      const index = store.accounts.findIndex((a) => a.id === targetId);
      if (index < 0) {
        throw new AppError('COPILOT_ACCOUNT_NOT_FOUND', `copilot account not found: ${targetId}`, 400);
      }
      const account = { ...store.accounts[index]!, remark: normalizeRemark(remark) };
      store.accounts[index] = account;
      await this.saveStoreUnlocked(store);
      return account;
    });
  }

  async deleteStored(accountId: string): Promise<void> {
    await this.withStoreLock(async () => {
      const store = await this.loadStoreUnlocked();
      const next = store.accounts.filter((a) => a.id !== accountId);
      if (next.length === store.accounts.length) {
        throw new AppError('COPILOT_ACCOUNT_NOT_FOUND', `copilot account not found: ${accountId}`, 400);
      }
      store.accounts = next;
      if (store.currentAccountId === accountId) store.currentAccountId = '';
      await this.saveStoreUnlocked(store);
    });
  }

  // ── OAuth flow ───────────────────────────────────────────────────────────

  async startOAuth(): Promise<OAuthStartResponse> {
    this.cleanupOAuthStates();
    const existing = this.findPending();
    if (existing) {
      return {
        loginId: existing.loginId,
        status: existing.status,
        expiresAt: existing.expiresAt,
      };
    }

    const loginId = generateLoginId();
    const now = Date.now();
    const state: OAuthLoginState = {
      loginId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + COPILOT_OAUTH_TIMEOUT_MS,
    };
    state.expiryTimer = setTimeout(() => this.timeoutLogin(loginId), COPILOT_OAUTH_TIMEOUT_MS);
    this.oauthState.set(loginId, state);
    this.options.logger?.appendEventLog('AUTH_START', 'copilot oauth login started');
    void this.runOAuthFlow(loginId);
    return { loginId, status: 'pending', expiresAt: state.expiresAt };
  }

  getOAuthStatus(loginId: string): OAuthStatusResponse {
    this.cleanupOAuthStates();
    const state = this.oauthState.get(loginId);
    if (!state) {
      return { loginId, status: 'missing', error: 'oauth session not found' };
    }
    return {
      loginId: state.loginId,
      status: state.status,
      error: state.error ?? '',
      code: state.code ?? '',
      verificationUrl: state.verificationUrl ?? '',
      clipboardCopied: state.clipboardCopied ?? false,
      browserOpened: state.browserOpened ?? false,
      serviceAction: state.serviceAction ?? '',
      serviceError: state.serviceError ?? '',
      account: state.account,
      expiresAt: state.expiresAt,
    };
  }

  private cleanupOAuthStates(): void {
    const now = Date.now();
    for (const [id, state] of this.oauthState) {
      if (state.status === 'pending' && now > state.expiresAt) {
        state.status = 'timeout';
        state.error = 'copilot oauth authorization timed out';
        try { state.child?.kill('SIGKILL'); } catch { /* noop */ }
      }
      if (now - state.createdAt > COPILOT_OAUTH_RETENTION_MS) {
        if (state.expiryTimer) clearTimeout(state.expiryTimer);
        this.oauthState.delete(id);
      }
    }
  }

  private timeoutLogin(loginId: string): void {
    const state = this.oauthState.get(loginId);
    if (!state || state.status !== 'pending') return;
    state.status = 'timeout';
    state.error = 'copilot oauth authorization timed out';
    try { state.child?.kill('SIGKILL'); } catch { /* noop */ }
  }

  private findPending(): OAuthLoginState | undefined {
    const now = Date.now();
    for (const state of this.oauthState.values()) {
      if (state.status === 'pending' && now < state.expiresAt) return state;
    }
    return undefined;
  }

  private async runOAuthFlow(loginId: string): Promise<void> {
    const state = this.oauthState.get(loginId);
    if (!state) return;

    let logStream: fs.WriteStream | null = null;
    let child: ChildProcess;
    try {
      await fsp.mkdir(path.dirname(this.copilotLogPath()), { recursive: true });
      logStream = fs.createWriteStream(this.copilotLogPath(), { flags: 'a' });
      child = this.options.spawnAuth
        ? this.options.spawnAuth(this.copilotLogPath())
        : spawn('copilot-api', ['auth', '--show-token'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.failOAuth(loginId, `failed to prepare copilot auth: ${(err as Error).message}`);
      return;
    }

    state.child = child;
    let token = '';
    let login = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      const dev = DEVICE_CODE_PATTERN.exec(trimmed);
      if (dev) {
        const code = dev[1]!.trim();
        const url = dev[2]!.trim();
        void this.updateDeviceCode(loginId, code, url);
      }
      const tk = TOKEN_PATTERN.exec(trimmed);
      if (tk) token = tk[1]!.trim();
      const lg = LOGIN_PATTERN.exec(trimmed);
      if (lg) login = lg[1]!.trim();
    };

    const stdoutRl = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
    const stderrRl = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
    if (stdoutRl) {
      stdoutRl.on('line', (l) => { logStream?.write(`${l}\n`); handleLine(l); });
    }
    if (stderrRl) {
      stderrRl.on('line', (l) => { logStream?.write(`${l}\n`); handleLine(l); });
    }

    const exitCode: number | null = await new Promise((resolve) => {
      child.once('close', (code) => resolve(code));
      child.once('error', () => resolve(-1));
    });
    stdoutRl?.close();
    stderrRl?.close();
    logStream?.end();

    if (state.status !== 'pending') return; // timed out / cancelled

    if (exitCode !== 0) {
      this.failOAuth(loginId, `copilot auth failed: exit ${exitCode}`);
      return;
    }
    if (login === '' || token === '') {
      this.failOAuth(loginId, 'copilot auth completed but account or token was not captured');
      return;
    }

    let account: CopilotStoredAccount;
    try {
      account = await this.upsertStored(login, token);
      await this.writeCurrentToken(account);
    } catch (err) {
      this.failOAuth(loginId, (err as Error).message);
      return;
    }

    let serviceAction = '';
    let serviceError = '';
    if (this.options.restartHook) {
      try {
        serviceAction = await this.options.restartHook.restartForCurrentAccount();
      } catch (err) {
        serviceError = (err as Error).message;
      }
    }

    const view = buildView(account, account.id);
    state.status = 'completed';
    state.error = '';
    state.serviceAction = serviceAction;
    state.serviceError = serviceError;
    state.account = view;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    state.child = undefined;
    this.options.logger?.appendEventLog('AUTH_SUCCESS', `copilot oauth login completed for ${account.login}`);
  }

  private async updateDeviceCode(loginId: string, code: string, verificationUrl: string): Promise<void> {
    let clipboardCopied = false;
    let browserOpened = false;
    if (code !== '') {
      try {
        if (this.options.copyToClipboard) await this.options.copyToClipboard(code);
        else await defaultCopyToClipboard(code);
        clipboardCopied = true;
      } catch { /* noop */ }
    }
    if (verificationUrl !== '') {
      try {
        if (this.options.openBrowser) await this.options.openBrowser(verificationUrl);
        else await defaultOpenBrowser(verificationUrl);
        browserOpened = true;
      } catch { /* noop */ }
    }
    const state = this.oauthState.get(loginId);
    if (!state) return;
    state.code = code;
    state.verificationUrl = verificationUrl;
    state.clipboardCopied = state.clipboardCopied || clipboardCopied;
    state.browserOpened = state.browserOpened || browserOpened;
  }

  private failOAuth(loginId: string, message: string): void {
    const state = this.oauthState.get(loginId);
    if (!state || state.status === 'completed') return;
    state.status = 'error';
    state.error = message;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    state.child = undefined;
    this.options.logger?.appendEventLog('AUTH_ERROR', message);
  }
}

// ── pure helpers ───────────────────────────────────────────────────────────

export function sortAccounts(accounts: CopilotStoredAccount[]): void {
  accounts.sort((a, b) => {
    if (a.lastUsedAt === b.lastUsedAt) {
      return a.login.toLowerCase().localeCompare(b.login.toLowerCase());
    }
    return b.lastUsedAt - a.lastUsedAt;
  });
}

export function maskToken(token: string): string {
  const trimmed = (token ?? '').trim();
  if (trimmed === '') return '';
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function buildView(account: CopilotStoredAccount, currentAccountId: string): CopilotAccountView {
  const view: CopilotAccountView = {
    id: account.id,
    login: account.login,
    tokenPreview: maskToken(account.githubToken),
    createdAt: account.createdAt,
    lastUsedAt: account.lastUsedAt,
    current: account.id !== '' && account.id === currentAccountId,
  };
  if (account.remark) view.remark = account.remark;
  return view;
}

export function normalizeRemark(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function resolveCurrent(store: CopilotAccountStoreFile): { account?: CopilotStoredAccount; id: string } {
  const currentId = (store.currentAccountId ?? '').trim();
  if (currentId !== '') {
    const found = store.accounts.find((a) => a.id === currentId);
    if (found) return { account: found, id: currentId };
  }
  if (store.accounts.length === 0) return { id: '' };
  const first = store.accounts[0]!;
  return { account: first, id: first.id };
}

export function parseDeviceCodeLine(line: string): { code: string; url: string } {
  const m = DEVICE_CODE_PATTERN.exec(line);
  if (!m) return { code: '', url: '' };
  return { code: m[1]!.trim(), url: m[2]!.trim() };
}

export function parseTokenLine(line: string): string {
  const m = TOKEN_PATTERN.exec(line);
  return m ? m[1]!.trim() : '';
}

export function parseLoginLine(line: string): string {
  const m = LOGIN_PATTERN.exec(line);
  return m ? m[1]!.trim() : '';
}

async function writeFileAtomic(target: string, data: string | Buffer, mode: number): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.tmp-${crypto.randomBytes(6).toString('hex')}`);
  await fsp.writeFile(tmp, data, { mode });
  await fsp.rename(tmp, target);
}

function generateLoginId(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function defaultCopyToClipboard(code: string): Promise<void> {
  if (os.platform() !== 'darwin') throw new Error('clipboard not supported on this platform');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pbcopy');
    child.once('error', reject);
    child.once('close', (c) => (c === 0 ? resolve() : reject(new Error(`pbcopy exit ${c}`))));
    child.stdin?.end(code);
  });
}

async function defaultOpenBrowser(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.unref();
    resolve();
  });
}
