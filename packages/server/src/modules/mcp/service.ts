import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { copyDir } from '../../core/fsops/index.js';
import type { ProcessStatus } from './schema.js';

export const XHS_PROCESS_NAME = 'xiaohongshu-mcp';
export const XHS_MCP_INITIALIZE_URL = 'http://localhost:18060/mcp';
export const XHS_MCP_PROBE_TIMEOUT_MS = 3000;
export const XHS_MCP_PROBE_CACHE_TTL_MS = 10_000;

interface AutostartSettings {
  enabled: boolean;
}

interface ProbeCache {
  checkedAt: number;
  healthy: boolean;
  error: string;
}

export class XHSService {
  private autostartEnabled: boolean;
  private probeCache: ProbeCache | null = null;

  constructor(private readonly deps: Deps) {
    this.autostartEnabled = this.loadAutostartSetting();
  }

  // ── paths ────────────────────────────────────────────────────────────────

  packagePath(): string {
    return path.join(this.deps.paths.rootDir, 'tool', 'xhs');
  }

  binarySuffix(): string {
    return `${process.platform === 'darwin' ? 'darwin' : process.platform}-${mapArch(process.arch)}`;
  }

  loginBinaryPath(): string {
    return path.join(this.packagePath(), `xiaohongshu-login-${this.binarySuffix()}`);
  }

  serverBinaryPath(): string {
    return path.join(this.packagePath(), `xiaohongshu-mcp-${this.binarySuffix()}`);
  }

  xhsDataPath(...parts: string[]): string {
    return this.deps.paths.dataPath('xhs', ...parts);
  }

  defaultPackageSource(): string {
    return path.join(this.deps.paths.rootDir, 'packages', 'xhs');
  }

  logPath(): string {
    return this.deps.paths.dataPath('logs', `${XHS_PROCESS_NAME}.log`);
  }

  autostartSettingsPath(): string {
    return this.deps.paths.dataPath('xhs-autostart.json');
  }

  // ── status / lifecycle ───────────────────────────────────────────────────

  getProcessStatus(): ProcessStatus {
    const status = this.deps.processMgr.status(XHS_PROCESS_NAME);
    if (!status.running) {
      return {
        name: XHS_PROCESS_NAME,
        running: false,
        pid: 0,
        logPath: '',
        command: '',
        args: [],
        startedAt: '',
      };
    }
    return {
      name: XHS_PROCESS_NAME,
      running: true,
      pid: status.pid ?? 0,
      logPath: status.logPath ?? '',
      command: status.command ?? '',
      args: status.args ?? [],
      startedAt: status.startedAt ? new Date(status.startedAt).toISOString() : '',
    };
  }

  async getStatus(): Promise<Record<string, unknown>> {
    const procStatus = this.getProcessStatus();
    const loginBinaryExists = fileExists(this.loginBinaryPath());
    const serverBinaryExists = fileExists(this.serverBinaryPath());
    const cookies = await this.detectCookieFile();

    let healthy = false;
    let healthErr = '';
    if (procStatus.running) {
      const r = await this.checkHealth();
      healthy = r.healthy;
      healthErr = r.error;
    }

    const state = procStatus.running || healthy ? 'ACTIVE' : 'ERROR';
    const actionLabel = cookies.hasCookie ? '重新登录' : '登录';

    return {
      process: procStatus,
      health: { healthy, state, error: healthErr },
      auth: {
        hasCookie: cookies.hasCookie,
        cookieFile: cookies.cookieFile,
        actionLabel,
        cookieError: cookies.error,
      },
      package: {
        path: this.packagePath(),
        dataPath: this.xhsDataPath(),
        loginBinary: this.loginBinaryPath(),
        serverBinary: this.serverBinaryPath(),
        loginBinaryExists,
        serverBinaryExists,
      },
    };
  }

  async start(): Promise<ProcessStatus> {
    if (!fileExists(this.serverBinaryPath())) {
      throw new AppError('XHS_NOT_INSTALLED', `xiaohongshu mcp binary not found: ${this.serverBinaryPath()}`, 400);
    }
    await fs.mkdir(this.xhsDataPath(), { recursive: true });
    try {
      await this.deps.processMgr.spawn(XHS_PROCESS_NAME, {
        cmd: this.serverBinaryPath(),
        args: [],
        cwd: this.xhsDataPath(),
      });
    } catch (err) {
      this.appendEventLog('START_ERROR', (err as Error).message);
      throw new AppError('XHS_START_FAILED', (err as Error).message, 400);
    }
    const status = this.getProcessStatus();
    this.appendEventLog('START', `xiaohongshu mcp started (pid=${status.pid})`);
    this.appendEventLog('RUN', 'process output stream attached');
    return status;
  }

  async stop(): Promise<boolean> {
    const before = this.deps.processMgr.status(XHS_PROCESS_NAME);
    await this.deps.processMgr.stop(XHS_PROCESS_NAME);
    return before.running;
  }

  async restart(): Promise<ProcessStatus> {
    if (!fileExists(this.serverBinaryPath())) {
      throw new AppError('XHS_NOT_INSTALLED', `xiaohongshu mcp binary not found: ${this.serverBinaryPath()}`, 400);
    }
    await fs.mkdir(this.xhsDataPath(), { recursive: true });
    this.appendEventLog('RESTART', 'restart requested');
    await this.deps.processMgr.stop(XHS_PROCESS_NAME);
    const status = await this.start();
    this.appendEventLog('RESTART', `xiaohongshu mcp restarted (pid=${status.pid})`);
    return status;
  }

  // ── login ────────────────────────────────────────────────────────────────

  async login(): Promise<{ stdout: string; stderr: string; removedCookies: string[]; ok: boolean; error: string }> {
    if (!fileExists(this.loginBinaryPath())) {
      throw new AppError('XHS_LOGIN_BINARY_MISSING', `xiaohongshu login binary not found: ${this.loginBinaryPath()}`, 400);
    }
    await fs.mkdir(this.xhsDataPath(), { recursive: true });
    const removedCookies = await this.clearCookieFiles();
    if (removedCookies.length > 0) {
      this.appendEventLog('LOGIN', `removed stale cookies: ${removedCookies.join(', ')}`);
    }
    this.appendEventLog('LOGIN', 'login command started');
    const result = await this.deps.runner.run(this.loginBinaryPath(), [], { cwd: this.xhsDataPath() });
    this.appendCommandOutput(result.stdout, result.stderr);
    const ok = result.code === 0;
    if (!ok) {
      const errMsg = result.stderr.trim() || `exit ${result.code}`;
      this.appendEventLog('LOGIN_ERROR', errMsg);
      return { stdout: result.stdout, stderr: result.stderr, removedCookies, ok: false, error: errMsg };
    }
    this.appendEventLog('LOGIN', 'login command finished');
    return { stdout: result.stdout, stderr: result.stderr, removedCookies, ok: true, error: '' };
  }

  // ── logs ─────────────────────────────────────────────────────────────────

  async readLogs(lines: number): Promise<{ lines: number; content: string }> {
    try {
      const content = await fs.readFile(this.logPath(), 'utf-8');
      const split = content.split('\n');
      if (split.length <= lines) return { lines, content };
      return { lines, content: split.slice(split.length - lines).join('\n') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { lines, content: '' };
      }
      throw err;
    }
  }

  async clearLogs(): Promise<void> {
    const file = this.logPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '');
    this.appendEventLog('LOG_CLEAR', 'xiaohongshu mcp logs cleared');
  }

  // ── package copy ─────────────────────────────────────────────────────────

  async copyPackage(sourcePath: string | undefined): Promise<{ sourcePath: string; targetPath: string }> {
    const src = sourcePath && sourcePath.trim() !== '' ? sourcePath : this.defaultPackageSource();
    let info: fsSync.Stats;
    try {
      info = fsSync.statSync(src);
    } catch (err) {
      throw new AppError('INVALID_INPUT', `invalid source path: ${(err as Error).message}`, 400);
    }
    if (!info.isDirectory()) {
      throw new AppError('INVALID_INPUT', 'source path must be a directory', 400);
    }
    const target = this.packagePath();
    await fs.rm(target, { recursive: true, force: true });
    copyDir(src, target);
    return { sourcePath: src, targetPath: target };
  }

  // ── claude register ──────────────────────────────────────────────────────

  async registerToClaude(): Promise<{ stdout: string; stderr: string; ok: boolean; error: string }> {
    const r = await this.deps.runner.run('claude', [
      'mcp', 'add', 'xiaohongshu-mcp', '--transport', 'http', 'http://localhost:18060/mcp',
    ]);
    const ok = r.code === 0;
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      ok,
      error: ok ? '' : (r.stderr.trim() || `exit ${r.code}`),
    };
  }

  // ── autostart ────────────────────────────────────────────────────────────

  getAutostart(): { enabled: boolean } {
    return { enabled: this.autostartEnabled };
  }

  async setAutostart(enabled: boolean): Promise<{ enabled: boolean }> {
    this.autostartEnabled = enabled;
    const p = this.autostartSettingsPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ enabled } satisfies AutostartSettings));
    if (enabled) {
      // best-effort immediate check; periodic loop is deferred (see README)
      void this.autostartCheck();
    }
    return { enabled };
  }

  async autostartCheck(): Promise<void> {
    if (!fileExists(this.serverBinaryPath())) return;
    const status = this.deps.processMgr.status(XHS_PROCESS_NAME);
    if (status.running) return;
    try {
      await fs.mkdir(this.xhsDataPath(), { recursive: true });
      await this.deps.processMgr.spawn(XHS_PROCESS_NAME, {
        cmd: this.serverBinaryPath(),
        args: [],
        cwd: this.xhsDataPath(),
      });
    } catch {
      /* swallow */
    }
  }

  private loadAutostartSetting(): boolean {
    try {
      const raw = fsSync.readFileSync(this.autostartSettingsPath(), 'utf-8');
      const parsed = JSON.parse(raw) as AutostartSettings;
      return Boolean(parsed.enabled);
    } catch {
      return false;
    }
  }

  // ── cookies ──────────────────────────────────────────────────────────────

  async detectCookieFile(): Promise<{ hasCookie: boolean; cookieFile: string; error: string }> {
    try {
      const cookies = await this.listCookieFiles();
      if (cookies.length === 0) return { hasCookie: false, cookieFile: '', error: '' };
      return { hasCookie: true, cookieFile: cookies[0]!, error: '' };
    } catch (err) {
      return { hasCookie: false, cookieFile: '', error: (err as Error).message };
    }
  }

  async listCookieFiles(): Promise<string[]> {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(this.xhsDataPath(), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const result: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (entry.name.toLowerCase().includes('cookie')) result.push(entry.name);
    }
    result.sort();
    return result;
  }

  async clearCookieFiles(): Promise<string[]> {
    const cookies = await this.listCookieFiles();
    const removed: string[] = [];
    for (const name of cookies) {
      try {
        fsSync.unlinkSync(this.xhsDataPath(name));
        removed.push(name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return removed;
  }

  // ── health probe ─────────────────────────────────────────────────────────

  async checkHealth(): Promise<{ healthy: boolean; error: string }> {
    if (this.probeCache && Date.now() - this.probeCache.checkedAt < XHS_MCP_PROBE_CACHE_TTL_MS) {
      return { healthy: this.probeCache.healthy, error: this.probeCache.error };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), XHS_MCP_PROBE_TIMEOUT_MS);
    let healthy = false;
    let error = '';
    try {
      const res = await fetch(XHS_MCP_INITIALIZE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 }),
        signal: ctrl.signal,
      });
      healthy = res.ok;
      if (!healthy) error = `mcp endpoint returned ${res.status}`;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      clearTimeout(timer);
    }
    this.probeCache = { checkedAt: Date.now(), healthy, error };
    return { healthy, error };
  }

  // ── log helpers ──────────────────────────────────────────────────────────

  appendEventLog(eventType: string, message: string): void {
    const p = this.logPath();
    try {
      fsSync.mkdirSync(path.dirname(p), { recursive: true });
      const line = `${new Date().toISOString()} [${eventType}] ${message}\n`;
      fsSync.appendFileSync(p, line);
    } catch { /* swallow */ }
  }

  appendCommandOutput(stdout: string, stderr: string): void {
    const p = this.logPath();
    try {
      fsSync.mkdirSync(path.dirname(p), { recursive: true });
      const fd = fsSync.openSync(p, 'a');
      try {
        if (stdout.trim() !== '') {
          fsSync.appendFileSync(fd, stdout);
          if (!stdout.endsWith('\n')) fsSync.appendFileSync(fd, '\n');
        }
        if (stderr.trim() !== '') {
          fsSync.appendFileSync(fd, stderr);
          if (!stderr.endsWith('\n')) fsSync.appendFileSync(fd, '\n');
        }
      } finally {
        fsSync.closeSync(fd);
      }
    } catch { /* swallow */ }
  }
}

function fileExists(p: string): boolean {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}

function mapArch(arch: NodeJS.Architecture): string {
  if (arch === 'x64') return 'amd64';
  return arch;
}

export function parseLinesParameter(value: string | undefined, def: number, max: number): number {
  if (!value) return def;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return def;
  if (parsed > max) return max;
  return parsed;
}

// re-export for test convenience
export { os };
