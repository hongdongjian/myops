import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodexProvidersService } from './service.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-prov-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  return {
    tmp,
    deps: {
      paths: {
        rootDir: tmp,
        homeDir: home,
        dataPath: (...p) => path.join(tmp, 'data', ...p),
        confPath: (...p) => path.join(tmp, 'conf', ...p),
        claudePath: (...p) => path.join(home, '.claude', ...p),
        codexPath: (...p) => path.join(home, '.codex', ...p),
      },
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    },
  };
}

describe('CodexProvidersService', () => {
  it('ignores data providers and reads the conf store', async () => {
    const { deps, tmp } = makeDeps();
    const old = { activeProvider: 'old', providers: [{ name: 'old' }] };
    fs.writeFileSync(path.join(tmp, 'data', 'codex-providers.json'), JSON.stringify(old));
    const svc = new CodexProvidersService(deps);
    expect(await svc.readStore()).toEqual({ activeProvider: '', providers: [] });

    const current = {
      activeProvider: 'current',
      providers: [{ name: 'current', baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' }],
    };
    const p = path.join(tmp, 'conf', 'codex', 'providers.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(current));
    expect(await svc.readStore()).toEqual(current);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'codex-providers.json'), 'utf-8'))).toEqual(old);
  });

  it('persists edits and active selection in conf', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new CodexProvidersService(deps);
    const provider = { name: 'p1', baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' };
    await svc.add(provider);
    const p = path.join(tmp, 'conf', 'codex', 'providers.json');
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')).providers).toEqual([provider]);
    expect(fs.existsSync(path.join(tmp, 'data', 'codex-providers.json'))).toBe(false);

    await svc.apply('p1');
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')).activeProvider).toBe('p1');
    expect(fs.existsSync(deps.paths.codexPath('config.toml'))).toBe(true);
    await svc.update({ ...provider, newName: 'p2' });
    expect(await new CodexProvidersService(deps).readStore()).toEqual({
      activeProvider: 'p2',
      providers: [{ ...provider, name: 'p2' }],
    });
    await svc.remove('p2');
    expect(JSON.parse(fs.readFileSync(p, 'utf-8'))).toEqual({ activeProvider: '', providers: [] });
  });
});
