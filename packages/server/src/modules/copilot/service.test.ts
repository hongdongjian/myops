import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CopilotService,
  buildVersionStatus,
  parseVersionFromNPMListOutput,
  parseLatestVersionFromNPMView,
  chooseUsageSnapshot,
  parseLinesParameter,
  clampPercent,
  clearVersionCache,
} from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string; runs: Array<{ cmd: string; args: string[] }> } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-svc-'));
  const paths = createPaths(tmp);
  const runs: Array<{ cmd: string; args: string[] }> = [];
  const runner = {
    async run(cmd: string, args: string[] = []) {
      runs.push({ cmd, args });
      if (args[0] === 'list') {
        return { stdout: '/opt/homebrew/lib\n└── @jeffreycao/copilot-api@1.0.0\n', stderr: '', code: 0 };
      }
      if (args[0] === 'view') {
        return { stdout: 'dist-tags:\nlatest: 1.1.0\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const procStore = new Map<string, { pid: number; startedAt: number; command: string; args: string[]; logPath: string }>();
  const processMgr = {
    async spawn(name: string, spec: any) {
      procStore.set(name, {
        pid: 1234,
        startedAt: Date.now(),
        command: spec.cmd,
        args: spec.args ?? [],
        logPath: paths.dataPath('logs', `${name}.log`),
      });
      return { pid: 1234 };
    },
    status(name: string) {
      const s = procStore.get(name);
      if (!s) return { running: false };
      return {
        running: true,
        pid: s.pid,
        startedAt: s.startedAt,
        command: s.command,
        args: [...s.args],
        logPath: s.logPath,
      };
    },
    async stop(name: string) {
      procStore.delete(name);
    },
  };
  const deps: Deps = {
    config: { port: 0, models: [], copilot_proxy_url: 'http://127.0.0.1:7897' } as any,
    paths,
    runner: runner as any,
    store: {} as any,
    processMgr: processMgr as any,
  };
  return { deps, tmp, runs };
}

describe('CopilotService helpers', () => {
  it('parseVersionFromNPMListOutput extracts version', () => {
    expect(parseVersionFromNPMListOutput('└── @jeffreycao/copilot-api@1.2.3\n')).toBe('1.2.3');
    expect(parseVersionFromNPMListOutput('(empty)')).toBe('');
  });

  it('parseLatestVersionFromNPMView prefers latest tag', () => {
    expect(parseLatestVersionFromNPMView('latest: 9.9.9\n')).toBe('9.9.9');
    expect(parseLatestVersionFromNPMView('@jeffreycao/copilot-api@2.0.0\n')).toBe('2.0.0');
  });

  it('buildVersionStatus computes upgrade flag', () => {
    const s = buildVersionStatus(
      '└── @jeffreycao/copilot-api@1.0.0',
      null,
      'latest: 1.1.0',
      null,
    );
    expect(s.installed).toBe(true);
    expect(s.current).toBe('1.0.0');
    expect(s.latest).toBe('1.1.0');
    expect(s.canUpgrade).toBe(true);
    expect(s.upgradeTarget).toBe('1.1.0');
  });

  it('chooseUsageSnapshot prefers premium_interactions', () => {
    const snap = chooseUsageSnapshot({
      other: { quota_id: 'a', entitlement: 1, remaining: 1, percent_remaining: 100, unlimited: false },
      premium_interactions: { quota_id: 'p', entitlement: 100, remaining: 50, percent_remaining: 50, unlimited: false },
    });
    expect(snap?.quota_id).toBe('p');
  });

  it('parseLinesParameter clamps and defaults', () => {
    expect(parseLinesParameter(undefined, 300, 3000)).toBe(300);
    expect(parseLinesParameter('abc', 300, 3000)).toBe(300);
    expect(parseLinesParameter('-5', 300, 3000)).toBe(300);
    expect(parseLinesParameter('5000', 300, 3000)).toBe(3000);
    expect(parseLinesParameter('100', 300, 3000)).toBe(100);
  });

  it('clampPercent clamps to 0-100', () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(50)).toBe(50);
  });
});

describe('CopilotService', () => {
  beforeEach(() => clearVersionCache());

  it('startArgs reflects proxy state', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    expect(svc.startArgs()).toEqual(['start']);
    await svc.setProxy(true);
    expect(svc.startArgs()).toEqual(['start', '--proxy-env']);
  });

  it('startEnv returns proxy vars when enabled', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    expect(svc.startEnv()).toBeNull();
    await svc.setProxy(true);
    expect(svc.startEnv()).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      http_proxy: 'http://127.0.0.1:7897',
      https_proxy: 'http://127.0.0.1:7897',
    });
  });

  it('saveConfig validates JSON', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    await expect(svc.saveConfig('   ')).rejects.toThrow(/required/);
    await expect(svc.saveConfig('not json')).rejects.toThrow(/valid JSON/);
    const r = await svc.saveConfig('{"k":1}');
    expect(r.size).toBe(7);
    expect(fs.readFileSync(r.path, 'utf-8')).toBe('{"k":1}');
  });

  it('autostart persists toggle', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    expect(svc.getAutostart().enabled).toBe(false);
    await svc.setAutostart(true);
    expect(svc.getAutostart().enabled).toBe(true);
    const svc2 = new CopilotService(deps);
    expect(svc2.getAutostart().enabled).toBe(true);
  });

  it('getStatus returns shape with version + auth=null + sourceUrl', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    const status = await svc.getStatus();
    expect(status.process.name).toBe('copilot-api');
    expect(status.process.running).toBe(false);
    expect(status.health).toEqual({ healthy: false, state: 'ERROR' });
    expect(status.version.installed).toBe(true);
    expect(status.auth).toBeNull();
    expect(status.sourceUrl).toContain('github.com');
  });

  it('getProcessStatus reflects real cmd/args/logPath from processMgr after start', async () => {
    const { deps } = makeDeps();
    const svc = new CopilotService(deps);
    await svc.setProxy(true);
    await svc.startProcess();
    const ps = svc.getProcessStatus();
    expect(ps.running).toBe(true);
    expect(ps.command).toBe('copilot-api');
    expect(ps.args).toEqual(['start', '--proxy-env']);
    expect(ps.logPath).toContain('copilot-api.log');
    expect(ps.startedAt).not.toBe('');
  });
});
