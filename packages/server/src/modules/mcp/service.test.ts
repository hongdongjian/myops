import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XHSService, parseLinesParameter } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string; runs: Array<{ cmd: string; args: string[] }> } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-svc-'));
  const paths = createPaths(tmp);
  const runs: Array<{ cmd: string; args: string[] }> = [];
  const runner = {
    async run(cmd: string, args: string[] = []) {
      runs.push({ cmd, args });
      return { stdout: 'login triggered\n', stderr: '', code: 0 };
    },
  };
  const procStore = new Map<string, any>();
  const processMgr = {
    async spawn(name: string, spec: any) {
      procStore.set(name, { pid: 999, startedAt: Date.now(), command: spec.cmd, args: spec.args ?? [], logPath: paths.dataPath('logs', `${name}.log`) });
      return { pid: 999 };
    },
    status(name: string) {
      const s = procStore.get(name);
      if (!s) return { running: false };
      return { running: true, pid: s.pid, startedAt: s.startedAt, command: s.command, args: [...s.args], logPath: s.logPath };
    },
    async stop(name: string) { procStore.delete(name); },
  };
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: runner as any,
      store: {} as any,
      processMgr: processMgr as any,
    },
    tmp,
    runs,
  };
}

describe('XHSService helpers', () => {
  it('parseLinesParameter clamps and defaults', () => {
    expect(parseLinesParameter(undefined, 300, 3000)).toBe(300);
    expect(parseLinesParameter('abc', 300, 3000)).toBe(300);
    expect(parseLinesParameter('-5', 300, 3000)).toBe(300);
    expect(parseLinesParameter('5000', 300, 3000)).toBe(3000);
    expect(parseLinesParameter('100', 300, 3000)).toBe(100);
  });
});

describe('XHSService cookies', () => {
  it('clearCookieFiles removes cookie files only', async () => {
    const { deps } = makeDeps();
    const svc = new XHSService(deps);
    fs.mkdirSync(svc.xhsDataPath(), { recursive: true });
    fs.writeFileSync(svc.xhsDataPath('cookie.json'), 'old');
    fs.writeFileSync(svc.xhsDataPath('session-cookie.txt'), 'old');
    fs.writeFileSync(svc.xhsDataPath('notes.txt'), 'keep');

    const removed = await svc.clearCookieFiles();
    expect(removed).toEqual(['cookie.json', 'session-cookie.txt']);
    expect(fs.existsSync(svc.xhsDataPath('cookie.json'))).toBe(false);
    expect(fs.existsSync(svc.xhsDataPath('session-cookie.txt'))).toBe(false);
    expect(fs.existsSync(svc.xhsDataPath('notes.txt'))).toBe(true);
  });

  it('detectCookieFile reports first cookie when present', async () => {
    const { deps } = makeDeps();
    const svc = new XHSService(deps);
    fs.mkdirSync(svc.xhsDataPath(), { recursive: true });
    fs.writeFileSync(svc.xhsDataPath('cookie.json'), 'x');
    const r = await svc.detectCookieFile();
    expect(r.hasCookie).toBe(true);
    expect(r.cookieFile).toBe('cookie.json');
  });

  it('detectCookieFile reports none when data dir missing', async () => {
    const { deps } = makeDeps();
    const svc = new XHSService(deps);
    const r = await svc.detectCookieFile();
    expect(r.hasCookie).toBe(false);
    expect(r.cookieFile).toBe('');
  });
});

describe('XHSService autostart', () => {
  it('persists toggle across instances', async () => {
    const { deps } = makeDeps();
    const svc = new XHSService(deps);
    expect(svc.getAutostart().enabled).toBe(false);
    await svc.setAutostart(true);
    const svc2 = new XHSService(deps);
    expect(svc2.getAutostart().enabled).toBe(true);
  });
});

describe('XHSService getStatus shape', () => {
  it('returns shape with process+health+auth+package', async () => {
    const { deps } = makeDeps();
    const svc = new XHSService(deps);
    const s = await svc.getStatus();
    expect((s.process as any).name).toBe('xiaohongshu-mcp');
    expect((s.process as any).running).toBe(false);
    expect((s.health as any).state).toBe('ERROR');
    expect((s.auth as any).hasCookie).toBe(false);
    expect((s.package as any).path).toContain('tool/xhs');
  });
});
