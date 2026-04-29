import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodexAgentsService } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-home-'));
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
      runner: { run: async () => ({ stdout: '', stderr: '', code: 0 }) } as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

describe('CodexAgentsService', () => {
  it('get returns exists=false when file missing', async () => {
    const { deps } = makeDeps();
    const svc = new CodexAgentsService(deps);
    const r = await svc.get();
    expect(r.exists).toBe(false);
    expect(r.content).toBe('');
  });

  it('save then get reflects content', async () => {
    const { deps } = makeDeps();
    const svc = new CodexAgentsService(deps);
    await svc.save('# hello');
    const r = await svc.get();
    expect(r.exists).toBe(true);
    expect(r.content).toBe('# hello');
  });

  it('sync writes home file', async () => {
    const { deps } = makeDeps();
    const svc = new CodexAgentsService(deps);
    await svc.save('agents body');
    await svc.sync();
    const homeContent = fs.readFileSync(svc.homePath(), 'utf-8');
    expect(homeContent).toBe('agents body');
  });

  it('sync throws when local missing', async () => {
    const { deps } = makeDeps();
    const svc = new CodexAgentsService(deps);
    await expect(svc.sync()).rejects.toThrow();
  });

  it('syncStatus reports synced=true after sync', async () => {
    const { deps } = makeDeps();
    const svc = new CodexAgentsService(deps);
    await svc.save('payload');
    await svc.sync();
    const r = await svc.syncStatus();
    expect(r.synced).toBe(true);
    expect(r.localExists).toBe(true);
  });
});
