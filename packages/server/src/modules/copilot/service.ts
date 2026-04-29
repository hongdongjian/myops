import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import NodeCache from 'node-cache';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type {
  ProcessStatus,
  VersionStatus,
  UsageStatus,
  UsageResponse,
  UsageQuotaSnapshot,
  ApiEnvelope,
} from './schema.js';

export const COPILOT_PROCESS_NAME = 'copilot-api';
export const COPILOT_SOURCE_URL = 'https://github.com/caozhiyuan/copilot-api/tree/all';
export const COPILOT_PACKAGE_NAME = '@jeffreycao/copilot-api';
export const COPILOT_USAGE_API_URL = 'http://localhost:4141/usage';
export const COPILOT_USAGE_TIMEOUT_MS = 4000;

const COPILOT_VERSION_CACHE_TTL_SECONDS = 5 * 60;
const COPILOT_VERSION_CACHE_KEY = 'copilot-version';

const versionCache = new NodeCache({ stdTTL: COPILOT_VERSION_CACHE_TTL_SECONDS });

const LIST_VERSION_PATTERN = /@jeffreycao\/copilot-api@([0-9A-Za-z.+_-]+)/;
const VIEW_LATEST_PATTERN = /latest:\s*([0-9A-Za-z.+_-]+)/;

interface AutostartSettings {
  enabled: boolean;
}

interface ProxySettings {
  enabled: boolean;
}

export interface CopilotState {
  autostartEnabled: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
}

export class CopilotService {
  private autostartEnabled: boolean;
  private proxyEnabled: boolean;
  private readonly proxyUrl: string;

  constructor(private readonly deps: Deps) {
    this.proxyUrl = deps.config.copilot_proxy_url ?? '';
    this.autostartEnabled = this.loadAutostartSetting();
    this.proxyEnabled = this.loadProxySetting();
  }

  // ── paths ────────────────────────────────────────────────────────────────

  logPath(): string {
    return this.deps.paths.dataPath('logs', 'copilot-api.log');
  }

  configPath(): string {
    return this.deps.paths.confPath('copilot-api', 'config.json');
  }

  actualConfigPath(): string {
    return path.join(this.deps.paths.homeDir, '.local', 'share', 'copilot-api', 'config.json');
  }

  autostartSettingsPath(): string {
    return this.deps.paths.dataPath('copilot-autostart.json');
  }

  proxySettingsPath(): string {
    return this.deps.paths.dataPath('copilot-proxy.json');
  }

  // ── status / lifecycle ───────────────────────────────────────────────────

  async getStatus(): Promise<{
    process: ProcessStatus;
    health: { healthy: boolean; state: string };
    version: VersionStatus;
    auth: null;
    sourceUrl: string;
  }> {
    const procStatus = this.getProcessStatus();
    const version = await this.resolveVersionStatus();
    const health = {
      healthy: procStatus.running,
      state: procStatus.running ? 'ACTIVE' : 'ERROR',
    };
    return {
      process: procStatus,
      health,
      version,
      auth: null,
      sourceUrl: COPILOT_SOURCE_URL,
    };
  }

  getProcessStatus(): ProcessStatus {
    const status = this.deps.processMgr.status(COPILOT_PROCESS_NAME);
    if (!status.running) {
      return {
        name: COPILOT_PROCESS_NAME,
        running: false,
        pid: 0,
        logPath: '',
        command: '',
        args: [],
        startedAt: '',
      };
    }
    return {
      name: COPILOT_PROCESS_NAME,
      running: true,
      pid: status.pid ?? 0,
      logPath: this.logPath(),
      command: 'copilot-api',
      args: this.startArgs(),
      startedAt: status.startedAt ? new Date(status.startedAt).toISOString() : '',
    };
  }

  async startProcess(): Promise<ProcessStatus> {
    const env = this.startEnv();
    await this.deps.processMgr.spawn(COPILOT_PROCESS_NAME, {
      cmd: 'copilot-api',
      args: this.startArgs(),
      env: env ?? undefined,
      stripClaudeCode: false,
    });
    return this.getProcessStatus();
  }

  async stopProcess(): Promise<boolean> {
    const before = this.deps.processMgr.status(COPILOT_PROCESS_NAME);
    await this.deps.processMgr.stop(COPILOT_PROCESS_NAME);
    return before.running;
  }

  async restart(): Promise<ProcessStatus> {
    const version = await this.resolveVersionStatus();
    if (!version.installed) {
      throw new AppError('COPILOT_NOT_INSTALLED', 'copilot-api is not installed', 400);
    }
    this.appendEventLog('RESTART', 'restart requested');
    await this.deps.processMgr.stop(COPILOT_PROCESS_NAME);
    const status = await this.startProcess();
    this.appendEventLog('RESTART', `copilot-api restarted (pid=${status.pid})`);
    return status;
  }

  startArgs(): string[] {
    const args = ['start'];
    if (this.proxyEnabled) args.push('--proxy-env');
    return args;
  }

  startEnv(): Record<string, string> | null {
    if (!this.proxyEnabled || this.proxyUrl === '') return null;
    return {
      HTTP_PROXY: this.proxyUrl,
      HTTPS_PROXY: this.proxyUrl,
      http_proxy: this.proxyUrl,
      https_proxy: this.proxyUrl,
    };
  }

  // ── upgrade / install ────────────────────────────────────────────────────

  async upgrade(): Promise<ApiEnvelope<Record<string, unknown>>> {
    clearVersionCache();
    const current = await this.resolveVersionStatus();

    if (!current.installed) {
      this.appendEventLog('INSTALL', 'install started');
      const install = await this.deps.runner.run('npm', ['install', '-g', COPILOT_PACKAGE_NAME]);
      clearVersionCache();
      const installErr = install.code === 0 ? '' : install.stderr.trim() || `exit ${install.code}`;
      const payload = {
        install: { stdout: install.stdout, stderr: install.stderr, error: installErr },
        version: await this.resolveVersionStatus(),
      };
      if (installErr !== '') {
        this.appendEventLog('INSTALL_ERROR', installErr);
        return { success: false, error: 'copilot-api install failed', data: payload };
      }
      this.appendEventLog('INSTALL', 'install finished successfully');
      return { success: true, message: 'copilot-api installed', data: payload };
    }

    this.appendEventLog('UPGRADE', 'upgrade started');
    const uninstall = await this.deps.runner.run('npm', ['uninstall', '-g', COPILOT_PACKAGE_NAME]);
    const install = await this.deps.runner.run('npm', ['install', '-g', COPILOT_PACKAGE_NAME]);
    clearVersionCache();

    const uninstallErr = uninstall.code === 0 ? '' : uninstall.stderr.trim() || `exit ${uninstall.code}`;
    const installErr = install.code === 0 ? '' : install.stderr.trim() || `exit ${install.code}`;
    const payload = {
      uninstall: { stdout: uninstall.stdout, stderr: uninstall.stderr, error: uninstallErr },
      install: { stdout: install.stdout, stderr: install.stderr, error: installErr },
      version: await this.resolveVersionStatus(),
    };

    if (installErr !== '') {
      this.appendEventLog('UPGRADE_ERROR', installErr);
      return { success: false, error: 'copilot-api upgrade failed', data: payload };
    }

    this.appendEventLog('UPGRADE', 'upgrade finished successfully');
    return { success: true, message: 'copilot-api upgraded', data: payload };
  }

  // ── logs ─────────────────────────────────────────────────────────────────

  async readLogs(linesParam: string | undefined): Promise<{ lines: number; content: string }> {
    const lines = parseLinesParameter(linesParam, 300, 3000);
    const file = this.logPath();
    try {
      const content = await fs.readFile(file, 'utf-8');
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
    this.appendEventLog('LOG_CLEAR', 'copilot-api logs cleared');
  }

  // ── usage ────────────────────────────────────────────────────────────────

  async fetchUsage(): Promise<UsageStatus> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COPILOT_USAGE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(COPILOT_USAGE_API_URL, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AppError('COPILOT_USAGE_FAILED', `usage endpoint returned ${res.status}`, 502);
    }
    const payload = (await res.json()) as UsageResponse;
    const snapshot = chooseUsageSnapshot(payload.quota_snapshots ?? {});
    if (!snapshot) {
      throw new AppError('COPILOT_USAGE_FAILED', 'usage snapshot is missing', 502);
    }
    let total = snapshot.entitlement;
    let remaining = snapshot.remaining;
    let used = total - remaining;
    if (used < 0) used = 0;
    let percentUsed = 100 - snapshot.percent_remaining;
    if (snapshot.unlimited) {
      total = 0;
      used = 0;
      remaining = 0;
      percentUsed = 0;
    }
    return {
      quotaId: snapshot.quota_id,
      used,
      total,
      remaining,
      percentUsed: clampPercent(percentUsed),
      unlimited: snapshot.unlimited,
      resetDate: payload.quota_reset_date ?? '',
    };
  }

  // ── config ───────────────────────────────────────────────────────────────

  async readConfig(): Promise<{ path: string; content: string; exists: boolean; message?: string }> {
    const p = this.configPath();
    try {
      const content = await fs.readFile(p, 'utf-8');
      return { path: p, content, exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: p, content: '', exists: false, message: 'copilot config does not exist yet' };
      }
      throw err;
    }
  }

  async saveConfig(content: string): Promise<{ path: string; size: number }> {
    if (content.trim() === '') {
      throw new AppError('INVALID_INPUT', 'content is required', 400);
    }
    try {
      JSON.parse(content);
    } catch {
      throw new AppError('INVALID_INPUT', 'config content must be valid JSON', 400);
    }
    const p = this.configPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return { path: p, size: Buffer.byteLength(content) };
  }

  async configSyncStatus(): Promise<{ synced: boolean; localExists: boolean }> {
    let local: string | null = null;
    let actual: string | null = null;
    try {
      local = await fs.readFile(this.configPath(), 'utf-8');
    } catch { /* missing */ }
    try {
      actual = await fs.readFile(this.actualConfigPath(), 'utf-8');
    } catch { /* missing */ }
    return {
      synced: local !== null && actual !== null && local === actual,
      localExists: local !== null,
    };
  }

  async configSync(): Promise<void> {
    let local: string;
    try {
      local = await fs.readFile(this.configPath(), 'utf-8');
    } catch {
      throw new AppError('CONFIG_MISSING', '本地配置不存在，请先保存配置', 400);
    }
    const target = this.actualConfigPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, local);
  }

  // ── source ───────────────────────────────────────────────────────────────

  getSource(): { url: string } {
    return { url: COPILOT_SOURCE_URL };
  }

  // ── autostart ────────────────────────────────────────────────────────────

  getAutostart(): { enabled: boolean } {
    return { enabled: this.autostartEnabled };
  }

  async setAutostart(enabled: boolean): Promise<{ enabled: boolean }> {
    this.autostartEnabled = enabled;
    await this.persistAutostart(enabled);
    return { enabled };
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

  private async persistAutostart(enabled: boolean): Promise<void> {
    const p = this.autostartSettingsPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ enabled }));
  }

  // ── proxy ────────────────────────────────────────────────────────────────

  getProxy(): { enabled: boolean; proxyURL: string } {
    return { enabled: this.proxyEnabled, proxyURL: this.proxyUrl };
  }

  async setProxy(enabled: boolean): Promise<{ enabled: boolean; proxyURL: string; restarted: boolean }> {
    this.proxyEnabled = enabled;
    await this.persistProxy(enabled);
    let restarted = false;
    const status = this.deps.processMgr.status(COPILOT_PROCESS_NAME);
    if (status.running) {
      this.appendEventLog('PROXY_RESTART', `proxy changed to enabled=${enabled}, restarting`);
      try {
        await this.deps.processMgr.stop(COPILOT_PROCESS_NAME);
        await this.startProcess();
        restarted = true;
      } catch (err) {
        this.appendEventLog('PROXY_RESTART_ERROR', (err as Error).message);
      }
    }
    return { enabled, proxyURL: this.proxyUrl, restarted };
  }

  private loadProxySetting(): boolean {
    try {
      const raw = fsSync.readFileSync(this.proxySettingsPath(), 'utf-8');
      const parsed = JSON.parse(raw) as ProxySettings;
      return Boolean(parsed.enabled);
    } catch {
      return false;
    }
  }

  private async persistProxy(enabled: boolean): Promise<void> {
    const p = this.proxySettingsPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ enabled }));
  }

  // ── version ──────────────────────────────────────────────────────────────

  async resolveVersionStatus(): Promise<VersionStatus> {
    const cached = versionCache.get<VersionStatus>(COPILOT_VERSION_CACHE_KEY);
    if (cached) return cached;
    const list = await this.deps.runner.run('npm', ['list', '-g', COPILOT_PACKAGE_NAME]);
    const view = await this.deps.runner.run('npm', ['view', COPILOT_PACKAGE_NAME]);
    const result = buildVersionStatus(
      `${list.stdout}\n${list.stderr}`,
      list.code === 0 ? null : list.stderr.trim() || `exit ${list.code}`,
      `${view.stdout}\n${view.stderr}`,
      view.code === 0 ? null : view.stderr.trim() || `exit ${view.code}`,
    );
    versionCache.set(COPILOT_VERSION_CACHE_KEY, result);
    return result;
  }

  // ── log helper ───────────────────────────────────────────────────────────

  appendEventLog(eventType: string, message: string): void {
    const p = this.logPath();
    try {
      fsSync.mkdirSync(path.dirname(p), { recursive: true });
      const line = `${new Date().toISOString()} [${eventType}] ${message}\n`;
      fsSync.appendFileSync(p, line);
    } catch {
      /* swallow logging errors */
    }
  }
}

export function clearVersionCache(): void {
  versionCache.del(COPILOT_VERSION_CACHE_KEY);
}

export function chooseUsageSnapshot(
  snapshots: Record<string, UsageQuotaSnapshot>,
): UsageQuotaSnapshot | null {
  if (!snapshots || Object.keys(snapshots).length === 0) return null;
  const premium = snapshots.premium_interactions;
  if (premium) return premium;
  for (const k of Object.keys(snapshots)) {
    const v = snapshots[k];
    if (v) return v;
  }
  return null;
}

export function parseVersionFromNPMListOutput(raw: string): string {
  const m = raw.match(LIST_VERSION_PATTERN);
  return m && m[1] ? m[1].trim() : '';
}

export function parseLatestVersionFromNPMView(raw: string): string {
  const latest = raw.match(VIEW_LATEST_PATTERN);
  if (latest && latest[1]) return latest[1].trim();
  const headline = raw.match(LIST_VERSION_PATTERN);
  if (headline && headline[1]) return headline[1].trim();
  return '';
}

export function buildVersionStatus(
  currentOutput: string,
  currentErr: string | null,
  latestOutput: string,
  latestErr: string | null,
): VersionStatus {
  const current = parseVersionFromNPMListOutput(currentOutput);
  const latest = parseLatestVersionFromNPMView(latestOutput);
  const checkErrors: string[] = [];
  if (current === '' && latest === '' && currentErr) checkErrors.push(`current: ${currentErr}`);
  if (latest === '' && latestErr) checkErrors.push(`latest: ${latestErr}`);
  const canUpgrade = current !== '' && latest !== '' && current !== latest;
  const result: VersionStatus = {
    installed: current !== '',
    current,
    latest,
    canUpgrade,
    upgradeTarget: canUpgrade ? latest : '',
  };
  if (checkErrors.length > 0) result.checkError = checkErrors.join(' | ');
  return result;
}

export function parseLinesParameter(value: string | undefined, def: number, max: number): number {
  if (!value) return def;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return def;
  if (parsed > max) return max;
  return parsed;
}

export function clampPercent(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
