import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type {
  MCPPresetDefinition,
  MCPPresetInstallConfig,
  MCPPresetStatus,
} from './schema.js';

interface ClaudeConfigFile {
  mcpServers?: Record<string, unknown>;
  mcp?: { servers?: Record<string, unknown> };
}

export class ClaudeMCPService {
  constructor(private readonly deps: Deps) {}

  // ── paths ────────────────────────────────────────────────────────────────

  presetConfigPath(): string {
    return this.deps.paths.confPath('claude', 'mcp-presets.json');
  }

  localConfigPath(): string {
    return path.join(this.deps.paths.rootDir, '.mcp.json');
  }

  projectConfigPath(): string {
    return path.join(this.deps.paths.rootDir, '.claude.json');
  }

  userConfigPath(): string {
    return path.join(this.deps.paths.homeDir, '.claude.json');
  }

  // ── list ─────────────────────────────────────────────────────────────────

  async list(): Promise<Record<string, unknown>> {
    const presets = await this.loadPresets();

    const localPath = this.localConfigPath();
    const projectPath = this.projectConfigPath();
    const userPath = this.userConfigPath();

    const local = await readMCPNamesFromConfig(localPath);
    const project = await readMCPNamesFromConfig(projectPath);
    const user = await readMCPNamesFromConfig(userPath);

    const localSet = new Set(local.names);
    const projectSet = new Set(project.names);
    const userSet = new Set(user.names);
    const supportedSet = new Set(presets.map((p) => p.name));

    const supported: MCPPresetStatus[] = presets.map((preset) => ({
      name: preset.name,
      description: preset.description,
      installedLocal: localSet.has(preset.name),
      installedProject: projectSet.has(preset.name),
      installedUser: userSet.has(preset.name),
    }));

    return {
      paths: {
        local: localPath,
        project: projectPath,
        user: userPath,
        localExists: local.exists,
        projectExists: project.exists,
        userExists: user.exists,
      },
      installed: {
        local: local.names,
        project: project.names,
        user: user.names,
      },
      supported,
      others: {
        local: filterUnsupported(local.names, supportedSet),
        project: filterUnsupported(project.names, supportedSet),
        user: filterUnsupported(user.names, supportedSet),
      },
    };
  }

  // ── add / remove (raw) ───────────────────────────────────────────────────

  async add(name: string, transport: string, target: string): Promise<{ stdout: string; stderr: string; ok: boolean; error: string }> {
    const trimmedName = name.trim();
    const trimmedTransport = transport.trim();
    const trimmedTarget = target.trim();
    if (trimmedName === '' || trimmedTransport === '' || trimmedTarget === '') {
      throw new AppError('INVALID_INPUT', 'name, transport and target are required', 400);
    }
    const r = await this.deps.runner.run(
      'claude',
      ['mcp', 'add', trimmedName, '--transport', trimmedTransport, trimmedTarget],
      { cwd: this.deps.paths.rootDir },
    );
    let ok = r.code === 0;
    if (!ok && isAlreadyExists(r.stdout, r.stderr)) ok = true;
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      ok,
      error: ok ? '' : commandError(r.code, r.stdout, r.stderr),
    };
  }

  async remove(name: string): Promise<{ stdout: string; stderr: string; ok: boolean; error: string }> {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      throw new AppError('INVALID_INPUT', 'name is required', 400);
    }
    const r = await this.deps.runner.run('claude', ['mcp', 'remove', trimmedName], {
      cwd: this.deps.paths.rootDir,
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      ok: r.code === 0,
      error: r.code === 0 ? '' : commandError(r.code, r.stdout, r.stderr),
    };
  }

  // ── preset install / remove ──────────────────────────────────────────────

  async presetInstall(rawName: string, rawScope: string | undefined): Promise<{ name: string; scope: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    let scope = normalizeScope(rawScope);
    if (scope === 'local') scope = 'project';

    const presets = await this.loadPresets();
    const preset = presets.find((p) => p.name === name);
    if (!preset) throw new AppError('INVALID_INPUT', `unsupported preset mcp: ${name}`, 400);

    const args = buildPresetInstallArgs(preset, scope);
    const r = await this.deps.runner.run('claude', args, { cwd: this.deps.paths.rootDir });
    let ok = r.code === 0;
    if (!ok && isAlreadyExists(r.stdout, r.stderr)) ok = true;
    return {
      name,
      scope,
      stdout: r.stdout,
      stderr: r.stderr,
      ok,
      error: ok ? '' : commandError(r.code, r.stdout, r.stderr),
    };
  }

  async presetRemove(rawName: string, rawScope: string | undefined): Promise<{ name: string; scope: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const scope = normalizeScope(rawScope);

    const scopes = scope === 'all' ? ['local', 'project', 'user'] : [scope];
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    const cmdErrors: string[] = [];

    for (const sc of scopes) {
      const args = buildPresetRemoveArgs(name, sc);
      const r = await this.deps.runner.run('claude', args, { cwd: this.deps.paths.rootDir });
      const ok = r.code === 0 || isNotFound(r.stdout, r.stderr);
      if (r.stdout.trim() !== '') stdoutParts.push(`[${sc}]\n${r.stdout.trim()}`);
      if (r.stderr.trim() !== '') stderrParts.push(`[${sc}]\n${r.stderr.trim()}`);
      if (!ok) cmdErrors.push(`${sc}: ${commandError(r.code, r.stdout, r.stderr).trim()}`);
    }

    const remaining: string[] = [];
    for (const sc of scopes) {
      if (await this.hasInScope(name, sc)) remaining.push(sc);
    }

    const stdout = stdoutParts.join('\n\n');
    const stderr = stderrParts.join('\n\n');

    if (remaining.length > 0) {
      let message = `failed to remove mcp ${name} from scopes: ${remaining.join(', ')}`;
      if (cmdErrors.length > 0) message += `; command errors: ${cmdErrors.join('; ')}`;
      return { name, scope, stdout, stderr, ok: false, error: message };
    }
    return { name, scope, stdout, stderr, ok: true, error: '' };
  }

  // ── preset config helpers ────────────────────────────────────────────────

  async loadPresets(): Promise<MCPPresetDefinition[]> {
    const p = this.presetConfigPath();
    let content: string;
    try {
      content = await fs.readFile(p, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('PRESET_NOT_FOUND', `mcp preset config not found: ${p}`, 500);
      }
      throw new AppError('PRESET_READ_FAILED', `failed to read mcp preset config: ${(err as Error).message}`, 500);
    }
    let presets: MCPPresetDefinition[];
    try {
      presets = JSON.parse(content) as MCPPresetDefinition[];
    } catch (err) {
      throw new AppError('PRESET_PARSE_FAILED', `invalid mcp preset config JSON: ${(err as Error).message}`, 500);
    }
    if (!Array.isArray(presets) || presets.length === 0) {
      throw new AppError('PRESET_EMPTY', 'mcp preset config is empty', 500);
    }

    const seen = new Set<string>();
    presets.forEach((preset, idx) => {
      const name = (preset.name ?? '').trim();
      if (name === '') throw new AppError('PRESET_INVALID', `mcp preset config item[${idx}] name is required`, 500);
      if (seen.has(name)) throw new AppError('PRESET_INVALID', `duplicate mcp preset name: ${name}`, 500);
      seen.add(name);
      const install = preset.install ?? {};
      const hasTarget = (install.target ?? '').trim() !== '';
      const hasCommand = Array.isArray(install.command) && install.command.length > 0;
      if (!hasTarget && !hasCommand) {
        throw new AppError('PRESET_INVALID', `mcp preset ${name} must define install.target or install.command`, 500);
      }
      if (hasTarget && hasCommand) {
        throw new AppError('PRESET_INVALID', `mcp preset ${name} install.target and install.command cannot both be set`, 500);
      }
    });

    return presets;
  }

  async hasInScope(name: string, scope: string): Promise<boolean> {
    const p = this.configPathByScope(scope);
    const r = await readMCPNamesFromConfig(p);
    return r.names.includes(name);
  }

  configPathByScope(scope: string): string {
    if (scope === 'local') return this.localConfigPath();
    if (scope === 'project') return this.projectConfigPath();
    if (scope === 'user') return this.userConfigPath();
    throw new AppError('INVALID_INPUT', `invalid scope: ${scope}`, 400);
  }
}

// ── helpers (exported for tests) ───────────────────────────────────────────

export async function readMCPNamesFromConfig(p: string): Promise<{ names: string[]; exists: boolean }> {
  let content: string;
  try {
    content = await fs.readFile(p, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { names: [], exists: false };
    throw new AppError('READ_FAILED', `failed to read ${p}: ${(err as Error).message}`, 500);
  }
  let parsed: ClaudeConfigFile;
  try {
    parsed = JSON.parse(content) as ClaudeConfigFile;
  } catch (err) {
    throw new AppError('INVALID_JSON', `invalid JSON in ${p}: ${(err as Error).message}`, 500);
  }
  let servers = parsed.mcpServers;
  if (!servers || Object.keys(servers).length === 0) {
    servers = parsed.mcp?.servers;
  }
  const names = servers ? Object.keys(servers).sort() : [];
  return { names, exists: true };
}

function filterUnsupported(names: string[], supportedSet: Set<string>): string[] {
  return names.filter((n) => !supportedSet.has(n)).sort();
}

export function normalizeScope(scope: string | undefined): string {
  const norm = (scope ?? '').trim().toLowerCase();
  if (norm === '' || norm === 'local') return 'local';
  if (norm === 'project') return 'project';
  if (norm === 'user') return 'user';
  if (norm === 'all') return 'all';
  throw new AppError('INVALID_INPUT', 'scope must be local, project, user or all', 400);
}

export function buildPresetInstallArgs(preset: MCPPresetDefinition, scope: string): string[] {
  const config: MCPPresetInstallConfig = preset.install;
  const name = (preset.name ?? '').trim();
  if (name === '') throw new AppError('INVALID_INPUT', 'preset name is required', 400);

  if (config.command && config.command.length > 0) {
    const args = ['mcp', 'add', name, '--scope', scope];
    const env = config.env ?? {};
    const keys = Object.keys(env).sort();
    for (const key of keys) args.push('--env', `${key}=${env[key]}`);
    args.push('--');
    args.push(...config.command);
    return args;
  }

  if (!config.target || config.target.trim() === '') {
    throw new AppError('INVALID_INPUT', `preset ${name} install target is required`, 400);
  }
  const transport = (config.transport ?? '').trim();
  if (transport === '') {
    throw new AppError('INVALID_INPUT', `preset ${name} transport is required for http/sse target`, 400);
  }

  const args = ['mcp', 'add', name, '--scope', scope, '--transport', transport, config.target];
  for (const header of config.headers ?? []) {
    const trimmed = header.trim();
    if (trimmed === '') continue;
    args.push('--header', trimmed);
  }
  return args;
}

export function buildPresetRemoveArgs(name: string, scope: string): string[] {
  return ['mcp', 'remove', '--scope', scope, name];
}

function isNotFound(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`.trim().toLowerCase();
  if (combined === '') return false;
  if (combined.includes('not found')) return true;
  if (combined.includes('no ') && combined.includes('found with name')) return true;
  return false;
}

function isAlreadyExists(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`.trim().toLowerCase();
  return combined !== '' && combined.includes('already exists');
}

function commandError(code: number, stdout: string, stderr: string): string {
  const message = `exit ${code}`;
  const trimmedStderr = stderr.trim();
  const trimmedStdout = stdout.trim();
  if (trimmedStderr !== '') return `${message}\nstderr: ${trimmedStderr}`;
  if (trimmedStdout !== '') return `${message}\nstdout: ${trimmedStdout}`;
  return message;
}
