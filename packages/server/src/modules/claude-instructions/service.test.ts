import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeInstructionsService } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinstr-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cinstr-home-'));
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

describe('ClaudeInstructionsService', () => {
  it('get returns exists=false when file missing', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeInstructionsService(deps);
    const r = await svc.get();
    expect(r.exists).toBe(false);
    expect(r.content).toBe('');
  });

  it('save writes file then get returns content', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeInstructionsService(deps);
    await svc.save('# test\nhi\n');
    const r = await svc.get();
    expect(r.exists).toBe(true);
    expect(r.content).toBe('# test\nhi\n');
  });

  it('syncStatus reflects sync state', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeInstructionsService(deps);
    await svc.save('content');
    let s = await svc.syncStatus();
    expect(s.synced).toBe(false);
    expect(s.localExists).toBe(true);
    await svc.sync();
    s = await svc.syncStatus();
    expect(s.synced).toBe(true);
  });

  it('sync without local raises AppError', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeInstructionsService(deps);
    await expect(svc.sync()).rejects.toThrow();
  });
});
