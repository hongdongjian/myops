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
    const { deps, tmp } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({ name: 'p1', baseUrl: '', token: '', model: 'm', haikuModel: '' });
    const s = await svc.readStore();
    expect(s.providers.length).toBe(1);
    expect(s.providers[0].name).toBe('p1');
    expect(s.providers[0].baseUrl).toBe('http://localhost:4141');
    expect(s.providers[0].token).toBe('dummy');
    expect(fs.existsSync(path.join(tmp, 'conf', 'claude', 'providers.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'claude-providers.json'))).toBe(false);
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

  it('reads array format from conf', async () => {
    const { deps, tmp } = makeDeps();
    const p = path.join(tmp, 'conf', 'claude', 'providers.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
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

  it('ignores data providers and reads the conf store', async () => {
    const { deps, tmp } = makeDeps();
    const old = { activeProvider: 'old', providers: [{ name: 'old' }] };
    fs.writeFileSync(path.join(tmp, 'data', 'claude-providers.json'), JSON.stringify(old));
    const svc = new ClaudeProvidersService(deps);
    expect(await svc.readStore()).toEqual({ activeProvider: '', providers: [] });

    const current = { activeProvider: 'current', providers: [{ name: 'current' }] };
    const p = path.join(tmp, 'conf', 'claude', 'providers.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(current));
    expect(await svc.readStore()).toEqual(current);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'claude-providers.json'), 'utf-8'))).toEqual(old);
  });

  it('apply skips empty model mappings even when legacy model is set', async () => {
    const { deps, home } = makeDeps();
    const svc = new ClaudeProvidersService(deps);
    await svc.add({
      name: 'p1',
      baseUrl: 'http://x',
      token: 't',
      model: 'legacy-model',
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
    });

    await svc.apply('p1');

    const settingsPath = path.join(home, '.claude', 'settings.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { env: Record<string, string> };
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://x');
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('t');
    expect(written.env.ANTHROPIC_MODEL).toBeUndefined();
    expect(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(written.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();

    const store = await svc.readStore();
    expect(store.providers[0].sonnetModel).toBe('');
    expect(store.providers[0].opusModel).toBe('');
    expect(store.providers[0].haikuModel).toBe('');
  });
});
