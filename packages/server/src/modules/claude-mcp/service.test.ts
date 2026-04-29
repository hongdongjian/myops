import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ClaudeMCPService,
  buildPresetInstallArgs,
  buildPresetRemoveArgs,
  normalizeScope,
  readMCPNamesFromConfig,
} from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string; runs: Array<{ args: string[] }> } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcp-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcp-home-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const paths: Paths = {
    rootDir: tmp,
    homeDir: home,
    dataPath: (...p) => path.join(tmp, 'data', ...p),
    confPath: (...p) => path.join(tmp, 'conf', ...p),
    claudePath: (...p) => path.join(home, '.claude', ...p),
    codexPath: (...p) => path.join(home, '.codex', ...p),
  };
  const runs: Array<{ args: string[] }> = [];
  const runner = {
    async run(_cmd: string, args: string[]) {
      runs.push({ args });
      return { stdout: '', stderr: '', code: 0 };
    },
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
    runs,
  };
}

describe('buildPresetInstallArgs', () => {
  it('http preset puts name before --scope', () => {
    const args = buildPresetInstallArgs(
      {
        name: 'context7-mcp',
        description: '',
        install: { transport: 'http', target: 'https://mcp.context7.com/mcp', headers: ['X-Test: value', '   '] },
      },
      'project',
    );
    expect(args).toEqual([
      'mcp', 'add', 'context7-mcp',
      '--scope', 'project',
      '--transport', 'http',
      'https://mcp.context7.com/mcp',
      '--header', 'X-Test: value',
    ]);
  });

  it('command preset uses --env flags sorted by key', () => {
    const args = buildPresetInstallArgs(
      {
        name: 'firecrawl-mcp',
        description: '',
        install: {
          command: ['npx', '-y', 'firecrawl-mcp'],
          env: { FIRECRAWL_API_KEY: 'fc-key', ALPHA: '1' },
        },
      },
      'project',
    );
    expect(args).toEqual([
      'mcp', 'add', 'firecrawl-mcp',
      '--scope', 'project',
      '--env', 'ALPHA=1',
      '--env', 'FIRECRAWL_API_KEY=fc-key',
      '--',
      'npx', '-y', 'firecrawl-mcp',
    ]);
  });

  it('rejects empty preset name', () => {
    expect(() =>
      buildPresetInstallArgs(
        { name: '   ', description: '', install: { transport: 'http', target: 'http://x' } },
        'project',
      ),
    ).toThrow();
  });
});

describe('buildPresetRemoveArgs', () => {
  it('builds remove args', () => {
    expect(buildPresetRemoveArgs('foo', 'user')).toEqual(['mcp', 'remove', '--scope', 'user', 'foo']);
  });
});

describe('normalizeScope', () => {
  it('defaults to local', () => {
    expect(normalizeScope(undefined)).toBe('local');
    expect(normalizeScope('')).toBe('local');
  });
  it('accepts known scopes', () => {
    expect(normalizeScope('project')).toBe('project');
    expect(normalizeScope('USER')).toBe('user');
    expect(normalizeScope('all')).toBe('all');
  });
  it('rejects unknown scopes', () => {
    expect(() => normalizeScope('weird')).toThrow();
  });
});

describe('readMCPNamesFromConfig', () => {
  it('returns empty when missing', async () => {
    const r = await readMCPNamesFromConfig('/nonexistent/path/x.json');
    expect(r).toEqual({ names: [], exists: false });
  });

  it('reads sorted server names', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcp-cfg-'));
    const p = path.join(tmp, 'cfg.json');
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { b: {}, a: {} } }));
    const r = await readMCPNamesFromConfig(p);
    expect(r.names).toEqual(['a', 'b']);
    expect(r.exists).toBe(true);
  });
});

describe('ClaudeMCPService.list', () => {
  it('reports installed/supported when preset config present', async () => {
    const { deps } = makeDeps();
    const presetDir = path.join(deps.paths.confPath('claude'));
    fs.mkdirSync(presetDir, { recursive: true });
    fs.writeFileSync(
      path.join(presetDir, 'mcp-presets.json'),
      JSON.stringify([
        { name: 'foo', description: 'F', install: { transport: 'http', target: 'http://x' } },
      ]),
    );
    fs.writeFileSync(path.join(deps.paths.rootDir, '.mcp.json'), JSON.stringify({ mcpServers: { foo: {}, other: {} } }));
    const svc = new ClaudeMCPService(deps);
    const data = (await svc.list()) as any;
    expect(data.supported[0].name).toBe('foo');
    expect(data.supported[0].installedLocal).toBe(true);
    expect(data.installed.local).toEqual(['foo', 'other']);
    expect(data.others.local).toEqual(['other']);
  });
});
