import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type {
  MCPActiveOp,
  MCPOpAction,
  MCPPresetCreateRequest,
  MCPPresetUpdateRequest,
  MCPPresetDefinition,
  MCPPresetInstallConfig,
  MCPPresetStatus,
} from './schema.js';

interface ClaudeConfigFile {
  mcpServers?: Record<string, unknown>;
  mcp?: { servers?: Record<string, unknown> };
}

interface ClaudeServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string> | string[];
}

export class ClaudeMCPService {
  private readonly activeOps = new Map<string, MCPActiveOp>();

  constructor(private readonly deps: Deps) {}

  private startOp(name: string, action: MCPOpAction): void {
    this.activeOps.set(name, { name, action, startedAt: Date.now() });
  }

  private endOp(name: string): void {
    this.activeOps.delete(name);
  }

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
      install: preset.install,
      installedLocal: localSet.has(preset.name),
      installedProject: projectSet.has(preset.name),
      installedUser: userSet.has(preset.name),
    }));

    const otherUserNames = filterUnsupported(user.names, supportedSet);
    const userFullConfigs = await readMCPConfigsFromFile(userPath);
    const otherConfigs: Record<string, MCPPresetInstallConfig> = {};
    for (const name of otherUserNames) {
      const raw = userFullConfigs[name];
      if (raw) otherConfigs[name] = claudeServerToInstall(raw);
    }

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
        user: otherUserNames,
      },
      otherConfigs,
      activeOps: Array.from(this.activeOps.values()),
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

    this.startOp(name, 'installing');
    try {
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
    } finally {
      this.endOp(name);
    }
  }

  async presetRemove(rawName: string, rawScope: string | undefined): Promise<{ name: string; scope: string; stdout: string; stderr: string; ok: boolean; error: string }> {
    const name = rawName.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const scope = normalizeScope(rawScope);

    this.startOp(name, 'uninstalling');
    try {
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
    } finally {
      this.endOp(name);
    }
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

  // ── preset create / delete ────────────────────────────────────────────────

  async createPreset(req: MCPPresetCreateRequest): Promise<void> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);

    const presets = await this.loadPresetsRaw();
    if (presets.some((p) => p.name === name)) {
      throw new AppError('DUPLICATE_PRESET', `mcp preset already exists: ${name}`, 400);
    }

    let install: MCPPresetInstallConfig;
    if (req.installType === 'stdio') {
      const cmd = (req.command ?? []).filter((c) => c.trim() !== '');
      if (cmd.length === 0) throw new AppError('INVALID_INPUT', 'command is required for stdio type', 400);
      const env = req.env && Object.keys(req.env).length > 0 ? req.env : undefined;
      install = { command: cmd, ...(env ? { env } : {}) };
    } else {
      const target = (req.target ?? '').trim();
      if (!target) throw new AppError('INVALID_INPUT', 'target is required for http/sse type', 400);
      const headers = (req.headers ?? []).filter((h) => h.trim() !== '');
      install = { transport: req.installType, target, ...(headers.length > 0 ? { headers } : {}) };
    }

    const next: MCPPresetDefinition[] = [
      ...presets,
      { name, description: (req.description ?? '').trim(), install },
    ];
    await this.savePresets(next);
  }

  async deletePreset(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresetsRaw();
    const next = presets.filter((p) => p.name !== trimmed);
    if (next.length === presets.length) {
      throw new AppError('NOT_FOUND', `mcp preset not found: ${trimmed}`, 404);
    }
    await this.savePresets(next);
  }

  async updatePreset(req: MCPPresetUpdateRequest): Promise<{ reinstalled: Array<{ scope: string; ok: boolean; error: string }> }> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresetsRaw();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx === -1) throw new AppError('NOT_FOUND', `mcp preset not found: ${name}`, 404);

    let install: MCPPresetInstallConfig;
    if (req.installType === 'stdio') {
      const cmd = (req.command ?? []).filter((c) => c.trim() !== '');
      if (cmd.length === 0) throw new AppError('INVALID_INPUT', 'command is required for stdio type', 400);
      const env = req.env && Object.keys(req.env).length > 0 ? req.env : undefined;
      install = { command: cmd, ...(env ? { env } : {}) };
    } else {
      const target = (req.target ?? '').trim();
      if (!target) throw new AppError('INVALID_INPUT', 'target is required for http/sse type', 400);
      const headers = (req.headers ?? []).filter((h) => h.trim() !== '');
      install = { transport: req.installType, target, ...(headers.length > 0 ? { headers } : {}) };
    }

    const updated: MCPPresetDefinition = {
      name,
      description: (req.description ?? '').trim(),
      install,
    };

    // Check installed scopes before saving so we know what to reinstall
    const allScopes = ['local', 'project', 'user'] as const;
    const installedScopes: string[] = [];
    for (const scope of allScopes) {
      if (await this.hasInScope(name, scope)) installedScopes.push(scope);
    }

    // Save new config first so reinstall picks up the updated preset
    await this.savePresets(presets.map((p, i) => (i === idx ? updated : p)));

    // Reinstall in each previously installed scope
    const reinstalled: Array<{ scope: string; ok: boolean; error: string }> = [];
    for (const scope of installedScopes) {
      const removeArgs = buildPresetRemoveArgs(name, scope);
      const removeR = await this.deps.runner.run('claude', removeArgs, { cwd: this.deps.paths.rootDir });
      const removeOk = removeR.code === 0 || isNotFound(removeR.stdout, removeR.stderr);
      if (!removeOk) {
        reinstalled.push({ scope, ok: false, error: `remove failed: ${commandError(removeR.code, removeR.stdout, removeR.stderr)}` });
        continue;
      }

      const installScope = scope === 'local' ? 'project' : scope;
      const installArgs = buildPresetInstallArgs(updated, installScope);
      const installR = await this.deps.runner.run('claude', installArgs, { cwd: this.deps.paths.rootDir });
      const installOk = installR.code === 0 || isAlreadyExists(installR.stdout, installR.stderr);
      reinstalled.push({
        scope,
        ok: installOk,
        error: installOk ? '' : `install failed: ${commandError(installR.code, installR.stdout, installR.stderr)}`,
      });
    }

    return { reinstalled };
  }

  private async loadPresetsRaw(): Promise<MCPPresetDefinition[]> {
    const p = this.presetConfigPath();
    let content: string;
    try {
      content = await fs.readFile(p, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new AppError('PRESET_READ_FAILED', `failed to read mcp preset config: ${(err as Error).message}`, 500);
    }
    if (content.trim() === '') return [];
    try {
      return JSON.parse(content) as MCPPresetDefinition[];
    } catch (err) {
      throw new AppError('PRESET_PARSE_FAILED', `invalid mcp preset config JSON: ${(err as Error).message}`, 500);
    }
  }

  private async savePresets(presets: MCPPresetDefinition[]): Promise<void> {
    const p = this.presetConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(presets, null, 2));
  }
}

// ── helpers (exported for tests) ───────────────────────────────────────────

export async function readMCPConfigsFromFile(p: string): Promise<Record<string, ClaudeServerConfig>> {
  let content: string;
  try {
    content = await fs.readFile(p, 'utf-8');
  } catch {
    return {};
  }
  let parsed: ClaudeConfigFile;
  try {
    parsed = JSON.parse(content) as ClaudeConfigFile;
  } catch {
    return {};
  }
  let servers = parsed.mcpServers;
  if (!servers || Object.keys(servers).length === 0) servers = parsed.mcp?.servers;
  return (servers ?? {}) as Record<string, ClaudeServerConfig>;
}

export function claudeServerToInstall(config: ClaudeServerConfig): MCPPresetInstallConfig {
  if (config.command) {
    const command = [config.command, ...(config.args ?? [])];
    const env = config.env && Object.keys(config.env).length > 0 ? config.env : undefined;
    return { command, ...(env ? { env } : {}) };
  }
  const transport = config.type ?? 'http';
  const target = config.url ?? '';
  let headers: string[] | undefined;
  if (config.headers) {
    if (Array.isArray(config.headers)) {
      headers = config.headers.filter((h) => h.trim() !== '');
    } else {
      headers = Object.entries(config.headers).map(([k, v]) => `${k}: ${v}`);
    }
    if (headers.length === 0) headers = undefined;
  }
  return { transport, target, ...(headers ? { headers } : {}) };
}

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
