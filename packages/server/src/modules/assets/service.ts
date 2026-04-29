import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { copyDir, ensureSymlink } from '../../core/fsops/index.js';
import type { AssetCategory, AssetEntry } from './schema.js';

const SIMPLE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const ALLOWED_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.sh']);
const PREFERRED_FILES = ['SKILL.md', 'README.md', 'readme.md', 'rule.md', 'command.md'];

function validateSimpleName(name: string): void {
  const trimmed = name.trim();
  if (trimmed === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
  if (!SIMPLE_NAME_RE.test(trimmed)) {
    throw new AppError('INVALID_INPUT', 'name contains invalid characters', 400);
  }
}

function isPathWithinBase(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export class AssetsService {
  constructor(private readonly deps: Deps) {}

  managedPath(...parts: string[]): string {
    return path.join(this.deps.paths.rootDir, 'managed', ...parts);
  }

  resolvePaths(category: AssetCategory): { homePath: string; projectPath: string } {
    return {
      homePath: this.deps.paths.claudePath(category),
      projectPath: this.managedPath(category),
    };
  }

  listEntriesSafe(target: string): AssetEntry[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const result: AssetEntry[] = entries.map((e) => {
      const out: AssetEntry = { name: e.name, isDir: e.isDirectory() };
      if (e.isSymbolicLink()) {
        out.isSymlink = true;
        try {
          out.target = fs.readlinkSync(path.join(target, e.name));
        } catch {
          /* ignore */
        }
      }
      return out;
    });
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  list(category: AssetCategory): {
    category: AssetCategory;
    home: AssetEntry[];
    project: AssetEntry[];
    homePath: string;
    projectPath: string;
  } {
    const { homePath, projectPath } = this.resolvePaths(category);
    return {
      category,
      home: this.listEntriesSafe(homePath),
      project: this.listEntriesSafe(projectPath),
      homePath,
      projectPath,
    };
  }

  async readContent(category: AssetCategory, source: 'home' | 'project', name: string): Promise<string> {
    validateSimpleName(name);
    const { homePath, projectPath } = this.resolvePaths(category);
    const base = source === 'project' ? projectPath : homePath;
    const target = path.join(base, name);
    if (!isPathWithinBase(base, target)) {
      throw new AppError('INVALID_INPUT', 'invalid path', 400);
    }
    return readAssetEntryContent(target);
  }

  async sync(category: AssetCategory): Promise<{ homePath: string; projectPath: string }> {
    const { homePath, projectPath } = this.resolvePaths(category);
    try {
      await fsp.stat(homePath);
    } catch (err) {
      throw new AppError('INVALID_INPUT', `home path unavailable: ${(err as Error).message}`, 400);
    }
    await fsp.rm(projectPath, { recursive: true, force: true });
    copyDir(homePath, projectPath);
    if (category === 'skills') {
      await this.syncSkillLinks(homePath);
    }
    return { homePath, projectPath };
  }

  async uninstall(category: AssetCategory, name: string, removeProject: boolean): Promise<void> {
    validateSimpleName(name);
    const { homePath, projectPath } = this.resolvePaths(category);
    const homeTarget = path.join(homePath, name);
    if (isPathWithinBase(homePath, homeTarget)) {
      await fsp.rm(homeTarget, { recursive: true, force: true });
    }
    if (removeProject) {
      const projectTarget = path.join(projectPath, name);
      if (isPathWithinBase(projectPath, projectTarget)) {
        await fsp.rm(projectTarget, { recursive: true, force: true });
      }
    }
    if (category === 'skills') {
      const linkTarget = path.join(this.managedPath('skills-links'), name);
      await fsp.rm(linkTarget, { recursive: true, force: true });
    }
  }

  private async syncSkillLinks(homeSkillsPath: string): Promise<void> {
    const linkDir = this.managedPath('skills-links');
    await fsp.rm(linkDir, { recursive: true, force: true });
    await fsp.mkdir(linkDir, { recursive: true });
    const entries = this.listEntriesSafe(homeSkillsPath);
    for (const entry of entries) {
      const target = path.join(homeSkillsPath, entry.name);
      const linkPath = path.join(linkDir, entry.name);
      ensureSymlink(target, linkPath);
    }
  }
}

export async function readAssetEntryContent(target: string): Promise<string> {
  const stat = await fsp.stat(target);
  if (!stat.isDirectory()) {
    return fsp.readFile(target, 'utf-8');
  }

  for (const preferred of PREFERRED_FILES) {
    const p = path.join(target, preferred);
    try {
      return await fsp.readFile(p, 'utf-8');
    } catch {
      /* keep searching */
    }
  }

  const captured: string[] = [];
  await walkLimited(target, async (filePath, relativePath) => {
    if (captured.length >= 8) return false;
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return true;
    const content = await fsp.readFile(filePath, 'utf-8');
    captured.push(`## ${relativePath}\n${content}`);
    return true;
  });
  if (captured.length > 0) return captured.join('\n\n');

  const entries = await fsp.readdir(target);
  entries.sort();
  return `directory entries:\n- ${entries.join('\n- ')}`;
}

async function walkLimited(
  base: string,
  visit: (filePath: string, relativePath: string) => Promise<boolean>,
): Promise<void> {
  async function recurse(current: string): Promise<boolean> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!(await recurse(full))) return false;
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(base, full);
      if (!(await visit(full, rel))) return false;
    }
    return true;
  }
  await recurse(base);
}
