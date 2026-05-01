import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { ensureSymlink } from '../../core/fsops/index.js';
import type {
  AssetItem,
  SkillPresetDef,
  SkillPresetItem,
  SkillPresetCreateRequest,
  SkillPresetUpdateRequest,
  RuleCreateRequest,
  RuleUpdateRequest,
} from './schema.js';

interface SkillOpEntry {
  action: 'install' | 'uninstall' | 'update';
  error: string;
}

export class ClaudeAssetsService {
  private readonly skillOps: Map<string, SkillOpEntry> = new Map();

  constructor(private readonly deps: Deps) {}

  // ── paths ────────────────────────────────────────────────────────────────

  rulesProjectDir(): string {
    return this.deps.paths.confPath('claude', 'rules');
  }

  rulesHomeDir(): string {
    return this.deps.paths.claudePath('rules');
  }

  skillsHomeDir(): string {
    return this.deps.paths.claudePath('skills');
  }

  skillPresetsPath(): string {
    return this.deps.paths.confPath('skill-presets.yaml');
  }

  // ── skills preset CRUD ───────────────────────────────────────────────────

  private async loadPresetsAsync(): Promise<SkillPresetDef[]> {
    try {
      const raw = await fs.readFile(this.skillPresetsPath(), 'utf-8');
      const parsed = YAML.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as SkillPresetDef[];
    } catch {
      return [];
    }
  }

  private async savePresetsToFile(presets: SkillPresetDef[]): Promise<void> {
    const p = this.skillPresetsPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, YAML.stringify(presets));
  }

  async createSkillPreset(req: SkillPresetCreateRequest): Promise<void> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const repo = req.repo.trim();
    if (!repo) throw new AppError('INVALID_INPUT', 'repo is required', 400);
    const presets = await this.loadPresetsAsync();
    if (presets.some((p) => p.name === name)) {
      throw new AppError('DUPLICATE_PRESET', `skill preset already exists: ${name}`, 400);
    }
    const def: SkillPresetDef = {
      name,
      desc: (req.desc ?? '').trim(),
      repo,
      ...(req.skill?.trim() ? { skill: req.skill.trim() } : {}),
    };
    await this.savePresetsToFile([...presets, def]);
  }

  async updateSkillPreset(req: SkillPresetUpdateRequest): Promise<void> {
    const name = req.name.trim();
    if (!name) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const repo = req.repo.trim();
    if (!repo) throw new AppError('INVALID_INPUT', 'repo is required', 400);
    const presets = await this.loadPresetsAsync();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx === -1) throw new AppError('NOT_FOUND', `skill preset not found: ${name}`, 404);
    const updated: SkillPresetDef = {
      name,
      desc: (req.desc ?? '').trim(),
      repo,
      ...(req.skill?.trim() ? { skill: req.skill.trim() } : {}),
    };
    await this.savePresetsToFile(presets.map((p, i) => (i === idx ? updated : p)));
  }

  async deleteSkillPreset(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('INVALID_INPUT', 'name is required', 400);
    const presets = await this.loadPresetsAsync();
    const next = presets.filter((p) => p.name !== trimmed);
    if (next.length === presets.length) {
      throw new AppError('NOT_FOUND', `skill preset not found: ${trimmed}`, 404);
    }
    await this.savePresetsToFile(next);
  }

  // ── skills install / uninstall ───────────────────────────────────────────

  async listSkills(): Promise<SkillPresetItem[]> {
    const presets = await this.loadPresetsAsync();
    const homeDir = this.skillsHomeDir();
    return presets.map((preset) => {
      const dst = path.join(homeDir, preset.name);
      let installed = false;
      try {
        fsSync.lstatSync(dst);
        installed = true;
      } catch { /* not installed */ }
      const item: SkillPresetItem = {
        name: preset.name,
        desc: preset.desc ?? '',
        repo: preset.repo,
        installed,
        ...(preset.skill ? { skill: preset.skill } : {}),
      };
      const entry = this.skillOps.get(`claude-code:${preset.name}`);
      if (entry) {
        if (entry.error !== '') item.error = entry.error;
        else item.pending = entry.action;
      }
      return item;
    });
  }

  async listOtherSkills(): Promise<string[]> {
    const presets = await this.loadPresetsAsync();
    const presetNames = new Set(presets.map((p) => p.name));
    const homeDir = this.skillsHomeDir();
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(homeDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => !e.name.startsWith('.') && !presetNames.has(e.name))
      .map((e) => e.name)
      .sort();
  }

  async startSkillInstall(name: string): Promise<void> {
    const presets = await this.loadPresetsAsync();
    const preset = presets.find((p) => p.name === name);
    if (!preset) throw new AppError('UNKNOWN_SKILL', `unknown skill: ${name}`, 500);
    const key = `claude-code:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'install', error: '' });
    void this.runSkillInstall(preset, key, 'install');
  }

  async startSkillUninstall(name: string): Promise<void> {
    const key = `claude-code:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'uninstall', error: '' });
    void this.runSkillUninstall(name, key);
  }

  async startSkillUpdate(name: string): Promise<void> {
    const presets = await this.loadPresetsAsync();
    const preset = presets.find((p) => p.name === name);
    if (!preset) throw new AppError('UNKNOWN_SKILL', `unknown skill: ${name}`, 500);
    const key = `claude-code:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'update', error: '' });
    void this.runSkillInstall(preset, key, 'update');
  }

  async updateSkills(): Promise<string> {
    const r = await this.deps.runner.run('npx', ['skills', 'update', '-y']);
    if (r.code !== 0) {
      const out = (r.stderr.trim() || r.stdout.trim()) || `exit ${r.code}`;
      throw new AppError('SKILL_UPDATE_FAILED', `update failed: ${out}`, 500);
    }
    if (r.stdout.includes('up to date')) return '所有 Skills 已是最新版本';
    return 'Skills 更新完成';
  }

  async getSkillContent(name: string): Promise<string> {
    validateSimpleName(name);
    const skillPath = path.join(this.skillsHomeDir(), name, 'SKILL.md');
    try {
      return await fs.readFile(skillPath, 'utf-8');
    } catch {
      throw new AppError('SKILL_NOT_FOUND', `SKILL.md not found for: ${name}`, 404);
    }
  }

  // ── rules ────────────────────────────────────────────────────────────────

  async listRules(): Promise<AssetItem[]> {
    return listAssets(this.rulesProjectDir(), this.rulesHomeDir());
  }

  async createRule(req: RuleCreateRequest): Promise<void> {
    validateSimpleName(req.name);
    const p = path.join(this.rulesProjectDir(), req.name);
    try {
      fsSync.statSync(p);
      throw new AppError('RULE_EXISTS', `rule already exists: ${req.name}`, 400);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(this.rulesProjectDir(), { recursive: true });
    await fs.writeFile(p, req.content, 'utf-8');
  }

  async updateRuleContent(req: RuleUpdateRequest): Promise<void> {
    validateSimpleName(req.name);
    const p = path.join(this.rulesProjectDir(), req.name);
    try {
      fsSync.statSync(p);
    } catch {
      throw new AppError('RULE_NOT_FOUND', `rule not found: ${req.name}`, 404);
    }
    await fs.writeFile(p, req.content, 'utf-8');
  }

  async deleteRule(name: string): Promise<void> {
    validateSimpleName(name);
    const src = path.join(this.rulesProjectDir(), name);
    try {
      fsSync.statSync(src);
    } catch {
      throw new AppError('RULE_NOT_FOUND', `rule not found: ${name}`, 404);
    }
    await this.uninstallRule(name);
    await fs.rm(src, { recursive: true, force: true });
  }

  async installRule(name: string): Promise<void> {
    validateSimpleName(name);
    const src = path.join(this.rulesProjectDir(), name);
    try {
      fsSync.statSync(src);
    } catch {
      throw new AppError('RULE_NOT_FOUND', `rule not found: ${name}`, 400);
    }
    const homeDir = this.rulesHomeDir();
    await fs.mkdir(homeDir, { recursive: true });
    const dst = path.join(homeDir, name);
    ensureSymlink(src, dst);
  }

  async uninstallRule(name: string): Promise<void> {
    validateSimpleName(name);
    const dst = path.join(this.rulesHomeDir(), name);
    await fs.rm(dst, { recursive: true, force: true });
  }

  async getRuleContent(name: string): Promise<string> {
    validateSimpleName(name);
    const p = path.join(this.rulesProjectDir(), name);
    try {
      return await readAssetEntryContent(p);
    } catch {
      throw new AppError('RULE_NOT_FOUND', `rule not found: ${name}`, 404);
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async runSkillInstall(
    preset: SkillPresetDef,
    key: string,
    action: 'install' | 'update',
  ): Promise<void> {
    const args = ['skills', 'add', preset.repo, '-g', '--agent', 'claude-code', '-y'];
    if (preset.skill) args.push('-s', preset.skill);
    const r = await this.deps.runner.run('npx', args);
    if (r.code !== 0) {
      this.skillOps.set(key, { action, error: `安装失败: ${preset.name}` });
      setTimeout(() => {
        const e = this.skillOps.get(key);
        if (e && e.error !== '') this.skillOps.delete(key);
      }, 30_000);
    } else {
      this.skillOps.delete(key);
    }
  }

  private async runSkillUninstall(name: string, key: string): Promise<void> {
    await this.deps.runner.run('npx', ['skills', 'remove', name, '--agent', 'claude-code', '-y']);
    const skillPath = path.join(this.skillsHomeDir(), name);
    try {
      await fs.rm(skillPath, { recursive: true, force: true });
      this.skillOps.delete(key);
    } catch (err) {
      this.skillOps.set(key, { action: 'uninstall', error: `卸载失败: ${name}` });
      setTimeout(() => {
        const e = this.skillOps.get(key);
        if (e && e.error !== '') this.skillOps.delete(key);
      }, 30_000);
    }
  }
}

// ── helpers (exported for tests / codex-assets) ───────────────────────────

export function loadSkillPresets(rootDir: string): SkillPresetDef[] {
  try {
    const raw = fsSync.readFileSync(path.join(rootDir, 'conf', 'skill-presets.yaml'), 'utf-8');
    const parsed = YAML.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SkillPresetDef[];
  } catch {
    return [];
  }
}

export async function listAssets(projectDir: string, homeDir: string): Promise<AssetItem[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(projectDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AppError('LIST_FAILED', `failed to list ${projectDir}: ${(err as Error).message}`, 500);
  }
  const items: AssetItem[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const dst = path.join(homeDir, entry.name);
    let installed = false;
    try { fsSync.lstatSync(dst); installed = true; } catch { /* not installed */ }
    items.push({ name: entry.name, installed });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export function validateSimpleName(name: string): void {
  if (name.trim() === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new AppError('INVALID_INPUT', 'invalid name', 400);
  }
}

const PREFERRED_FILES = ['SKILL.md', 'README.md', 'readme.md', 'rule.md', 'command.md'];
const ALLOWED_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.sh']);

export async function readAssetEntryContent(targetPath: string): Promise<string> {
  const info = fsSync.statSync(targetPath);
  if (!info.isDirectory()) {
    return fsSync.readFileSync(targetPath, 'utf-8');
  }

  for (const preferred of PREFERRED_FILES) {
    const p = path.join(targetPath, preferred);
    try {
      return fsSync.readFileSync(p, 'utf-8');
    } catch { /* try next */ }
  }

  const captured: string[] = [];
  walkDir(targetPath, (filePath) => {
    if (captured.length >= 8) return;
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) return;
    const content = fsSync.readFileSync(filePath, 'utf-8');
    const rel = path.relative(targetPath, filePath);
    captured.push(`## ${rel}\n${content}`);
  });

  if (captured.length > 0) return captured.join('\n\n');

  const names = fsSync.readdirSync(targetPath).sort();
  return `directory entries:\n- ${names.join('\n- ')}`;
}

function walkDir(dir: string, cb: (filePath: string) => void): void {
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(p, cb);
    else if (entry.isFile()) cb(p);
  }
}
