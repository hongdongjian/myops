import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeSettingsService } from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csettings-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'csettings-home-'));
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

describe('ClaudeSettingsService', () => {
  it('getSettings returns defaults when no files exist', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    const s = await svc.getSettings();
    expect(s.baseUrl).toBe('');
    expect(s.authToken).toBe('');
    expect(s.autoCompactEnabled).toBe(true);
  });

  it('saveSettings writes env to settings.json', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await svc.saveSettings({ baseUrl: 'http://x', authToken: 't', model: 'm', haikuModel: 'h' });

    const written = JSON.parse(fs.readFileSync(svc.settingsPath(), 'utf-8'));
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://x');
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('t');
    expect(written.env.ANTHROPIC_MODEL).toBe('m');
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('m');
    expect(written.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('h');
  });

  it('setAutoCompact writes flag to global config', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await svc.setAutoCompact(false);
    const gc = JSON.parse(fs.readFileSync(svc.globalConfigPath(), 'utf-8'));
    expect(gc.autoCompactEnabled).toBe(false);
  });

  it('saveTemplate rejects invalid JSON', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await expect(svc.saveTemplate('not json')).rejects.toThrow(/valid JSON/);
  });

  it('skipOnboarding sets hasCompletedOnboarding=true', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await svc.skipOnboarding();
    const gc = JSON.parse(fs.readFileSync(svc.globalConfigPath(), 'utf-8'));
    expect(gc.hasCompletedOnboarding).toBe(true);
  });

  it('getPowerline returns exists=false when missing', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    const r = await svc.getPowerline();
    expect(r.exists).toBe(false);
    expect(r.content).toBe('');
  });

  it('savePowerline rejects invalid JSON', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await expect(svc.savePowerline('not json')).rejects.toThrow(/valid JSON/);
  });

  it('saveGlobalConfig writes template and merges keys into ~/.claude.json', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    fs.mkdirSync(path.dirname(svc.globalConfigPath()), { recursive: true });
    fs.writeFileSync(
      svc.globalConfigPath(),
      JSON.stringify({ keep: 'me', autoCompactEnabled: true })
    );
    const newContent = JSON.stringify(
      { autoCompactEnabled: false, hasCompletedOnboarding: true },
      null,
      2,
    );
    await svc.saveGlobalConfig(newContent);

    const tpl = fs.readFileSync(svc.globalConfigTemplatePath(), 'utf-8');
    expect(tpl).toBe(newContent);

    const gc = JSON.parse(fs.readFileSync(svc.globalConfigPath(), 'utf-8'));
    expect(gc.keep).toBe('me');
    expect(gc.autoCompactEnabled).toBe(false);
    expect(gc.hasCompletedOnboarding).toBe(true);
  });

  it('saveGlobalConfig rejects invalid JSON', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    await expect(svc.saveGlobalConfig('not json')).rejects.toThrow(/valid JSON/);
  });

  it('getGlobalConfig returns empty content when template missing', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    const r = await svc.getGlobalConfig();
    expect(r.exists).toBe(false);
    expect(r.content).toBe('');
  });

  it('getGlobalConfig returns cached template content as-is', async () => {
    const { deps } = makeDeps();
    const svc = new ClaudeSettingsService(deps);
    fs.mkdirSync(path.dirname(svc.globalConfigTemplatePath()), { recursive: true });
    const cached = JSON.stringify({ autoCompactEnabled: false, custom: 1 }, null, 2);
    fs.writeFileSync(svc.globalConfigTemplatePath(), cached);
    const r = await svc.getGlobalConfig();
    expect(r.exists).toBe(true);
    expect(r.content).toBe(cached);
  });
});
