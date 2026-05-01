import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import {
  loadSkillPresets,
  validateSimpleName,
} from '../claude-assets/service.js';
import type { SkillPresetDef, SkillPresetItem } from '../claude-assets/schema.js';

const AGENT = 'codex';

interface SkillOpEntry {
  action: 'install' | 'uninstall' | 'update';
  error: string;
}

export class CodexAssetsService {
  private readonly skillOps: Map<string, SkillOpEntry> = new Map();

  constructor(private readonly deps: Deps) {}

  skillsHomeDir(): string {
    return path.join(this.deps.paths.homeDir, '.agents', 'skills');
  }

  private skillPresetsPath(): string {
    return this.deps.paths.confPath('skill-presets.yaml');
  }

  private async loadPresetsAsync(): Promise<SkillPresetDef[]> {
    try {
      const { default: YAML } = await import('yaml');
      const raw = await fs.readFile(this.skillPresetsPath(), 'utf-8');
      const parsed = YAML.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as SkillPresetDef[];
    } catch {
      return [];
    }
  }

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
      const entry = this.skillOps.get(`${AGENT}:${preset.name}`);
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
    const key = `${AGENT}:${name}`;
    const existing = this.skillOps.get(key);
    if (existing && existing.error === '') {
      throw new AppError('SKILL_BUSY', `skill ${name} operation already in progress`, 500);
    }
    this.skillOps.set(key, { action: 'install', error: '' });
    void this.runSkillInstall(preset, key, 'install');
  }

  async startSkillUninstall(name: string): Promise<void> {
    const key = `${AGENT}:${name}`;
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
    const key = `${AGENT}:${name}`;
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
      const out = r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`;
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

  private async runSkillInstall(
    preset: SkillPresetDef,
    key: string,
    action: 'install' | 'update',
  ): Promise<void> {
    const args = ['skills', 'add', preset.repo, '-g', '--agent', AGENT, '-y'];
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
    await this.deps.runner.run('npx', ['skills', 'remove', name, '--agent', AGENT, '-y']);
    const skillPath = path.join(this.skillsHomeDir(), name);
    try {
      await fs.rm(skillPath, { recursive: true, force: true });
      this.skillOps.delete(key);
    } catch {
      this.skillOps.set(key, { action: 'uninstall', error: `卸载失败: ${name}` });
      setTimeout(() => {
        const e = this.skillOps.get(key);
        if (e && e.error !== '') this.skillOps.delete(key);
      }, 30_000);
    }
  }
}

// Keep static export for backward compat
export { loadSkillPresets };
