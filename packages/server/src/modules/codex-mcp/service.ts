import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { setTomlRawValue, formatTomlInlineTable } from '../../core/toml/index.js';
import type {
  CodexMCPPresetDefinition,
  CodexMCPPresetInstallConfig,
  CodexMCPPresetStatus,
} from './schema.js';

interface CodexMCPListItem {
  name?: string;
}

export class CodexMCPService {
  constructor(private readonly deps: Deps) {}

  presetConfigPath(): string {
    return this.deps.paths.confPath('codex', 'mcp-presets.json');
  }

  configPath(): string {
    return this.deps.paths.codexPath('config.toml');
  }

  async list(): Promise<Record<string, unknown>> {
    const presets = await this.loadPresets();
    const installedNames = await this.listInstalledNames();

    const installedSet = new Set(installedNames);
    const supportedSet = new Set(presets.map((p) => p.name));

    const supported: CodexMCPPresetStatus[] = presets.map((preset) => ({
      name: preset.name,
      description: preset.description,
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

    return {
      paths: { user: userPath, userExists },
      installed: { user: installedNames },
      supported,
      others: {
        user: installedNames.filter((n) => !supportedSet.has(n)).sort(),
      },
    };
  }

  async presetInstall(rawName: string): Promise<{ name: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);

    const presets = await this.loadPresets();
    const preset = presets.find((p) => p.name === name);
    if (!preset) throw new AppError('INVALID_INPUT', `unsupported preset mcp: ${name}`, 400);

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
  }

  async presetRemove(rawName: string): Promise<{ name: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);

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
    if (!Array.isArray(items)) return [];
    const names: string[] = [];
    for (const item of items) {
      const name = (item?.name ?? '').trim();
      if (name !== '') names.push(name);
    }
    names.sort();
    return names;
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
