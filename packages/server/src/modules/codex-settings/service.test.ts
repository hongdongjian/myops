import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CodexSettingsService,
  parseCodexConfigFields,
  codexModelProvider,
  sanitizeCodexConfigContent,
  addCodexCustomProviderBlock,
  normalizeCodexBaseURL,
  normalizeCodexAPIKey,
  codexAuthAPIKey,
  mergeCodexRootLevelFromHome,
  removeCodexStaleRootKeys,
} from './service.js';
import type { Deps } from '../../deps.js';
import type { Paths } from '../../paths.js';

function makeDeps(): { deps: Deps; tmp: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxset-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxset-home-'));
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
      config: { port: 0, models: ['gpt-x'] } as any,
      paths,
      runner: { run: async () => ({ stdout: '', stderr: '', code: 0 }) } as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
    home,
  };
}

describe('codex-settings helpers', () => {
  it('parses fields from config', () => {
    const content = [
      'model = "gpt-x"',
      '[model_providers.custom]',
      'base_url = "http://x"',
    ].join('\n');
    const f = parseCodexConfigFields(content);
    expect(f.model).toBe('gpt-x');
    expect(f.baseUrl).toBe('http://x');
    expect(f.modelProvider).toBe('custom');
  });

  it('codexModelProvider falls back to openai then custom', () => {
    expect(codexModelProvider('')).toBe('custom');
    expect(codexModelProvider('[model_providers.openai]\n')).toBe('openai');
    expect(codexModelProvider('model_provider = "openai"\n')).toBe('openai');
  });

  it('sanitize removes api keys', () => {
    const content = [
      'api_key = "leak"',
      '[model_providers.custom]',
      'api_key = "leak2"',
    ].join('\n');
    const out = sanitizeCodexConfigContent(content);
    expect(out).not.toMatch(/api_key/);
  });

  it('addCodexCustomProviderBlock appends block', () => {
    const out = addCodexCustomProviderBlock('model = "x"', 'http://y');
    expect(out).toMatch(/\[model_providers\.custom\]/);
    expect(out).toMatch(/base_url = "http:\/\/y"/);
  });

  it('normalize defaults', () => {
    expect(normalizeCodexBaseURL('')).toBe('http://localhost:4141');
    expect(normalizeCodexAPIKey('')).toBe('dummy');
    expect(normalizeCodexAPIKey('  k  ')).toBe('k');
  });

  it('codexAuthAPIKey prefers APP_KEY', () => {
    expect(codexAuthAPIKey({ APP_KEY: 'a', OPENAI_API_KEY: 'b' })).toBe('a');
    expect(codexAuthAPIKey({ OPENAI_API_KEY: 'b' })).toBe('b');
    expect(codexAuthAPIKey({})).toBe('');
  });

  it('mergeCodexRootLevelFromHome only overrides existing keys', () => {
    const tpl = 'model = "tpl"\n';
    const home = 'model = "real"\nextra = "ignored"\n';
    const out = mergeCodexRootLevelFromHome(tpl, home);
    expect(out).toMatch(/model = "real"/);
    expect(out).not.toMatch(/extra/);
  });

  it('removeCodexStaleRootKeys deletes home keys absent from template', () => {
    const home = 'model = "x"\nstale = "y"\n[model_providers.custom]\nbase_url = "u"\n';
    const tpl = 'model = "x"\n';
    const out = removeCodexStaleRootKeys(home, tpl);
    expect(out).not.toMatch(/stale/);
    expect(out).toMatch(/base_url = "u"/);
  });
});

describe('CodexSettingsService', () => {
  it('saveSettings writes config and api key for custom provider', async () => {
    const { deps } = makeDeps();
    const svc = new CodexSettingsService(deps);
    await svc.saveSettings({ baseUrl: 'http://h', apiKey: 'k1', model: 'm1' });
    const home = fs.readFileSync(svc.configPath(), 'utf-8');
    expect(home).toMatch(/model = "m1"/);
    expect(home).toMatch(/\[model_providers\.custom\]/);
    expect(home).toMatch(/base_url = "http:\/\/h"/);
    const auth = JSON.parse(fs.readFileSync(svc.authPath(), 'utf-8'));
    expect(auth.OPENAI_API_KEY).toBe('k1');
  });

  it('setAuthMode enabled writes openai provider', async () => {
    const { deps } = makeDeps();
    const svc = new CodexSettingsService(deps);
    await svc.setAuthMode({ enabled: true, baseUrl: '', apiKey: '' });
    const home = fs.readFileSync(svc.configPath(), 'utf-8');
    expect(home).toMatch(/model_provider = "openai"/);
    expect(home).not.toMatch(/\[model_providers\.custom\]/);
  });

  it('setAuthMode disabled writes custom provider and auth.json', async () => {
    const { deps } = makeDeps();
    const svc = new CodexSettingsService(deps);
    await svc.setAuthMode({ enabled: false, baseUrl: 'http://h', apiKey: 'kx' });
    const home = fs.readFileSync(svc.configPath(), 'utf-8');
    expect(home).toMatch(/model_provider = "custom"/);
    const auth = JSON.parse(fs.readFileSync(svc.authPath(), 'utf-8'));
    expect(auth.OPENAI_API_KEY).toBe('kx');
  });

  it('getSettings returns defaults when no config exists', async () => {
    const { deps } = makeDeps();
    const svc = new CodexSettingsService(deps);
    const r = await svc.getSettings();
    expect(r.baseUrl).toBe('http://localhost:4141');
    expect(r.apiKey).toBe('dummy');
  });

  it('saveTemplate persists conf file and home file', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new CodexSettingsService(deps);
    const tpl = 'model = "tpl"\n[model_providers.custom]\nbase_url = "http://t"\n';
    await svc.saveTemplate(tpl);
    const tplPath = path.join(tmp, 'conf', 'codex', 'config.toml');
    expect(fs.readFileSync(tplPath, 'utf-8')).toMatch(/model = "tpl"/);
    expect(fs.readFileSync(svc.configPath(), 'utf-8')).toMatch(/base_url = "http:\/\/t"/);
  });
});
