import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ClaudePluginService,
  buildDisableArgs,
  buildEnableArgs,
  buildInstallArgs,
  buildMarketplaceAddArgs,
  buildUninstallArgs,
  installedPluginKey,
  normalizePluginScope,
  pluginPackageParts,
} from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

interface FakeClaudeState {
  installed: boolean;
  enabled: boolean;
  marketplaceConfigured: boolean;
  packageId: string;
  scope: string;
  installPath: string;
}

function makeRunner(state: FakeClaudeState) {
  return {
    async run(_cmd: string, args: string[]) {
      if (args.length >= 4 && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
        const data = state.marketplaceConfigured
          ? '[{"name":"copilot-api-marketplace"}]'
          : '[]';
        return { stdout: data, stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'list') {
        if (!state.installed) return { stdout: '[]', stderr: '', code: 0 };
        const json = JSON.stringify([
          {
            id: state.packageId,
            version: '1.0.0',
            scope: state.scope,
            enabled: state.enabled,
            installPath: state.installPath,
            installedAt: '2026-03-10T06:31:18.553Z',
            lastUpdated: '2026-03-10T06:31:18.553Z',
          },
        ]);
        return { stdout: json, stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'install') {
        state.installed = true;
        state.enabled = false;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'enable') {
        state.enabled = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'disable') {
        state.enabled = false;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'uninstall') {
        state.installed = false;
        state.enabled = false;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
        state.marketplaceConfigured = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: `unexpected args: ${args.join(' ')}`, code: 1 };
    },
  };
}

function makeDeps(state: FakeClaudeState): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cplugin-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cplugin-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: makeRunner(state) as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

function writePresets(tmp: string, presets: unknown): void {
  const p = path.join(tmp, 'conf', 'claude', 'plugins.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(presets));
}

describe('pluginPackageParts', () => {
  it('parses scoped names', () => {
    const r = pluginPackageParts('@anthropic/reviewer@team-marketplace');
    expect(r.plugin).toBe('@anthropic/reviewer');
    expect(r.marketplace).toBe('team-marketplace');
  });
  it('rejects missing marketplace', () => {
    expect(() => pluginPackageParts('claude-plugin')).toThrow();
  });
});

describe('build*Args', () => {
  it('marketplace add', () => {
    expect(buildMarketplaceAddArgs('https://x.git#all', 'user')).toEqual([
      'plugin', 'marketplace', 'add', 'https://x.git#all', '--scope', 'user',
    ]);
  });
  it('install/enable/disable/uninstall', () => {
    expect(buildInstallArgs('p@m', 'project')).toEqual(['plugin', 'install', 'p@m', '--scope', 'project']);
    expect(buildEnableArgs('p@m', 'user')).toEqual(['plugin', 'enable', 'p@m', '--scope', 'user']);
    expect(buildDisableArgs('p@m', 'project')).toEqual(['plugin', 'disable', 'p@m', '--scope', 'project']);
    expect(buildUninstallArgs('p@m', 'local')).toEqual(['plugin', 'uninstall', 'p@m', '--scope', 'local']);
  });
});

describe('loadPresets', () => {
  it('returns empty when missing', async () => {
    const state: FakeClaudeState = {
      installed: false, enabled: false, marketplaceConfigured: false,
      packageId: 'p@m', scope: 'user', installPath: '/x',
    };
    const { deps } = makeDeps(state);
    const svc = new ClaudePluginService(deps);
    expect(await svc.loadPresets()).toEqual([]);
  });
  it('normalizes scope and sorts', async () => {
    const state: FakeClaudeState = {
      installed: false, enabled: false, marketplaceConfigured: false,
      packageId: 'p@m', scope: 'user', installPath: '/x',
    };
    const { deps, tmp } = makeDeps(state);
    writePresets(tmp, [
      { name: 'B plugin', package: 'b-plugin@b-marketplace', scope: 'project' },
      { name: 'A plugin', package: 'a-plugin@a-marketplace' },
    ]);
    const svc = new ClaudePluginService(deps);
    const presets = await svc.loadPresets();
    expect(presets.map((p) => p.name)).toEqual(['A plugin', 'B plugin']);
    expect(presets[0].scope).toBe('user');
    expect(presets[1].scope).toBe('project');
  });
});

describe('install + auto-enable mark', () => {
  it('install enables and marks for auto-start', async () => {
    const state: FakeClaudeState = {
      installed: false, enabled: false, marketplaceConfigured: true,
      packageId: 'claude-plugin@copilot-api-marketplace',
      scope: 'user', installPath: '/cache/p',
    };
    const { deps, tmp } = makeDeps(state);
    writePresets(tmp, [
      {
        name: 'claude-plugin',
        package: 'claude-plugin@copilot-api-marketplace',
        source: 'https://github.com/x/y.git#all',
        scope: 'user',
      },
    ]);
    const svc = new ClaudePluginService(deps);
    const r = await svc.install('claude-plugin@copilot-api-marketplace');
    expect(r.ok).toBe(true);
    expect(state.enabled).toBe(true);
    const marks = await svc.loadAutoEnableMarks();
    expect(marks[installedPluginKey('claude-plugin@copilot-api-marketplace', 'user')]).toBe(true);
  });
});

describe('disable clears auto-enable mark', () => {
  it('disable sets mark to false', async () => {
    const state: FakeClaudeState = {
      installed: true, enabled: true, marketplaceConfigured: true,
      packageId: 'claude-plugin@copilot-api-marketplace',
      scope: 'user', installPath: '/cache/p',
    };
    const { deps, tmp } = makeDeps(state);
    writePresets(tmp, [
      {
        name: 'claude-plugin',
        package: 'claude-plugin@copilot-api-marketplace',
        scope: 'user',
      },
    ]);
    const svc = new ClaudePluginService(deps);
    await svc.setAutoEnableMark('claude-plugin@copilot-api-marketplace', 'user', true);
    const r = await svc.disable('claude-plugin@copilot-api-marketplace');
    expect(r.ok).toBe(true);
    expect(state.enabled).toBe(false);
    const marks = await svc.loadAutoEnableMarks();
    expect(marks[installedPluginKey('claude-plugin@copilot-api-marketplace', 'user')]).toBe(false);
  });
});

describe('autoEnableCheck', () => {
  it('re-enables disabled managed plugin', async () => {
    const state: FakeClaudeState = {
      installed: true, enabled: false, marketplaceConfigured: true,
      packageId: 'claude-plugin@copilot-api-marketplace',
      scope: 'user', installPath: '/cache/p',
    };
    const { deps, tmp } = makeDeps(state);
    writePresets(tmp, [
      {
        name: 'claude-plugin',
        package: 'claude-plugin@copilot-api-marketplace',
        scope: 'user',
      },
    ]);
    const svc = new ClaudePluginService(deps);
    await svc.setAutoEnableMark('claude-plugin@copilot-api-marketplace', 'user', true);
    await svc.autoEnableCheck();
    expect(state.enabled).toBe(true);
  });

  it('skips plugin when mark disabled', async () => {
    const state: FakeClaudeState = {
      installed: true, enabled: false, marketplaceConfigured: true,
      packageId: 'claude-plugin@copilot-api-marketplace',
      scope: 'user', installPath: '/cache/p',
    };
    const { deps, tmp } = makeDeps(state);
    writePresets(tmp, [
      {
        name: 'claude-plugin',
        package: 'claude-plugin@copilot-api-marketplace',
        scope: 'user',
      },
    ]);
    const svc = new ClaudePluginService(deps);
    await svc.setAutoEnableMark('claude-plugin@copilot-api-marketplace', 'user', false);
    await svc.autoEnableCheck();
    expect(state.enabled).toBe(false);
  });
});

describe('normalizePluginScope', () => {
  it('defaults to user', () => {
    expect(normalizePluginScope(undefined)).toBe('user');
    expect(normalizePluginScope('')).toBe('user');
    expect(normalizePluginScope('USER')).toBe('user');
  });
  it('rejects invalid', () => {
    expect(() => normalizePluginScope('global')).toThrow();
  });
});
