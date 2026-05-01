import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type { ProcessStatus } from './schema.js';

export const XHS_PROCESS_NAME = 'xiaohongshu-mcp';
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

interface BinaryConfigSettings {
  loginBinaryPath: string;
  serverBinaryPath: string;
}

export class XHSService {
  private autostartEnabled: boolean;
  private probeCache: ProbeCache | null = null;
  private loginBinaryPathOverride = '';
  private serverBinaryPathOverride = '';

  constructor(private readonly deps: Deps) {
    this.autostartEnabled = this.loadAutostartSetting();
    const cfg = this.loadBinaryConfigSync();
    this.loginBinaryPathOverride = cfg.loginBinaryPath;
    this.serverBinaryPathOverride = cfg.serverBinaryPath;
  }

  // ── paths ────────────────────────────────────────────────────────────────

  packagePath(): string {
    return path.join(this.deps.paths.rootDir, 'tool', 'xhs');
  }

  binarySuffix(): string {
    return `${process.platform === 'darwin' ? 'darwin' : process.platform}-${mapArch(process.arch)}`;
  }

  defaultLoginBinaryPath(): string {
    return path.join(this.packagePath(), `xiaohongshu-login-${this.binarySuffix()}`);
  }

  defaultServerBinaryPath(): string {
    return path.join(this.packagePath(), `xiaohongshu-mcp-${this.binarySuffix()}`);
  }

  loginBinaryPath(): string {
    return this.loginBinaryPathOverride;
  }

  serverBinaryPath(): string {
    return this.serverBinaryPathOverride;
  }

  xhsDataPath(...parts: string[]): string {
    return this.deps.paths.dataPath('xhs', ...parts);
  }

  logPath(): string {
    return this.deps.paths.dataPath('logs', `${XHS_PROCESS_NAME}.log`);
  }

  autostartSettingsPath(): string {
    return this.deps.paths.dataPath('xhs-autostart.json');
  }

  binaryConfigPath(): string {
    return this.deps.paths.dataPath('xhs-binary-config.json');
  }

  getBinaryConfig(): { loginBinaryPath: string; serverBinaryPath: string } {
    return {
      loginBinaryPath: this.loginBinaryPathOverride,
      serverBinaryPath: this.serverBinaryPathOverride,
    };
  }

  async saveBinaryConfig(loginBinaryPath: string, serverBinaryPath: string): Promise<void> {
    this.loginBinaryPathOverride = loginBinaryPath.trim();
    this.serverBinaryPathOverride = serverBinaryPath.trim();
    const p = this.binaryConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ loginBinaryPath: this.loginBinaryPathOverride, serverBinaryPath: this.serverBinaryPathOverride } satisfies BinaryConfigSettings));
  }

  private loadBinaryConfigSync(): BinaryConfigSettings {
    try {
      const raw = fsSync.readFileSync(this.binaryConfigPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BinaryConfigSettings>;
      return { loginBinaryPath: parsed.loginBinaryPath ?? '', serverBinaryPath: parsed.serverBinaryPath ?? '' };
    } catch {
      return { loginBinaryPath: '', serverBinaryPath: '' };
    }
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
    if (!this.serverBinaryPathOverride) {
      throw new AppError('XHS_NOT_CONFIGURED', 'server binary path not configured', 400);
    }
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
    if (!this.serverBinaryPathOverride) {
      throw new AppError('XHS_NOT_CONFIGURED', 'server binary path not configured', 400);
    }
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
    if (!this.loginBinaryPathOverride) {
      throw new AppError('XHS_NOT_CONFIGURED', 'login binary path not configured', 400);
    }
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
    if (!this.autostartEnabled) return;
    if (!this.serverBinaryPathOverride) return;
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
    const result = await checkTcpPort(18060, XHS_MCP_PROBE_TIMEOUT_MS);
    this.probeCache = { checkedAt: Date.now(), healthy: result.healthy, error: result.error };
    return result;
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

function checkTcpPort(port: number, timeoutMs: number): Promise<{ healthy: boolean; error: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (healthy: boolean, error: string) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({ healthy, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true, ''));
    socket.once('timeout', () => done(false, 'connection timed out'));
    socket.once('error', (err) => done(false, err.message));
    socket.connect(port, '127.0.0.1');
  });
}

// re-export for test convenience
export { os };
