import NodeCache from 'node-cache';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { ClaudeSettingsService, MODEL_ENV_KEYS } from '../claude-settings/service.js';
import type { VersionOperationStatus, VersionStatus } from './schema.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
export const CLAUDE_UPDATE_COMMAND = 'claude update';
export const CLAUDE_VERSION_COMMAND = 'claude --version';
export const CLAUDE_LATEST_COMMAND = 'npm view @anthropic-ai/claude-code@latest';

const CACHE_TTL_SECONDS = 5 * 60;
const CACHE_KEY = 'claude-version';

const versionCache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS });

const CURRENT_VERSION_PATTERN = /^([0-9]+(?:\.[0-9A-Za-z.+_-]+)+)(?:\s+\(.*\))?\s*$/m;
const LATEST_VERSION_PATTERN = /@anthropic-ai\/claude-code@([0-9A-Za-z.+_-]+)/;
const LATEST_DIST_TAG_PATTERN = /^latest:\s*([0-9A-Za-z.+_-]+)\s*$/m;

interface OperationState {
  running: boolean;
  action: string;
  startedAt: number;
}

export class ClaudeVersionService {
  private op: OperationState = { running: false, action: '', startedAt: 0 };

  constructor(private readonly deps: Deps) {}

  currentOperation(): VersionOperationStatus | null {
    if (!this.op.running) return null;
    return {
      running: true,
      action: this.op.action || undefined,
      startedAt: this.op.startedAt ? new Date(this.op.startedAt).toISOString() : undefined,
    };
  }

  begin(action: string): boolean {
    if (this.op.running) return false;
    this.op = { running: true, action, startedAt: Date.now() };
    return true;
  }

  finish(): void {
    this.op = { running: false, action: '', startedAt: 0 };
  }

  clearCache(): void {
    versionCache.del(CACHE_KEY);
  }

  async getStatus(): Promise<VersionStatus> {
    const status = await this.resolveStatus();
    return { ...status, operation: this.currentOperation() };
  }

  async resolveStatus(): Promise<VersionStatus> {
    const cached = versionCache.get<VersionStatus>(CACHE_KEY);
    if (cached) return cached;
    if (!this.deps.runner) {
      const r: VersionStatus = {
        installed: false,
        current: '',
        latest: '',
        canUpgrade: false,
        upgradeTarget: '',
        checkError: 'runner is not configured',
      };
      versionCache.set(CACHE_KEY, r);
      return r;
    }
    const current = await this.runShell(CLAUDE_VERSION_COMMAND);
    const latest = await this.runShell(CLAUDE_LATEST_COMMAND);
    const result = buildVersionStatus(
      `${current.stdout}\n${current.stderr}`,
      current.code === 0 ? null : current.stderr.trim() || `exit ${current.code}`,
      `${latest.stdout}\n${latest.stderr}`,
      latest.code === 0 ? null : latest.stderr.trim() || `exit ${latest.code}`,
    );
    versionCache.set(CACHE_KEY, result);
    return result;
  }

  async upgrade(): Promise<{
    payload: Record<string, unknown>;
    ok: boolean;
    message: string;
    actionKey: 'upgrade' | 'install';
  }> {
    if (!this.deps.runner) {
      throw new AppError('RUNNER_MISSING', 'runner is not configured', 500);
    }
    if (this.currentOperation()) {
      throw new AppError('CONFLICT', 'claude upgrade already in progress', 409);
    }
    this.clearCache();
    const before = await this.resolveStatus();
    const command = before.installed ? CLAUDE_UPDATE_COMMAND : CLAUDE_INSTALL_COMMAND;
    const actionKey: 'upgrade' | 'install' = before.installed ? 'upgrade' : 'install';
    const actionLabel = actionKey === 'install' ? 'installed' : 'upgraded';

    if (!this.begin(actionKey)) {
      throw new AppError('CONFLICT', 'claude upgrade already in progress', 409);
    }
    let actionResult: { stdout: string; stderr: string; code: number };
    let actionErrText = '';
    try {
      actionResult = await this.runShell(command);
      if (actionResult.code !== 0) {
        actionErrText = actionResult.stderr.trim() || `exit ${actionResult.code}`;
      }
    } finally {
      this.finish();
    }

    if (actionErrText === '' && actionKey === 'install') {
      await this.postInstallSetup();
    }

    this.clearCache();
    const after = await this.resolveStatus();

    const payload: Record<string, unknown> = {
      [actionKey]: {
        stdout: actionResult.stdout,
        stderr: actionResult.stderr,
        error: actionErrText,
      },
      version: { ...after, operation: this.currentOperation() },
    };
    if (actionErrText !== '') {
      return { payload, ok: false, message: `claude ${actionKey} failed`, actionKey };
    }
    let message = `claude ${actionLabel}`;
    if (
      actionKey === 'upgrade' &&
      before.current !== '' &&
      after.current !== '' &&
      before.current === after.current &&
      !before.canUpgrade
    ) {
      message = 'claude already up to date';
    }
    return { payload, ok: true, message, actionKey };
  }

  private runShell(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return this.deps.runner.run('/bin/bash', ['-lc', command]);
  }

  private async postInstallSetup(): Promise<void> {
    // mirrors Go App.postInstallSetup: copy template settings, mark onboarding complete
    const settings = new ClaudeSettingsService(this.deps);
    const templatePath = settings.templatePath();
    const settingsPath = settings.settingsPath();
    try {
      const tmpl = await fs.readFile(templatePath, 'utf-8');
      let body = tmpl;
      if (!settings.isRenderModelEnvEnabled()) {
        try {
          const obj = JSON.parse(tmpl) as Record<string, unknown>;
          const env = (obj.env as Record<string, unknown> | undefined) ?? {};
          for (const key of MODEL_ENV_KEYS) delete env[key];
          obj.env = env;
          body = JSON.stringify(obj, null, 2);
        } catch {
          /* leave body as-is */
        }
      }
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, body);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await settings.skipOnboarding();
    } catch {
      /* swallow */
    }
  }
}

export function parseCurrentVersionOutput(raw: string): string {
  const m = raw.match(CURRENT_VERSION_PATTERN);
  if (!m || !m[1]) return '';
  return m[1].trim();
}

export function parseLatestVersionOutput(raw: string): string {
  const tag = raw.match(LATEST_DIST_TAG_PATTERN);
  if (tag && tag[1]) return tag[1].trim();
  const head = raw.match(LATEST_VERSION_PATTERN);
  if (head && head[1]) return head[1].trim();
  return parseCurrentVersionOutput(raw);
}

export function buildVersionStatus(
  currentOutput: string,
  currentErr: string | null,
  latestOutput: string,
  latestErr: string | null,
): VersionStatus {
  const current = parseCurrentVersionOutput(currentOutput);
  const latest = parseLatestVersionOutput(latestOutput);
  const errors: string[] = [];
  if (current === '' && latest === '' && currentErr) errors.push(`current: ${currentErr}`);
  if (latest === '' && latestErr) errors.push(`latest: ${latestErr}`);
  const canUpgrade = current !== '' && latest !== '' && current !== latest;
  const result: VersionStatus = {
    installed: current !== '',
    current,
    latest,
    canUpgrade,
    upgradeTarget: canUpgrade ? latest : '',
  };
  if (errors.length > 0) result.checkError = errors.join(' | ');
  return result;
}

export function clearClaudeVersionCache(): void {
  versionCache.del(CACHE_KEY);
}
