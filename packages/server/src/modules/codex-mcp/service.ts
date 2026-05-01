import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { setTomlRawValue, formatTomlInlineTable } from '../../core/toml/index.js';
import type {
  CodexMCPActiveOp,
  CodexMCPOpAction,
  CodexMCPPresetCreateRequest,
  CodexMCPPresetUpdateRequest,
  CodexMCPPresetDefinition,
  CodexMCPPresetInstallConfig,
  CodexMCPPresetStatus,
} from './schema.js';

interface CodexMCPListItem {
  name?: string;
  transport?: {
    type?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string> | null;
    bearer_token_env_var?: string | null;
    http_headers?: Record<string, string> | null;
  } | null;
}

function listItemToInstallConfig(item: CodexMCPListItem): CodexMCPPresetInstallConfig | null {
  const t = item.transport;
  if (!t) return null;
  if (t.type === 'stdio') {
    const cmd: string[] = [];
    if (t.command) cmd.push(t.command);
    if (Array.isArray(t.args)) cmd.push(...t.args);
    if (cmd.length === 0) return null;
    const env: Record<string, string> = {};
    if (t.env && typeof t.env === 'object') {
      for (const [k, v] of Object.entries(t.env)) {
        if (typeof v === 'string') env[k] = v;
      }
    }
    return { command: cmd, env: Object.keys(env).length > 0 ? env : undefined };
  }
  if (t.url) {
    const headers: string[] = [];
    if (t.http_headers && typeof t.http_headers === 'object') {
      for (const [k, v] of Object.entries(t.http_headers)) {
        headers.push(`${k}: ${v}`);
      }
    }
    return {
      url: t.url,
      headers: headers.length > 0 ? headers : undefined,
      bearerTokenEnvVar: t.bearer_token_env_var ?? undefined,
    };
  }
  return null;
}

export class CodexMCPService {
  private readonly activeOps = new Map<string, CodexMCPActiveOp>();

  constructor(private readonly deps: Deps) {}

  private startOp(name: string, action: CodexMCPOpAction): void {
    this.activeOps.set(name, { name, action, startedAt: Date.now() });
  }

  private endOp(name: string): void {
    this.activeOps.delete(name);
  }

  presetConfigPath(): string {
    return this.deps.paths.confPath('codex', 'mcp-presets.json');
  }

  configPath(): string {
    return this.deps.paths.codexPath('config.toml');
  }

  async list(): Promise<Record<string, unknown>> {
    const presets = await this.loadPresets();
    const { names: installedNames, configs: installedConfigs } = await this.listInstalled();

    const installedSet = new Set(installedNames);
    const supportedSet = new Set(presets.map((p) => p.name));

    const supported: CodexMCPPresetStatus[] = presets.map((preset) => ({
      name: preset.name,
      description: preset.description,
      install: preset.install,
      installed: installedSet.has(preset.name),
    }));

    const userPath = this.configPath();
    let userExists = false;
    try {
      await fs.stat(userPath);
      userExists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AppError('STAT_FAILED', (err as Error).message, 500);
      }
    }

    const otherNames = installedNames.filter((n) => !supportedSet.has(n)).sort();
    const otherConfigs: Record<string, CodexMCPPresetInstallConfig> = {};
    for (const name of otherNames) {
      const cfg = installedConfigs.get(name);
      if (cfg) otherConfigs[name] = cfg;
    }

    return {
      paths: { user: userPath, userExists },
      installed: { user: installedNames },
      supported,
      others: { user: otherNames },
      otherConfigs,
      activeOps: Array.from(this.activeOps.values()),
    };
  }

  async presetInstall(rawName: string): Promise<{ name: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);

    const presets = await this.loadPresets();
    const preset = presets.find((p) => p.name === name);
    if (!preset) throw new AppError('INVALID_INPUT', `unsupported preset mcp: ${name}`, 400);

    this.startOp(name, 'installing');
    try {
      const args = buildPresetInstallArgs(preset);
      const r = await this.deps.runner.run('codex', args, { cwd: this.deps.paths.rootDir });

      let ok = r.code === 0;
      if (!ok && isAlreadyExists(r.stdout, r.stderr)) ok = true;

      let error = ok ? '' : commandError(r.code, r.stdout, r.stderr);

      if (ok) {
        try {
          await this.applyPresetHTTPHeaders(name, preset.install);
        } catch (err) {
          ok = false;
          error = (err as Error).message;
        }
      }

      return { name, stdout: r.stdout, stderr: r.stderr, ok, error };
    } finally {
      this.endOp(name);
    }
  }

  async presetRemove(rawName: string): Promise<{ name: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);

    this.startOp(name, 'uninstalling');
    try {
      const r = await this.deps.runner.run('codex', ['mcp', 'remove', name], { cwd: this.deps.paths.rootDir });
      let ok = r.code === 0;
      if (!ok && isNotFound(r.stdout, r.stderr)) ok = true;

      return {
        name,
        stdout: r.stdout,
        stderr: r.stderr,
        ok,
        error: ok ? '' : commandError(r.code, r.stdout, r.stderr),
      };
    } finally {
      this.endOp(name);
    }
  }

  // ── preset CRUD ──────────────────────────────────────────────────────────

  async createPreset(req: CodexMCPPresetCreateRequest): Promise<void> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresets();
    if (presets.some((p) => p.name === name)) {
      throw new AppError('DUPLICATE_PRESET', `codex mcp preset already exists: ${name}`, 400);
    }
    const preset: CodexMCPPresetDefinition = {
      name,
      description: (req.description ?? '').trim(),
      install: buildInstallConfig(req),
    };
    await this.savePresets([...presets, preset]);
  }

  async updatePreset(req: CodexMCPPresetUpdateRequest): Promise<{ reinstalled: boolean; reinstallError: string }> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresets();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx === -1) throw new AppError('NOT_FOUND', `codex mcp preset not found: ${name}`, 404);
    const updated: CodexMCPPresetDefinition = {
      name,
      description: (req.description ?? '').trim(),
      install: buildInstallConfig(req),
    };

    const { names: installedNames } = await this.listInstalled();
    const wasInstalled = installedNames.includes(name);

    await this.savePresets(presets.map((p, i) => (i === idx ? updated : p)));

    if (!wasInstalled) return { reinstalled: false, reinstallError: '' };

    const removeR = await this.deps.runner.run('codex', ['mcp', 'remove', name], { cwd: this.deps.paths.rootDir });
    if (removeR.code !== 0) {
      return { reinstalled: false, reinstallError: `remove failed: ${commandError(removeR.code, removeR.stdout, removeR.stderr)}` };
    }

    const installArgs = buildPresetInstallArgs(updated);
    const installR = await this.deps.runner.run('codex', installArgs, { cwd: this.deps.paths.rootDir });
    const ok = installR.code === 0;
    return {
      reinstalled: ok,
      reinstallError: ok ? '' : `install failed: ${commandError(installR.code, installR.stdout, installR.stderr)}`,
    };
  }

  async deletePreset(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresets();
    const next = presets.filter((p) => p.name !== trimmed);
    if (next.length === presets.length) {
      throw new AppError('NOT_FOUND', `codex mcp preset not found: ${trimmed}`, 404);
    }
    await this.savePresets(next);
  }

  private async savePresets(presets: CodexMCPPresetDefinition[]): Promise<void> {
    const p = this.presetConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(presets, null, 2));
  }

  async loadPresets(): Promise<CodexMCPPresetDefinition[]> {
    const p = this.presetConfigPath();
    let content: string;
    try {
      content = await fs.readFile(p, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new AppError('PRESET_READ_FAILED', `failed to read codex mcp preset config: ${(err as Error).message}`, 500);
    }
    let presets: CodexMCPPresetDefinition[];
    try {
      presets = JSON.parse(content) as CodexMCPPresetDefinition[];
    } catch (err) {
      throw new AppError('PRESET_PARSE_FAILED', `invalid codex mcp preset config JSON: ${(err as Error).message}`, 500);
    }
    if (!Array.isArray(presets)) {
      throw new AppError('PRESET_INVALID', 'codex mcp preset config must be an array', 500);
    }

    const seen = new Set<string>();
    presets.forEach((preset, index) => {
      const name = (preset?.name ?? '').trim();
      if (name === '') {
        throw new AppError('PRESET_INVALID', `codex mcp preset config item[${index}] name is required`, 500);
      }
      if (seen.has(name)) {
        throw new AppError('PRESET_INVALID', `duplicate codex mcp preset name: ${name}`, 500);
      }
      seen.add(name);

      const install = preset.install ?? ({} as CodexMCPPresetInstallConfig);
      const hasURL = (install.url ?? '').trim() !== '';
      const hasCommand = Array.isArray(install.command) && install.command.length > 0;
      if (!hasURL && !hasCommand) {
        throw new AppError('PRESET_INVALID', `codex mcp preset ${name} must define install.url or install.command`, 500);
      }
      if (hasURL && hasCommand) {
        throw new AppError('PRESET_INVALID', `codex mcp preset ${name} install.url and install.command cannot both be set`, 500);
      }
    });
    return presets;
  }

  async listInstalledNames(): Promise<string[]> {
    const { names } = await this.listInstalled();
    return names;
  }

  async listInstalled(): Promise<{ names: string[]; configs: Map<string, CodexMCPPresetInstallConfig> }> {
    const r = await this.deps.runner.run('codex', ['mcp', 'list', '--json'], { cwd: this.deps.paths.rootDir });
    if (r.code !== 0) {
      throw new AppError('CODEX_MCP_LIST_FAILED', `failed to run codex mcp list: ${commandError(r.code, r.stdout, r.stderr)}`, 500);
    }
    let items: CodexMCPListItem[];
    try {
      items = JSON.parse(r.stdout) as CodexMCPListItem[];
    } catch (err) {
      throw new AppError('CODEX_MCP_LIST_PARSE_FAILED', `invalid JSON from codex mcp list: ${(err as Error).message}`, 500);
    }
    if (!Array.isArray(items)) return { names: [], configs: new Map() };
    const names: string[] = [];
    const configs = new Map<string, CodexMCPPresetInstallConfig>();
    for (const item of items) {
      const name = (item?.name ?? '').trim();
      if (name === '') continue;
      names.push(name);
      const cfg = listItemToInstallConfig(item);
      if (cfg) configs.set(name, cfg);
    }
    names.sort();
    return { names, configs };
  }

  private async applyPresetHTTPHeaders(name: string, install: CodexMCPPresetInstallConfig): Promise<void> {
    if ((install.url ?? '').trim() === '' || !install.headers || install.headers.length === 0) return;
    const headers = parseCodexMCPHeaders(install.headers);
    if (Object.keys(headers).length === 0) return;

    const configPath = this.configPath();
    let content = '';
    try {
      content = await fs.readFile(configPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AppError('CODEX_CONFIG_READ_FAILED', `failed to read codex config: ${(err as Error).message}`, 500);
      }
    }

    const section = `mcp_servers.${name}`;
    const result = setTomlRawValue(content, section, 'http_headers', formatTomlInlineTable(headers), true);

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, result.content);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

export function parseCodexMCPHeaders(headers: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const header of headers) {
    const trimmed = header.trim();
    if (trimmed === '') continue;
    const index = trimmed.indexOf(':');
    if (index <= 0) {
      throw new AppError('INVALID_HEADER', `header must be in KEY: VALUE format: ${JSON.stringify(header)}`, 400);
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key === '') {
      throw new AppError('INVALID_HEADER', `header key is required: ${JSON.stringify(header)}`, 400);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function buildPresetInstallArgs(preset: CodexMCPPresetDefinition): string[] {
  const config = preset.install;
  const name = (preset.name ?? '').trim();
  if (name === '') throw new AppError('INVALID_INPUT', 'preset name is required', 400);

  if (config.command && config.command.length > 0) {
    const args = ['mcp', 'add', name];
    const env = config.env ?? {};
    const keys = Object.keys(env).sort();
    for (const key of keys) args.push('--env', `${key}=${env[key]}`);
    args.push('--');
    args.push(...config.command);
    return args;
  }

  const url = (config.url ?? '').trim();
  if (url === '') {
    throw new AppError('INVALID_INPUT', `codex mcp preset ${name} install.url is required`, 400);
  }
  const args = ['mcp', 'add', name, '--url', url];
  const tokenEnvVar = (config.bearerTokenEnvVar ?? '').trim();
  if (tokenEnvVar !== '') args.push('--bearer-token-env-var', tokenEnvVar);
  return args;
}

export function isAlreadyExists(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`.trim().toLowerCase();
  return combined !== '' && combined.includes('already exists');
}

export function isNotFound(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`.trim().toLowerCase();
  return combined !== '' && combined.includes('not found');
}

function commandError(code: number, stdout: string, stderr: string): string {
  const message = `exit ${code}`;
  const trimmedStderr = stderr.trim();
  const trimmedStdout = stdout.trim();
  if (trimmedStderr !== '') return `${message}\nstderr: ${trimmedStderr}`;
  if (trimmedStdout !== '') return `${message}\nstdout: ${trimmedStdout}`;
  return message;
}

function buildInstallConfig(
  req: { installType: 'http' | 'stdio'; url?: string; headers?: string[]; bearerTokenEnvVar?: string; command?: string[]; env?: Record<string, string> },
): CodexMCPPresetInstallConfig {
  if (req.installType === 'stdio') {
    const cmd = (req.command ?? []).filter((c) => c.trim() !== '');
    const env = req.env && Object.keys(req.env).length > 0 ? req.env : undefined;
    return { command: cmd, ...(env ? { env } : {}) };
  }
  const url = (req.url ?? '').trim();
  const headers = (req.headers ?? []).filter((h) => h.trim() !== '');
  const token = (req.bearerTokenEnvVar ?? '').trim();
  return {
    url,
    ...(headers.length > 0 ? { headers } : {}),
    ...(token ? { bearerTokenEnvVar: token } : {}),
  };
}
