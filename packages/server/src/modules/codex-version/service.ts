import NodeCache from 'node-cache';
import type { Deps } from '../../deps.js';
import type { CodexVersionStatus } from './schema.js';

export const CODEX_PACKAGE_NAME = '@openai/codex';
const CACHE_TTL_SECONDS = 5 * 60;
const CACHE_KEY = 'codex-version';

const versionCache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS });

const CLI_PATTERN = /(?:^|\s)(?:codex-cli|codex)\s+([0-9A-Za-z.+_-]+)(?:\s|$)/;
const NPM_LIST_PATTERN = /@openai\/codex@([0-9A-Za-z.+_-]+)/;
const PLAIN_PATTERN = /^v?([0-9]+(?:\.[0-9A-Za-z.+_-]+)+)\s*$/m;

export function parseCodexVersionOutput(raw: string): string {
  let m = raw.match(CLI_PATTERN);
  if (m && m[1]) return m[1].trim();
  m = raw.match(NPM_LIST_PATTERN);
  if (m && m[1]) return m[1].trim();
  m = raw.match(PLAIN_PATTERN);
  if (m && m[1]) return m[1].trim();
  return '';
}

export function buildCodexVersionStatus(
  cliOutput: string,
  cliErr: string | null,
  npmListOutput: string,
  npmListErr: string | null,
  npmViewOutput: string,
  npmViewErr: string | null,
): CodexVersionStatus {
  let current = parseCodexVersionOutput(cliOutput);
  if (current === '') current = parseCodexVersionOutput(npmListOutput);
  const latest = parseCodexVersionOutput(npmViewOutput);

  const checkErrors: string[] = [];
  if (current === '' && latest === '') {
    const sub: string[] = [];
    if (cliErr) sub.push(`cli: ${cliErr}`);
    if (npmListErr) sub.push(`npm: ${npmListErr}`);
    if (sub.length > 0) checkErrors.push(`current: ${sub.join(', ')}`);
  }
  if (latest === '' && npmViewErr) checkErrors.push(`latest: ${npmViewErr}`);

  const canUpgrade = current !== '' && latest !== '' && current !== latest;
  const result: CodexVersionStatus = {
    installed: current !== '',
    current,
    latest,
    canUpgrade,
    upgradeTarget: canUpgrade ? latest : '',
  };
  if (checkErrors.length > 0) result.checkError = checkErrors.join(' | ');
  return result;
}

export function clearCodexVersionCache(): void {
  versionCache.del(CACHE_KEY);
}

export interface CodexUpgradeHooks {
  postInstallSetup?(): Promise<void>;
}

export class CodexVersionService {
  constructor(
    private readonly deps: Deps,
    private readonly hooks: CodexUpgradeHooks = {},
  ) {}

  async getStatus(): Promise<CodexVersionStatus> {
    const cached = versionCache.get<CodexVersionStatus>(CACHE_KEY);
    if (cached) return cached;
    if (!this.deps.runner) {
      const r: CodexVersionStatus = {
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
    const cli = await this.deps.runner.run('codex', ['--version']);
    const npmList = await this.deps.runner.run('npm', ['list', '-g', CODEX_PACKAGE_NAME, '--depth=0']);
    const npmView = await this.deps.runner.run('npm', ['view', CODEX_PACKAGE_NAME, 'version']);
    const status = buildCodexVersionStatus(
      `${cli.stdout}\n${cli.stderr}`,
      cli.code === 0 ? null : cli.stderr.trim() || `exit ${cli.code}`,
      `${npmList.stdout}\n${npmList.stderr}`,
      npmList.code === 0 ? null : npmList.stderr.trim() || `exit ${npmList.code}`,
      `${npmView.stdout}\n${npmView.stderr}`,
      npmView.code === 0 ? null : npmView.stderr.trim() || `exit ${npmView.code}`,
    );
    versionCache.set(CACHE_KEY, status);
    return status;
  }

  async upgrade(): Promise<{ payload: Record<string, unknown>; ok: boolean; message: string }> {
    if (!this.deps.runner) {
      return {
        payload: { install: { stdout: '', stderr: '', error: 'runner is not configured' }, version: { installed: false, current: '', latest: '', canUpgrade: false, upgradeTarget: '' } },
        ok: false,
        message: 'codex upgrade failed',
      };
    }
    clearCodexVersionCache();
    const before = await this.getStatus();
    const install = await this.deps.runner.run('npm', ['install', '-g', `${CODEX_PACKAGE_NAME}@latest`]);
    const installErr = install.code === 0 ? '' : install.stderr.trim() || `exit ${install.code}`;
    if (installErr === '' && !before.installed) {
      try {
        await this.hooks.postInstallSetup?.();
      } catch {
        /* swallow */
      }
    }
    clearCodexVersionCache();
    const after = await this.getStatus();
    const payload: Record<string, unknown> = {
      install: { stdout: install.stdout, stderr: install.stderr, error: installErr },
      version: after,
    };
    if (installErr !== '') {
      return {
        payload,
        ok: false,
        message: before.installed ? 'codex upgrade failed' : 'codex install failed',
      };
    }
    let message = before.installed ? 'codex upgraded' : 'codex installed';
    if (
      before.installed &&
      before.current !== '' &&
      after.current !== '' &&
      before.current === after.current &&
      !before.canUpgrade
    ) {
      message = 'codex already up to date';
    }
    return { payload, ok: true, message };
  }
}
