import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { ensureSymlink } from '../../core/fsops/index.js';
import type { AssetItem, SkillPresetDef, SkillPresetItem } from './schema.js';

interface SkillOpEntry {
  action: 'install' | 'uninstall';
  error: string;
}

export class ClaudeAssetsService {
  private readonly skillPresets: SkillPresetDef[];
  private readonly skillOps: Map<string, SkillOpEntry> = new Map();

  constructor(private readonly deps: Deps) {
    this.skillPresets = loadSkillPresets(this.deps.paths.rootDir);
  }

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

  // ── skills ───────────────────────────────────────────────────────────────

  listSkills(): SkillPresetItem[] {
    const homeDir = this.skillsHomeDir();
    return this.skillPresets.map((preset) => {
      const dst = path.join(homeDir, preset.name);
      let installed = false;
      try {
        fsSync.lstatSync(dst);
        installed = true;
      } catch { /* not installed */ }
      const item: SkillPresetItem = {
        name: preset.name,
        desc: preset.desc,
        installed,
      };
      const entry = this.skillOps.get(`claude-code:${preset.name}`);
      if (entry) {
        if (entry.error !== '') item.error = entry.error;
        else item.pending = entry.action;
      }
      return item;
    });
  }

  startSkillInstall(name: string): void {
    const preset = this.findSkillPreset(name);
    if (!preset) throw new AppError('UNKNOWN_SKILL', `unknown skill: ${name}`, 500);
    const key = `claude-code:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'install', error: '' });
    void this.runSkillInstall(preset, key);
  }

  startSkillUninstall(name: string): void {
    if (!this.findSkillPreset(name)) {
      throw new AppError('UNKNOWN_SKILL', `unknown skill: ${name}`, 500);
    }
    const key = `claude-code:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'uninstall', error: '' });
    void this.runSkillUninstall(name, key);
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

  private findSkillPreset(name: string): SkillPresetDef | undefined {
    return this.skillPresets.find((p) => p.name === name);
  }

  private async runSkillInstall(preset: SkillPresetDef, key: string): Promise<void> {
    const args = ['skills', 'add', preset.repo, '-g', '--agent', 'claude-code', '-y'];
    if (preset.skill) args.push('-s', preset.skill);
    const r = await this.deps.runner.run('npx', args);
    if (r.code !== 0) {
      this.skillOps.set(key, { action: 'install', error: `安装失败: ${preset.name}` });
      setTimeout(() => {
        const e = this.skillOps.get(key);
        if (e && e.error !== '') this.skillOps.delete(key);
      }, 30_000);
    } else {
      this.skillOps.delete(key);
    }
  }

  private async runSkillUninstall(name: string, key: string): Promise<void> {
    const r = await this.deps.runner.run('npx', ['skills', 'remove', name, '--agent', 'claude-code', '-y']);
    if (r.code !== 0) {
      this.skillOps.set(key, { action: 'uninstall', error: `卸载失败: ${name}` });
      setTimeout(() => {
        const e = this.skillOps.get(key);
        if (e && e.error !== '') this.skillOps.delete(key);
      }, 30_000);
    } else {
      this.skillOps.delete(key);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

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
