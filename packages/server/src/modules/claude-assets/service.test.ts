import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ClaudeAssetsService,
  loadSkillPresets,
  validateSimpleName,
  listAssets,
  readAssetEntryContent,
} from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cassets-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cassets-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'conf'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'conf', 'skill-presets.yaml'),
    `- name: superpowers\n  desc: Super skills\n  repo: https://example.com/repo\n  skill: superpowers\n`,
  );
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  const runner = {
    async run() { return { stdout: '', stderr: '', code: 0 }; },
  };
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: runner as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

describe('validateSimpleName', () => {
  it('rejects empty/path traversal', () => {
    expect(() => validateSimpleName('')).toThrow();
    expect(() => validateSimpleName('..')).toThrow();
    expect(() => validateSimpleName('a/b')).toThrow();
    expect(() => validateSimpleName('a\\b')).toThrow();
  });
  it('accepts simple name', () => {
    expect(() => validateSimpleName('foo')).not.toThrow();
  });
});

describe('loadSkillPresets', () => {
  it('returns parsed presets', () => {
    const { deps } = makeDeps();
    const presets = loadSkillPresets(deps.paths.rootDir);
    expect(presets).toHaveLength(1);
    expect(presets[0]!.name).toBe('superpowers');
  });

  it('returns empty when missing', () => {
    expect(loadSkillPresets('/nonexistent')).toEqual([]);
  });
});

describe('listAssets', () => {
  it('reports installed=true when symlink exists', async () => {
    const { deps } = makeDeps();
    const proj = path.join(deps.paths.confPath('claude', 'rules'));
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'rule-a.md'), 'a');
    fs.writeFileSync(path.join(proj, 'rule-b.md'), 'b');
    fs.mkdirSync(path.join(deps.paths.claudePath('rules')), { recursive: true });
    fs.symlinkSync(path.join(proj, 'rule-a.md'), path.join(deps.paths.claudePath('rules'), 'rule-a.md'));
    const items = await listAssets(proj, deps.paths.claudePath('rules'));
    expect(items).toEqual([
      { name: 'rule-a.md', installed: true },
      { name: 'rule-b.md', installed: false },
    ]);
  });

  it('returns empty when project dir missing', async () => {
    const items = await listAssets('/nonexistent/proj', '/nonexistent/home');
    expect(items).toEqual([]);
  });
});

describe('readAssetEntryContent', () => {
  it('reads file content directly', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-'));
    const p = path.join(tmp, 'rule.md');
    fs.writeFileSync(p, '# rule');
    expect(await readAssetEntryContent(p)).toBe('# rule');
  });

  it('prefers SKILL.md inside dir', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-'));
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), 'skill body');
    fs.writeFileSync(path.join(tmp, 'README.md'), 'readme body');
    expect(await readAssetEntryContent(tmp)).toBe('skill body');
  });
});

describe('ClaudeAssetsService rules', () => {
  it('installRule creates symlink in home dir', async () => {
    const { deps } = makeDeps();
    const proj = deps.paths.confPath('claude', 'rules');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'foo.md'), 'x');
    const svc = new ClaudeAssetsService(deps);
    await svc.installRule('foo.md');
    const linked = path.join(deps.paths.claudePath('rules'), 'foo.md');
    expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
  });

  it('uninstallRule removes link', async () => {
    const { deps } = makeDeps();
    const homeDir = deps.paths.claudePath('rules');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.symlinkSync('/nonexistent', path.join(homeDir, 'gone.md'));
    const svc = new ClaudeAssetsService(deps);
    await svc.uninstallRule('gone.md');
    expect(fs.existsSync(path.join(homeDir, 'gone.md'))).toBe(false);
  });

  it('listRules returns sorted asset items', async () => {
    const { deps } = makeDeps();
    const proj = deps.paths.confPath('claude', 'rules');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'b.md'), '');
    fs.writeFileSync(path.join(proj, 'a.md'), '');
    const svc = new ClaudeAssetsService(deps);
    const items = await svc.listRules();
    expect(items.map((i) => i.name)).toEqual(['a.md', 'b.md']);
  });
});

describe('ClaudeAssetsService skills', () => {
  it('listSkills marks installed when dir exists', () => {
    const { deps } = makeDeps();
    fs.mkdirSync(path.join(deps.paths.claudePath('skills'), 'superpowers'), { recursive: true });
    const svc = new ClaudeAssetsService(deps);
    const items = svc.listSkills();
    expect(items[0]!.installed).toBe(true);
  });
});
