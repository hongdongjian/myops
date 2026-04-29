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
  action: 'install' | 'uninstall';
  error: string;
}

export class CodexAssetsService {
  private readonly skillPresets: SkillPresetDef[];
  private readonly skillOps: Map<string, SkillOpEntry> = new Map();

  constructor(private readonly deps: Deps) {
    this.skillPresets = loadSkillPresets(this.deps.paths.rootDir);
  }

  // Codex skills live at ~/.agents/skills/<name>
  skillsHomeDir(): string {
    return path.join(this.deps.paths.homeDir, '.agents', 'skills');
  }

  listSkills(): SkillPresetItem[] {
    const homeDir = this.skillsHomeDir();
    return this.skillPresets.map((preset) => {
      const dst = path.join(homeDir, preset.name);
      let installed = false;
      try {
        fsSync.lstatSync(dst);
        installed = true;
      } catch { /* not installed */ }
      const item: SkillPresetItem = { name: preset.name, desc: preset.desc, installed };
      const entry = this.skillOps.get(`${AGENT}:${preset.name}`);
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
    const key = `${AGENT}:${name}`;
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
    const key = `${AGENT}:${name}`;
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

  private findSkillPreset(name: string): SkillPresetDef | undefined {
    return this.skillPresets.find((p) => p.name === name);
  }

  private async runSkillInstall(preset: SkillPresetDef, key: string): Promise<void> {
    const args = ['skills', 'add', preset.repo, '-g', '--agent', AGENT, '-y'];
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
    const r = await this.deps.runner.run('npx', ['skills', 'remove', name, '--agent', AGENT, '-y']);
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
