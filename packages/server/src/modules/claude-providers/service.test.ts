import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeProvidersService } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cprov-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cprov-home-'));
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
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

describe('ClaudeProvidersService', () => {
  it('readStore returns empty for missing file', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    const s = await svc.readStore();
    expect(s.providers).toEqual([]);
    expect(s.activeProvider).toBe('');
  });

  it('add then list', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({ name: 'p1', baseUrl: '', token: '', model: 'm', haikuModel: '' });
    const s = await svc.readStore();
    expect(s.providers.length).toBe(1);
    expect(s.providers[0].name).toBe('p1');
    expect(s.providers[0].baseUrl).toBe('http://localhost:4141');
    expect(s.providers[0].token).toBe('dummy');
  });

  it('add rejects duplicates', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({ name: 'p1', baseUrl: '', token: '', model: '', haikuModel: '' });
    await expect(
      svc.add({ name: 'p1', baseUrl: '', token: '', model: '', haikuModel: '' }),
    ).rejects.toThrow();
  });

  it('update renames active', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({ name: 'p1', baseUrl: 'http://x', token: 't', model: '', haikuModel: '' });
    await svc.apply('p1');
    let s = await svc.readStore();
    expect(s.activeProvider).toBe('p1');
    await svc.update({
      name: 'p1',
      newName: 'p2',
      baseUrl: 'http://y',
      token: 't2',
      model: '',
      haikuModel: '',
    });
    s = await svc.readStore();
    expect(s.activeProvider).toBe('p2');
    expect(s.providers[0].name).toBe('p2');
  });

  it('remove drops active', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({ name: 'p1', baseUrl: '', token: '', model: '', haikuModel: '' });
    await svc.apply('p1');
    await svc.remove('p1');
    const s = await svc.readStore();
    expect(s.providers).toEqual([]);
    expect(s.activeProvider).toBe('');
  });

  it('migrates legacy array format', async () => {
    const { deps, tmp } = makeDeps();
    const p = path.join(tmp, 'data', 'claude-providers.json');
    fs.writeFileSync(
      p,
      JSON.stringify([
        { name: 'old', baseUrl: 'http://x', token: 't', model: '', haikuModel: '' },
      ]),
    );
    const svc = new ClaudeProvidersService(deps);
    const s = await svc.readStore();
    expect(s.providers.length).toBe(1);
    expect(s.providers[0].name).toBe('old');
    expect(s.activeProvider).toBe('');
  });
});
