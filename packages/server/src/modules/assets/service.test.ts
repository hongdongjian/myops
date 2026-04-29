import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AssetsService } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-svc-'));
  // override homedir-based claudePath by using a fake home inside tmp
  const paths = createPaths(tmp);
  // Hack: redirect .claude into tmp/.claude for the test
  (paths as any).claudePath = (...p: string[]) => path.join(tmp, '.claude', ...p);
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

describe('AssetsService', () => {
  it('list returns empty arrays when paths missing', () => {
    const { deps } = makeDeps();
    const svc = new AssetsService(deps);
    const out = svc.list('rules');
    expect(out.category).toBe('rules');
    expect(out.home).toEqual([]);
    expect(out.project).toEqual([]);
  });

  it('sync copies home to project for rules', async () => {
    const { deps, tmp } = makeDeps();
    const homeRules = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(homeRules, { recursive: true });
    fs.writeFileSync(path.join(homeRules, 'a.md'), '# A');
    const svc = new AssetsService(deps);
    const result = await svc.sync('rules');
    expect(result.projectPath).toBe(path.join(tmp, 'managed', 'rules'));
    expect(fs.readFileSync(path.join(result.projectPath, 'a.md'), 'utf-8')).toBe('# A');
  });

  it('sync skills creates skills-links symlinks', async () => {
    const { deps, tmp } = makeDeps();
    const homeSkills = path.join(tmp, '.claude', 'skills');
    fs.mkdirSync(path.join(homeSkills, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(homeSkills, 'demo', 'SKILL.md'), 'demo');
    const svc = new AssetsService(deps);
    await svc.sync('skills');
    const linkDir = path.join(tmp, 'managed', 'skills-links');
    const stat = fs.lstatSync(path.join(linkDir, 'demo'));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('uninstall removes from home and skills-links', async () => {
    const { deps, tmp } = makeDeps();
    const homeSkills = path.join(tmp, '.claude', 'skills');
    fs.mkdirSync(path.join(homeSkills, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(homeSkills, 'demo', 'SKILL.md'), 'demo');
    const svc = new AssetsService(deps);
    await svc.sync('skills');
    await svc.uninstall('skills', 'demo', true);
    expect(fs.existsSync(path.join(homeSkills, 'demo'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'managed', 'skills', 'demo'))).toBe(false);
  });

  it('readContent rejects bad name', async () => {
    const { deps } = makeDeps();
    const svc = new AssetsService(deps);
    await expect(svc.readContent('rules', 'home', '../etc/passwd')).rejects.toThrow(/invalid characters/);
  });

  it('readContent reads SKILL.md preferred file', async () => {
    const { deps, tmp } = makeDeps();
    const dir = path.join(tmp, '.claude', 'skills', 'foo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# foo');
    const svc = new AssetsService(deps);
    const content = await svc.readContent('skills', 'home', 'foo');
    expect(content).toBe('# foo');
  });
});
