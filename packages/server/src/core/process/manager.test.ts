import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state.js';
import { ProcessManager } from './manager.js';

describe('ProcessManager', () => {
  let tmp: string;
  let mgr: ProcessManager;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
    mgr = new ProcessManager(new StateStore(path.join(tmp, 'state.json')), path.join(tmp, 'logs'));
  });

  afterEach(async () => {
    try { await mgr.stop('sleeper'); } catch {}
    try { await mgr.stop('quick'); } catch {}
  });

  it('spawns and reports running with full metadata, then stops', async () => {
    const r = await mgr.spawn('sleeper', { cmd: 'sleep', args: ['5'] });
    expect(r.pid).toBeGreaterThan(0);
    const s = mgr.status('sleeper');
    expect(s.running).toBe(true);
    expect(s.pid).toBe(r.pid);
    expect(s.command).toBe('sleep');
    expect(s.args).toEqual(['5']);
    expect(s.logPath).toBe(path.join(tmp, 'logs', 'sleeper.log'));
    expect(typeof s.startedAt).toBe('number');
    await mgr.stop('sleeper');
    const s2 = mgr.status('sleeper');
    expect(s2.running).toBe(false);
  });

  it('persists metadata across StateStore reloads', async () => {
    await mgr.spawn('sleeper', { cmd: 'sleep', args: ['5'] });
    const reloaded = new ProcessManager(
      new StateStore(path.join(tmp, 'state.json')),
      path.join(tmp, 'logs'),
    );
    const s = reloaded.status('sleeper');
    expect(s.running).toBe(true);
    expect(s.command).toBe('sleep');
    expect(s.args).toEqual(['5']);
    expect(s.logPath).toBe(path.join(tmp, 'logs', 'sleeper.log'));
    await reloaded.stop('sleeper');
  });

  it('detects dead pid and cleans state', async () => {
    await mgr.spawn('quick', { cmd: 'true' });
    await new Promise((res) => setTimeout(res, 300));
    expect(mgr.status('quick').running).toBe(false);
  });
});
