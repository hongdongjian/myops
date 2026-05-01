import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type {
  InstalledPlugin,
  PluginMarketplace,
  PluginPresetDefinition,
  PluginPresetStatus,
  PluginActiveOp,
  PluginOpAction,
  AddPresetRequest,
  UpdatePresetRequest,
} from './schema.js';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface AutoEnableSettings {
  items?: Record<string, boolean>;
}

const SEP = '\x00';

export function installedPluginKey(packageId: string, scope: string): string {
  return `${packageId}${SEP}${scope}`;
}

export function pluginPackageParts(packageId: string): { plugin: string; marketplace: string } {
  const trimmed = packageId.trim();
  const sep = trimmed.lastIndexOf('@');
  if (sep <= 0 || sep >= trimmed.length - 1) {
    throw new AppError('INVALID_INPUT', `invalid plugin package: ${trimmed}`, 400);
  }
  return { plugin: trimmed.slice(0, sep), marketplace: trimmed.slice(sep + 1) };
}

export function normalizePluginScope(scope: string | undefined): string {
  const norm = (scope ?? '').trim().toLowerCase();
  if (norm === '' || norm === 'user') return 'user';
  if (norm === 'project') return 'project';
  if (norm === 'local') return 'local';
  throw new AppError('INVALID_INPUT', 'scope must be user, project or local', 400);
}

export function buildMarketplaceAddArgs(source: string, scope: string): string[] {
  return ['plugin', 'marketplace', 'add', source, '--scope', scope];
}
export function buildInstallArgs(packageId: string, scope: string): string[] {
  return ['plugin', 'install', packageId, '--scope', scope];
}
export function buildEnableArgs(packageId: string, scope: string): string[] {
  return ['plugin', 'enable', packageId, '--scope', scope];
}
export function buildDisableArgs(packageId: string, scope: string): string[] {
  return ['plugin', 'disable', packageId, '--scope', scope];
}
export function buildUpdateArgs(packageId: string, scope: string): string[] {
  return ['plugin', 'update', packageId, '--scope', scope];
}
export function buildUninstallArgs(packageId: string, scope: string): string[] {
  return ['plugin', 'uninstall', packageId, '--scope', scope];
}

export function joinCommandOutput(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter((p) => p !== '').join('\n');
}

export function commandError(runErr: string | null, stdout: string, stderr: string): string {
  if (!runErr) return '';
  const message = runErr.trim();
  const trimmedStderr = stderr.trim();
  const trimmedStdout = stdout.trim();
  if (trimmedStderr !== '') return `${message}\nstderr: ${trimmedStderr}`;
  if (trimmedStdout !== '') return `${message}\nstdout: ${trimmedStdout}`;
  return message;
}

export class ClaudePluginService {
  private readonly actionMu = new Mutex();
  private readonly marksMu = new Mutex();
  private readonly activeOps = new Map<string, PluginActiveOp>();

  constructor(private readonly deps: Deps) {}

  private startOp(pkg: string, action: PluginOpAction): void {
    this.activeOps.set(pkg, { package: pkg, action, startedAt: Date.now() });
  }

  private endOp(pkg: string): void {
    this.activeOps.delete(pkg);
  }

  presetConfigPath(): string {
    return this.deps.paths.confPath('claude', 'plugins.json');
  }

  autoEnableSettingsPath(): string {
    return this.deps.paths.dataPath('claude-plugin-auto-enable.json');
  }

  // ── list ─────────────────────────────────────────────────────────────────

  async list(): Promise<Record<string, unknown>> {
    const presets = await this.loadPresets();
    const installed = await this.loadInstalled();
    const marketplaces = await this.loadMarketplaces();
    const marks = await this.loadAutoEnableMarks();

    const installedIndex = makeInstalledIndex(installed);
    const marketplaceSet = new Set(marketplaces.map((m) => m.name));
    const managedPackages = new Set<string>();

    const supported: PluginPresetStatus[] = presets.map((preset) => {
      const key = installedPluginKey(preset.package, preset.scope);
      const { marketplace } = pluginPackageParts(preset.package);
      const inst = installedIndex.get(key);
      managedPackages.add(preset.package);
      return {
        name: preset.name,
        description: preset.description ?? '',
        package: preset.package,
        marketplace,
        scope: preset.scope,
        marketplaceConfigured: marketplaceSet.has(marketplace),
        installed: !!inst,
        enabled: !!inst?.enabled,
        autoStart: !!marks[key],
        version: inst?.version,
        link: preset.link,
      };
    });

    const others = installed
      .filter((p) => !managedPackages.has(p.id))
      .map((p) => p.id)
      .sort();

    return {
      path: this.presetConfigPath(),
      supported,
      installed,
      marketplaces,
      others,
      activeOps: Array.from(this.activeOps.values()),
    };
  }

  // ── action handlers ──────────────────────────────────────────────────────

  async install(rawPackage: string): Promise<{
    package: string;
    scope: string;
    stdout: string;
    stderr: string;
    ok: boolean;
    error: string;
  }> {
    const preset = await this.findPreset(rawPackage);
    await this.ensureMarketplace(preset);
    this.startOp(preset.package, 'installing');
    try {
      return await this.actionMu.runExclusive(async () => {
        let result = await this.runClaude(buildInstallArgs(preset.package, preset.scope));
        let runErr = errFromResult(result);
        if (runErr) {
          const installed = await this.hasInScope(preset.package, preset.scope);
          if (installed) runErr = null;
        }
        if (!runErr) {
          const enable = await this.setEnabled(preset.package, preset.scope, true);
          result = {
            stdout: joinCommandOutput(result.stdout, enable.result.stdout),
            stderr: joinCommandOutput(result.stderr, enable.result.stderr),
            code: enable.runErr ? 1 : 0,
          };
          if (enable.runErr) runErr = enable.runErr;
        }
        if (!runErr) {
          try {
            await this.setAutoEnableMark(preset.package, preset.scope, true);
          } catch (err) {
            runErr = `failed to save plugin auto-start mark: ${(err as Error).message}`;
          }
        }
        return this.toActionResponse(preset.package, preset.scope, result, runErr);
      });
    } finally {
      this.endOp(preset.package);
    }
  }

  async enable(rawPackage: string) {
    const preset = await this.findPreset(rawPackage);
    this.startOp(preset.package, 'enabling');
    try {
      return await this.actionMu.runExclusive(async () => {
        const enable = await this.setEnabled(preset.package, preset.scope, true);
        let runErr = enable.runErr;
        if (!runErr) {
          try {
            await this.setAutoEnableMark(preset.package, preset.scope, true);
          } catch (err) {
            runErr = `failed to save plugin auto-start mark: ${(err as Error).message}`;
          }
        }
        return this.toActionResponse(preset.package, preset.scope, enable.result, runErr);
      });
    } finally {
      this.endOp(preset.package);
    }
  }

  async disable(rawPackage: string) {
    const preset = await this.findPreset(rawPackage);
    this.startOp(preset.package, 'disabling');
    try {
      return await this.actionMu.runExclusive(async () => {
        const disable = await this.setEnabled(preset.package, preset.scope, false);
        let runErr = disable.runErr;
        if (!runErr) {
          try {
            await this.setAutoEnableMark(preset.package, preset.scope, false);
          } catch (err) {
            runErr = `failed to save plugin auto-start mark: ${(err as Error).message}`;
          }
        }
        return this.toActionResponse(preset.package, preset.scope, disable.result, runErr);
      });
    } finally {
      this.endOp(preset.package);
    }
  }

  async update(rawPackage: string) {
    const preset = await this.findPreset(rawPackage);
    this.startOp(preset.package, 'updating');
    try {
      return await this.actionMu.runExclusive(async () => {
        const result = await this.runClaude(buildUpdateArgs(preset.package, preset.scope));
        const runErr = errFromResult(result);
        return this.toActionResponse(preset.package, preset.scope, result, runErr);
      });
    } finally {
      this.endOp(preset.package);
    }
  }

  async uninstall(rawPackage: string) {
    const preset = await this.findPreset(rawPackage);
    this.startOp(preset.package, 'uninstalling');
    try {
      return await this.actionMu.runExclusive(async () => {
        const result = await this.runClaude(buildUninstallArgs(preset.package, preset.scope));
        let runErr = errFromResult(result);
        if (runErr) {
          const installed = await this.hasInScope(preset.package, preset.scope);
          if (!installed) runErr = null;
        }
        if (!runErr) {
          try {
            await this.setAutoEnableMark(preset.package, preset.scope, false);
          } catch (err) {
            runErr = `failed to save plugin auto-start mark: ${(err as Error).message}`;
          }
        }
        return this.toActionResponse(preset.package, preset.scope, result, runErr);
      });
    } finally {
      this.endOp(preset.package);
    }
  }

  async updatePreset(req: UpdatePresetRequest): Promise<void> {
    const pkg = req.package.trim();
    const presets = await this.loadPresets();
    const idx = presets.findIndex((p) => p.package === pkg);
    if (idx === -1) throw new AppError('NOT_FOUND', `plugin preset not found: ${pkg}`, 404);
    // idx is guaranteed valid here, cast is safe
    const existing = presets[idx] as PluginPresetDefinition;
    const updated: PluginPresetDefinition = {
      name: req.name.trim(),
      package: existing.package,
      scope: existing.scope,
      description: req.description?.trim() ?? existing.description,
      source: req.source?.trim() ?? existing.source,
      link: req.link?.trim() || existing.link,
    };
    await this.savePresets(presets.map((p, i) => (i === idx ? updated : p)));
  }

  async addPreset(req: AddPresetRequest): Promise<void> {
    const presets = await this.loadPresets();
    const pkg = req.package.trim();
    if (presets.some((p) => p.package === pkg)) {
      throw new AppError('DUPLICATE_PRESET', `plugin preset already exists: ${pkg}`, 400);
    }
    const next: PluginPresetDefinition[] = [
      ...presets,
      {
        name: req.name.trim(),
        package: pkg,
        description: req.description?.trim() ?? '',
        source: req.source?.trim() ?? '',
        scope: 'user',
        link: req.link?.trim() || undefined,
      },
    ];
    await this.savePresets(next);
  }

  async removePreset(packageId: string): Promise<void> {
    const trimmed = packageId.trim();
    const presets = await this.loadPresets();
    const next = presets.filter((p) => p.package !== trimmed);
    if (next.length === presets.length) {
      throw new AppError('NOT_FOUND', `plugin preset not found: ${trimmed}`, 404);
    }
    await this.savePresets(next);
  }

  private async savePresets(presets: PluginPresetDefinition[]): Promise<void> {
    const p = this.presetConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(presets, null, 2));
  }

  // ── auto enable ──────────────────────────────────────────────────────────

  async autoEnableCheck(): Promise<void> {
    await this.actionMu.runExclusive(async () => {
      let presets: PluginPresetDefinition[];
      try {
        presets = await this.loadPresets();
      } catch {
        return;
      }
      if (presets.length === 0) return;
      let marks: Record<string, boolean>;
      try {
        marks = await this.loadAutoEnableMarks();
      } catch {
        return;
      }
      let installed: InstalledPlugin[];
      try {
        installed = await this.loadInstalled();
      } catch {
        return;
      }
      const installedIndex = makeInstalledIndex(installed);
      for (const preset of presets) {
        const key = installedPluginKey(preset.package, preset.scope);
        if (!marks[key]) continue;
        const inst = installedIndex.get(key);
        if (!inst || inst.enabled) continue;
        try {
          await this.setEnabled(preset.package, preset.scope, true);
        } catch {
          /* swallow */
        }
      }
    });
  }

  // ── preset / marketplace / installed helpers ─────────────────────────────

  async loadPresets(): Promise<PluginPresetDefinition[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.presetConfigPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new AppError('PRESET_READ_FAILED', `failed to read plugin preset config: ${(err as Error).message}`, 500);
    }
    const trimmed = raw.trim();
    if (trimmed === '') return [];
    let arr: PluginPresetDefinition[];
    try {
      arr = JSON.parse(trimmed) as PluginPresetDefinition[];
    } catch (err) {
      throw new AppError('PRESET_PARSE_FAILED', `invalid plugin preset config JSON: ${(err as Error).message}`, 500);
    }
    const seen = new Set<string>();
    const result: PluginPresetDefinition[] = arr.map((p, idx) => {
      const name = (p.name ?? '').trim();
      const pkg = (p.package ?? '').trim();
      if (name === '') {
        throw new AppError('PRESET_INVALID', `plugin preset config item[${idx}] name is required`, 500);
      }
      if (pkg === '') {
        throw new AppError('PRESET_INVALID', `plugin preset config item[${idx}] package is required`, 500);
      }
      pluginPackageParts(pkg); // validate
      if (seen.has(pkg)) {
        throw new AppError('PRESET_INVALID', `duplicate plugin preset package: ${pkg}`, 500);
      }
      seen.add(pkg);
      const scope = normalizePluginScope(p.scope);
      return {
        name,
        description: (p.description ?? '').trim(),
        package: pkg,
        source: (p.source ?? '').trim(),
        scope,
        link: p.link,
      };
    });
    result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return result;
  }

  async findPreset(packageId: string): Promise<PluginPresetDefinition> {
    const trimmed = packageId.trim();
    if (trimmed === '') {
      throw new AppError('INVALID_INPUT', 'package is required', 400);
    }
    const presets = await this.loadPresets();
    const found = presets.find((p) => p.package === trimmed);
    if (!found) {
      throw new AppError('INVALID_INPUT', `unsupported plugin package: ${trimmed}`, 400);
    }
    return found;
  }

  async ensureMarketplace(preset: PluginPresetDefinition): Promise<void> {
    const { marketplace } = pluginPackageParts(preset.package);
    let marketplaces = await this.loadMarketplaces();
    if (marketplaces.some((m) => m.name === marketplace)) return;
    const source = (preset.source ?? '').trim();
    if (source === '') {
      throw new AppError(
        'MARKETPLACE_NOT_CONFIGURED',
        `plugin marketplace ${marketplace} is not configured and source is empty`,
        500,
      );
    }
    const result = await this.runClaude(buildMarketplaceAddArgs(source, preset.scope));
    const runErr = errFromResult(result);
    if (runErr) {
      try {
        marketplaces = await this.loadMarketplaces();
        if (marketplaces.some((m) => m.name === marketplace)) return;
      } catch {
        /* fall through */
      }
      throw new AppError(
        'MARKETPLACE_ADD_FAILED',
        `failed to add plugin marketplace: ${commandError(runErr, result.stdout, result.stderr)}`,
        500,
      );
    }
  }

  async loadInstalled(): Promise<InstalledPlugin[]> {
    const result = await this.runClaude(['plugin', 'list', '--json']);
    const runErr = errFromResult(result);
    if (runErr) {
      throw new AppError('PLUGIN_LIST_FAILED', `failed to list plugins: ${commandError(runErr, result.stdout, result.stderr)}`, 500);
    }
    const trimmed = result.stdout.trim();
    if (trimmed === '') return [];
    let items: InstalledPlugin[];
    try {
      items = JSON.parse(trimmed) as InstalledPlugin[];
    } catch (err) {
      throw new AppError('PLUGIN_LIST_PARSE_FAILED', `invalid plugin list JSON: ${(err as Error).message}`, 500);
    }
    items.sort((a, b) => {
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0;
    });
    return items;
  }

  async loadMarketplaces(): Promise<PluginMarketplace[]> {
    const result = await this.runClaude(['plugin', 'marketplace', 'list', '--json']);
    const runErr = errFromResult(result);
    if (runErr) {
      throw new AppError(
        'MARKETPLACE_LIST_FAILED',
        `failed to list plugin marketplaces: ${commandError(runErr, result.stdout, result.stderr)}`,
        500,
      );
    }
    const trimmed = result.stdout.trim();
    if (trimmed === '') return [];
    let items: PluginMarketplace[];
    try {
      items = JSON.parse(trimmed) as PluginMarketplace[];
    } catch (err) {
      throw new AppError('MARKETPLACE_PARSE_FAILED', `invalid plugin marketplace JSON: ${(err as Error).message}`, 500);
    }
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return items;
  }

  async hasInScope(packageId: string, scope: string): Promise<boolean> {
    const items = await this.loadInstalled();
    return items.some((it) => it.id === packageId && it.scope === scope);
  }

  async findInstalled(packageId: string, scope: string): Promise<InstalledPlugin | null> {
    const items = await this.loadInstalled();
    return items.find((it) => it.id === packageId && it.scope === scope) ?? null;
  }

  async setEnabled(
    packageId: string,
    scope: string,
    enabled: boolean,
  ): Promise<{ result: RunResult; runErr: string | null }> {
    const item = await this.findInstalled(packageId, scope);
    if (!item) {
      throw new AppError('PLUGIN_NOT_INSTALLED', `plugin not installed in ${scope} scope: ${packageId}`, 400);
    }
    if (item.enabled === enabled) {
      return { result: { stdout: '', stderr: '', code: 0 }, runErr: null };
    }
    const args = enabled ? buildEnableArgs(packageId, scope) : buildDisableArgs(packageId, scope);
    const action = enabled ? 'enable' : 'disable';
    const result = await this.runClaude(args);
    const runErr = errFromResult(result);
    if (runErr) {
      const verify = await this.findInstalled(packageId, scope);
      if (verify && verify.enabled === enabled) {
        return { result, runErr: null };
      }
      return {
        result,
        runErr: `failed to ${action} plugin: ${commandError(runErr, result.stdout, result.stderr)}`,
      };
    }
    return { result, runErr: null };
  }

  // ── auto enable marks ────────────────────────────────────────────────────

  async loadAutoEnableMarks(): Promise<Record<string, boolean>> {
    return this.marksMu.runExclusive(async () => this.loadAutoEnableMarksLocked());
  }

  private async loadAutoEnableMarksLocked(): Promise<Record<string, boolean>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.autoEnableSettingsPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new AppError('PLUGIN_MARKS_READ_FAILED', `failed to read Claude plugin auto-start marks: ${(err as Error).message}`, 500);
    }
    const trimmed = raw.trim();
    if (trimmed === '') return {};
    let parsed: AutoEnableSettings;
    try {
      parsed = JSON.parse(trimmed) as AutoEnableSettings;
    } catch (err) {
      throw new AppError('PLUGIN_MARKS_PARSE_FAILED', `invalid Claude plugin auto-start marks JSON: ${(err as Error).message}`, 500);
    }
    return parsed.items ?? {};
  }

  async setAutoEnableMark(packageId: string, scope: string, enabled: boolean): Promise<void> {
    return this.marksMu.runExclusive(async () => {
      const items = await this.loadAutoEnableMarksLocked();
      items[installedPluginKey(packageId, scope)] = enabled;
      await this.saveAutoEnableMarksLocked(items);
    });
  }

  private async saveAutoEnableMarksLocked(items: Record<string, boolean>): Promise<void> {
    const p = this.autoEnableSettingsPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ items }));
  }

  // ── runner / response helpers ────────────────────────────────────────────

  private async runClaude(args: string[]): Promise<RunResult> {
    return this.deps.runner.run('claude', args, {
      cwd: this.deps.paths.rootDir,
      stripClaudeCode: true,
    });
  }

  private toActionResponse(
    packageId: string,
    scope: string,
    result: RunResult,
    runErr: string | null,
  ) {
    return {
      package: packageId,
      scope,
      stdout: result.stdout,
      stderr: result.stderr,
      ok: !runErr,
      error: commandError(runErr, result.stdout, result.stderr),
    };
  }
}

function errFromResult(r: RunResult): string | null {
  if (r.code === 0) return null;
  return r.stderr.trim() || `exit ${r.code}`;
}

function makeInstalledIndex(items: InstalledPlugin[]): Map<string, InstalledPlugin> {
  const m = new Map<string, InstalledPlugin>();
  for (const it of items) m.set(installedPluginKey(it.id, it.scope), it);
  return m;
}
