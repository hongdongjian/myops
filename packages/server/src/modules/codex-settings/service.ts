import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import {
  setTomlStringValue,
  setTomlRawValue,
  findTomlStringValue,
  hasSectionInToml,
  removeTomlSection,
  removeTomlKeyFromSection,
  removeTomlRootKey,
  syncTomlExistingKeysFromTemplate,
  stripTomlInlineComment,
  parseTomlSection,
  parseTomlKeyValue,
} from '../../core/toml/index.js';
import type { CodexConfigFields } from './schema.js';

export const CODEX_DEFAULT_BASE_URL = 'http://localhost:4141';
export const CODEX_DEFAULT_API_KEY = 'dummy';

export class CodexSettingsService {
  constructor(private readonly deps: Deps) {}

  configPath(): string {
    return this.deps.paths.codexPath('config.toml');
  }
  templatePath(): string {
    return this.deps.paths.confPath('codex', 'config.toml');
  }
  authPath(): string {
    return this.deps.paths.codexPath('auth.json');
  }
  notifyTemplatePath(): string {
    return this.deps.paths.confPath('codex', 'notify.py');
  }
  notifyHomePath(): string {
    return this.deps.paths.codexPath('notify.py');
  }

  expandNotifyPathForHome(content: string): string {
    return content.split('~/.codex/notify.py').join(this.notifyHomePath());
  }

  private toDisplayPath(p: string): string {
    const home = this.deps.paths.homeDir;
    if (p === home) return '~';
    if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
    return p;
  }

  async syncNotifyScript(): Promise<void> {
    let source: Buffer;
    try {
      source = await fs.readFile(this.notifyTemplatePath());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    const dest = this.notifyHomePath();
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, source);
  }

  async readConfig(): Promise<{ content: string; exists: boolean }> {
    return readTextFile(this.configPath());
  }

  async readAuthRaw(): Promise<Record<string, unknown>> {
    let data: string;
    try {
      data = await fs.readFile(this.authPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    const parsed = JSON.parse(data);
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as Record<string, unknown>;
  }

  async getSettings(): Promise<{ baseUrl: string; apiKey: string; model: string; authMode: boolean; path: string }> {
    const { content } = await this.readConfig();
    const fields = parseCodexConfigFields(content);
    const auth = await this.readAuthRaw();
    fields.modelProvider = codexModelProvider(content);
    fields.baseUrl = normalizeCodexBaseURL(fields.baseUrl);
    fields.apiKey = normalizeCodexAPIKey(codexAuthAPIKey(auth));
    const isLoginAuth = fields.modelProvider.trim().toLowerCase() === 'openai';
    return {
      baseUrl: fields.baseUrl,
      apiKey: fields.apiKey,
      model: fields.model,
      authMode: isLoginAuth,
      path: this.configPath(),
    };
  }

  async saveSettings(input: { baseUrl: string; apiKey: string; model: string }): Promise<void> {
    const baseUrl = normalizeCodexBaseURL(input.baseUrl);
    const apiKey = normalizeCodexAPIKey(input.apiKey);
    const model = input.model.trim();

    const path0 = this.configPath();
    const { content: homeContent } = await readTextFile(path0);

    let updated = sanitizeCodexConfigContent(homeContent);
    if (model !== '') {
      updated = setTomlStringValue(updated, '', 'model', model, true).content;
    }

    const modelProvider = codexModelProvider(updated);

    if (modelProvider.toLowerCase() === 'custom') {
      if (!hasSectionInToml(updated, 'model_providers.custom')) {
        updated = addCodexCustomProviderBlock(updated, baseUrl);
      } else {
        updated = setTomlStringValue(updated, 'model_providers.custom', 'base_url', baseUrl, true).content;
      }
      updated = setTomlStringValue(updated, '', 'model_provider', 'custom', true).content;
      updated = setTomlStringValue(updated, 'model_providers.custom', 'name', 'custom', true).content;
      updated = removeTomlKeyFromSection(updated, 'model_providers.custom', 'api_key');
    }

    await fs.mkdir(path.dirname(path0), { recursive: true });
    await fs.writeFile(path0, updated);

    if (modelProvider.toLowerCase() === 'custom') {
      await this.saveAuthAPIKey(apiKey);
    }
  }

  async setAuthMode(input: { enabled: boolean; baseUrl: string; apiKey: string }): Promise<void> {
    const path0 = this.configPath();
    const { content } = await readTextFile(path0);

    let updated: string;
    if (input.enabled) {
      updated = sanitizeCodexConfigContent(content);
      updated = removeTomlSection(updated, 'model_providers.custom');
      updated = removeTomlSection(updated, 'model_providers.openai');
      updated = setTomlStringValue(updated, '', 'model_provider', 'openai', true).content;
    } else {
      let source = sanitizeCodexConfigContent(content);
      source = removeTomlSection(source, 'model_providers.openai');
      const fields = parseCodexConfigFields(content);
      let baseUrl = normalizeCodexBaseURL(input.baseUrl);
      if (input.baseUrl.trim() === '') baseUrl = normalizeCodexBaseURL(fields.baseUrl);
      let apiKey = input.apiKey.trim();
      if (apiKey === '') {
        const auth = await this.readAuthRaw();
        apiKey = codexAuthAPIKey(auth);
      }
      apiKey = normalizeCodexAPIKey(apiKey);

      if (!hasSectionInToml(source, 'model_providers.custom')) {
        updated = addCodexCustomProviderBlock(source, baseUrl);
      } else {
        updated = source;
        updated = setTomlStringValue(updated, 'model_providers.custom', 'base_url', baseUrl, true).content;
      }
      updated = setTomlStringValue(updated, '', 'model_provider', 'custom', true).content;
      updated = setTomlStringValue(updated, 'model_providers.custom', 'name', 'custom', true).content;
      updated = removeTomlKeyFromSection(updated, 'model_providers.custom', 'api_key');

      await this.saveAuthAPIKey(apiKey);
    }

    await fs.mkdir(path.dirname(path0), { recursive: true });
    await fs.writeFile(path0, updated);

    if (input.enabled && this.deps.codexAccounts) {
      await this.deps.codexAccounts.writeSelectedAuthIfAny();
    }
  }

  async applyCustomProvider(input: { baseUrl: string; apiKey: string; model: string }): Promise<void> {
    await this.setAuthMode({ enabled: false, baseUrl: input.baseUrl, apiKey: input.apiKey });
    if (input.model.trim()) {
      const p = this.configPath();
      const { content } = await readTextFile(p);
      const updated = setTomlStringValue(content, '', 'model', input.model.trim(), true).content;
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, updated);
    }
  }

  async setModel(model: string): Promise<void> {
    const trimmed = model.trim();
    if (!trimmed) return;
    const p = this.configPath();
    const { content } = await readTextFile(p);
    const updated = setTomlStringValue(content, '', 'model', trimmed, true).content;
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, updated);
  }

  async getTemplate(): Promise<{ content: string; path: string; exists: boolean }> {
    const tplPath = this.templatePath();
    let data: string;
    try {
      data = await fs.readFile(tplPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: '', path: this.toDisplayPath(tplPath), exists: false };
      }
      throw err;
    }
    let content = data;
    return { content, path: this.toDisplayPath(tplPath), exists: true };
  }

  async saveTemplate(rawContent: string): Promise<void> {
    const tplPath = this.templatePath();
    await fs.mkdir(path.dirname(tplPath), { recursive: true });
    await fs.writeFile(tplPath, rawContent);

    const homePath = this.configPath();
    const homeRead = await readTextFile(homePath);
    let homeUpdated = rawContent;
    if (homeRead.exists) {
      homeUpdated = syncTomlExistingKeysFromTemplate(homeRead.content, rawContent);
      homeUpdated = removeCodexStaleRootKeys(homeUpdated, rawContent);
    }

    await fs.mkdir(path.dirname(homePath), { recursive: true });
    await fs.writeFile(homePath, homeUpdated);
  }

  async saveAuthAPIKey(apiKey: string): Promise<void> {
    const encoded = `${JSON.stringify({ OPENAI_API_KEY: normalizeCodexAPIKey(apiKey) }, null, 2)}`;
    const p = this.authPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, encoded);
  }

  async templateSyncStatus(): Promise<{ synced: boolean; templateExists: boolean; targetExists: boolean }> {
    const tplRaw = await readTextFile(this.templatePath());
    const targetRaw = await readTextFile(this.configPath());
    if (!tplRaw.exists || !targetRaw.exists) {
      return { synced: false, templateExists: tplRaw.exists, targetExists: targetRaw.exists };
    }
    const synced = isTomlRootSubset(tplRaw.content, targetRaw.content);
    return { synced, templateExists: true, targetExists: true };
  }

  async postInstallSetup(): Promise<void> {
    const tpl = await readTextFile(this.templatePath());
    if (!tpl.exists) return;
    let content = tpl.content;

    if (parseCodexConfigFields(content).baseUrl.trim() === '') {
      if (hasSectionInToml(content, 'model_providers.custom')) {
        content = setTomlStringValue(content, 'model_providers.custom', 'base_url', CODEX_DEFAULT_BASE_URL, true).content;
      }
    }

    const homeContent = this.expandNotifyPathForHome(content);
    const homePath = this.configPath();
    await fs.mkdir(path.dirname(homePath), { recursive: true }).catch(() => {});
    await fs.writeFile(homePath, homeContent).catch(() => {});

    try {
      await fs.stat(this.authPath());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.saveAuthAPIKey(CODEX_DEFAULT_API_KEY).catch(() => {});
      }
    }

    await this.syncNotifyScript().catch(() => {});
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

export async function readTextFile(p: string): Promise<{ content: string; exists: boolean }> {
  try {
    return { content: await fs.readFile(p, 'utf-8'), exists: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', exists: false };
    throw err;
  }
}

export function codexAuthAPIKey(data: Record<string, unknown>): string {
  const keys = ['APP_KEY', 'OPENAI_API_KEY', 'API_KEY'];
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export function normalizeCodexBaseURL(value: string): string {
  const t = value.trim();
  return t === '' ? CODEX_DEFAULT_BASE_URL : t;
}

export function normalizeCodexAPIKey(value: string): string {
  const t = value.trim();
  return t === '' ? CODEX_DEFAULT_API_KEY : t;
}

export function sanitizeCodexConfigContent(content: string): string {
  let updated = removeTomlRootKey(content, 'api_key');
  updated = removeTomlKeyFromSection(updated, 'model_providers.custom', 'api_key');
  updated = removeTomlKeyFromSection(updated, 'model_providers.openai', 'key');
  return updated;
}

export function parseCodexConfigFields(content: string): CodexConfigFields {
  const fields: CodexConfigFields = { modelProvider: '', baseUrl: '', apiKey: '', model: '' };
  fields.modelProvider = codexModelProvider(content);
  const m = findTomlStringValue(content, '', 'model');
  if (m.ok) fields.model = m.value;
  const b = findTomlStringValue(content, 'model_providers.custom', 'base_url');
  if (b.ok) fields.baseUrl = b.value;
  return fields;
}

export function codexModelProvider(content: string): string {
  const v = findTomlStringValue(content, '', 'model_provider');
  if (v.ok) {
    const t = v.value.trim();
    if (t !== '') return t;
  }
  if (hasSectionInToml(content, 'model_providers.custom')) return 'custom';
  if (hasSectionInToml(content, 'model_providers.openai')) return 'openai';
  return 'custom';
}

export function addCodexCustomProviderBlock(content: string, baseUrl: string): string {
  const trimmed = content.replace(/[\n\r ]+$/, '');
  const block = `\n\n[model_providers.custom]\nname = "custom"\nbase_url = ${JSON.stringify(baseUrl)}\n`;
  return trimmed + block;
}

export function mergeCodexRootLevelFromHome(templateContent: string, homeContent: string): string {
  let updated = templateContent;
  const lines = homeContent.split('\n');
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      inSection = true;
      continue;
    }
    if (inSection) continue;
    const kv = parseTomlKeyValue(trimmed);
    if (!kv.ok) continue;
    if (kv.key === 'notify') continue;
    const value = stripTomlInlineComment(kv.value).trim();
    if (value === '') continue;
    updated = setTomlRawValue(updated, '', kv.key, value, false).content;
  }
  return updated;
}

export function removeCodexStaleRootKeys(homeContent: string, templateContent: string): string {
  const templateKeys = new Set<string>();
  let inSection = false;
  for (const line of templateContent.split('\n')) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      inSection = true;
      continue;
    }
    if (inSection) continue;
    const kv = parseTomlKeyValue(trimmed);
    if (kv.ok) templateKeys.add(kv.key);
  }

  let updated = homeContent;
  let inHomeSection = false;
  for (const line of homeContent.split('\n')) {
    const trimmed = line.trim();
    const sec = parseTomlSection(trimmed);
    if (sec.ok) {
      inHomeSection = true;
      continue;
    }
    if (inHomeSection) continue;
    const kv = parseTomlKeyValue(trimmed);
    if (kv.ok && !templateKeys.has(kv.key)) {
      updated = removeTomlRootKey(updated, kv.key);
    }
  }
  return updated;
}

function isTomlRootSubset(template: string, target: string): boolean {
  const SKIP_KEYS = new Set(['notify']);
  const extractRootKVs = (content: string) => {
    const m = new Map<string, string>();
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (parseTomlSection(t).ok) break;
      const kv = parseTomlKeyValue(t);
      if (kv.ok && !SKIP_KEYS.has(kv.key)) {
        m.set(kv.key, stripTomlInlineComment(kv.value).trim());
      }
    }
    return m;
  };
  const tplKVs = extractRootKVs(template);
  const targetKVs = extractRootKVs(target);
  for (const [k, v] of tplKVs) {
    if (!targetKVs.has(k)) continue;
    if (targetKVs.get(k) !== v) return false;
  }
  return true;
}
