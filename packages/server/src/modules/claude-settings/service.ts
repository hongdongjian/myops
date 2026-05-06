import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';

const ANTHROPIC_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
]);

type JSONObject = Record<string, unknown>;

export class ClaudeSettingsService {
  constructor(private readonly deps: Deps) {}

  // ── paths ────────────────────────────────────────────────────────────────

  settingsPath(): string {
    return this.deps.paths.claudePath('settings.json');
  }

  globalConfigPath(): string {
    return path.join(this.deps.paths.homeDir, '.claude.json');
  }

  globalConfigTemplatePath(): string {
    return this.deps.paths.confPath('claude', 'claude.json');
  }

  templatePath(): string {
    return this.deps.paths.confPath('claude', 'settings.json');
  }

  powerlineConfPath(): string {
    return this.deps.paths.confPath('claude', 'claude-powerline.json');
  }

  powerlineHomePath(): string {
    return this.deps.paths.claudePath('claude-powerline.json');
  }

  // ── settings GET/SAVE ────────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, unknown>> {
    const m = await readJSONObject(this.settingsPath());
    const gc = await readJSONObject(this.globalConfigPath());
    return {
      baseUrl: envStr(m, 'ANTHROPIC_BASE_URL'),
      authToken: envStr(m, 'ANTHROPIC_AUTH_TOKEN'),
      model: envStr(m, 'ANTHROPIC_MODEL'),
      haikuModel: envStr(m, 'ANTHROPIC_DEFAULT_HAIKU_MODEL'),
      autoCompactEnabled: autoCompactEnabled(gc),
      path: this.toDisplayPath(this.settingsPath()),
    };
  }

  private toDisplayPath(p: string): string {
    const home = this.deps.paths.homeDir;
    if (p === home) return '~';
    if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
    return p;
  }

  async saveSettings(req: { baseUrl: string; authToken: string; model: string; haikuModel: string }): Promise<void> {
    const settingsPath = this.settingsPath();
    const m = await readJSONObject(settingsPath);
    const env = (m.env as JSONObject) ?? {};

    if (req.baseUrl) env.ANTHROPIC_BASE_URL = req.baseUrl;
    else delete env.ANTHROPIC_BASE_URL;

    if (req.authToken) env.ANTHROPIC_AUTH_TOKEN = req.authToken;
    else delete env.ANTHROPIC_AUTH_TOKEN;

    if (req.model) {
      env.ANTHROPIC_MODEL = req.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = req.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = req.model;
    } else {
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    }
    if (req.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = req.haikuModel;
    else delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    m.env = env;

    await writeJSONIndented(settingsPath, m);

    // sync powerline conf to home
    try {
      const plData = await fs.readFile(this.powerlineConfPath(), 'utf-8');
      const dest = this.powerlineHomePath();
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, plData);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  // ── auto compact ─────────────────────────────────────────────────────────

  async setAutoCompact(enabled: boolean): Promise<void> {
    const p = this.globalConfigPath();
    const m = await readJSONObject(p);
    m.autoCompactEnabled = enabled;
    await writeJSONIndented(p, m);
  }

  // ── template ─────────────────────────────────────────────────────────────

  async getTemplate(): Promise<{ content: string; path: string; exists: boolean }> {
    const p = this.templatePath();
    try {
      const data = await fs.readFile(p, 'utf-8');
      return { content: data, path: this.toDisplayPath(p), exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: '', path: this.toDisplayPath(p), exists: false };
      }
      throw err;
    }
  }

  async saveTemplate(content: string): Promise<void> {
    if (!isValidJSON(content)) {
      throw new AppError('INVALID_INPUT', 'content must be valid JSON', 400);
    }
    const templatePath = this.templatePath();
    await fs.mkdir(path.dirname(templatePath), { recursive: true });
    await fs.writeFile(templatePath, content);

    const settingsPath = this.settingsPath();
    const incoming = JSON.parse(content) as JSONObject;
    const existing = await readJSONObject(settingsPath);
    const merged: JSONObject = { ...incoming };
    for (const key of ['enabledPlugins', 'extraKnownMarketplaces', 'statusLine'] as const) {
      if (key in existing) merged[key] = existing[key];
    }
    await writeJSONIndented(settingsPath, merged);
  }

  // ── onboarding ───────────────────────────────────────────────────────────

  async getOnboarding(): Promise<{ skipped: boolean }> {
    try {
      const data = await fs.readFile(this.globalConfigPath(), 'utf-8');
      const m = JSON.parse(data) as JSONObject;
      return { skipped: Boolean(m.hasCompletedOnboarding) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { skipped: false };
      throw err;
    }
  }

  async skipOnboarding(): Promise<void> {
    const p = this.globalConfigPath();
    const m = await readJSONObject(p);
    m.hasCompletedOnboarding = true;
    await writeJSONIndented(p, m);
  }

  // ── global config (~/.claude.json) ───────────────────────────────────────

  async getGlobalConfig(): Promise<{ content: string; path: string; templatePath: string; exists: boolean }> {
    const tplPath = this.globalConfigTemplatePath();
    const realPath = this.globalConfigPath();
    try {
      const data = await fs.readFile(tplPath, 'utf-8');
      return {
        content: data,
        path: this.toDisplayPath(realPath),
        templatePath: this.toDisplayPath(tplPath),
        exists: true,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          content: '',
          path: this.toDisplayPath(realPath),
          templatePath: this.toDisplayPath(tplPath),
          exists: false,
        };
      }
      throw err;
    }
  }

  async saveGlobalConfig(content: string): Promise<void> {
    if (!isValidJSON(content)) {
      throw new AppError('INVALID_INPUT', 'content must be valid JSON', 400);
    }
    const incoming = JSON.parse(content) as JSONObject;

    const tplPath = this.globalConfigTemplatePath();
    await fs.mkdir(path.dirname(tplPath), { recursive: true });
    await fs.writeFile(tplPath, content);

    const realPath = this.globalConfigPath();
    const existing = await readJSONObject(realPath);
    const merged: JSONObject = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      merged[k] = v;
    }
    await writeJSONIndented(realPath, merged);
  }

  // ── powerline ────────────────────────────────────────────────────────────

  async getPowerline(): Promise<{ content: string; exists: boolean }> {
    try {
      const data = await fs.readFile(this.powerlineConfPath(), 'utf-8');
      return { content: data, exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', exists: false };
      throw err;
    }
  }

  async savePowerline(content: string): Promise<void> {
    if (!isValidJSON(content)) {
      throw new AppError('INVALID_INPUT', 'content must be valid JSON', 400);
    }
    const conf = this.powerlineConfPath();
    await fs.mkdir(path.dirname(conf), { recursive: true });
    await fs.writeFile(conf, content);
    const home = this.powerlineHomePath();
    await fs.mkdir(path.dirname(home), { recursive: true });
    await fs.writeFile(home, content);
  }

  // ── sync status ──────────────────────────────────────────────────────────

  async templateSyncStatus(): Promise<{ synced: boolean; templateExists: boolean; targetExists: boolean }> {
    const tplRaw = await readFileMaybe(this.templatePath());
    const targetRaw = await readFileMaybe(this.settingsPath());
    if (tplRaw === null || targetRaw === null) {
      return { synced: false, templateExists: tplRaw !== null, targetExists: targetRaw !== null };
    }
    let tpl: JSONObject;
    let target: JSONObject;
    try { tpl = JSON.parse(tplRaw) as JSONObject; } catch { return { synced: false, templateExists: true, targetExists: true }; }
    try { target = JSON.parse(targetRaw) as JSONObject; } catch { return { synced: false, templateExists: true, targetExists: true }; }
    return { synced: isJSONSubset(tpl, target), templateExists: true, targetExists: true };
  }

  async globalConfigSyncStatus(): Promise<{ synced: boolean; templateExists: boolean; targetExists: boolean }> {
    const tplRaw = await readFileMaybe(this.globalConfigTemplatePath());
    const targetRaw = await readFileMaybe(this.globalConfigPath());
    if (tplRaw === null || targetRaw === null) {
      return { synced: false, templateExists: tplRaw !== null, targetExists: targetRaw !== null };
    }
    let tpl: JSONObject;
    let target: JSONObject;
    try { tpl = JSON.parse(tplRaw) as JSONObject; } catch { return { synced: false, templateExists: true, targetExists: true }; }
    try { target = JSON.parse(targetRaw) as JSONObject; } catch { return { synced: false, templateExists: true, targetExists: true }; }
    return { synced: isJSONSubset(tpl, target), templateExists: true, targetExists: true };
  }

}

// ── helpers ────────────────────────────────────────────────────────────────

async function readJSONObject(p: string): Promise<JSONObject> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as JSONObject;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeJSONIndented(p: string, m: JSONObject): Promise<void> {
  const out = JSON.stringify(m, null, 2);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, out);
}

function envStr(m: JSONObject, key: string): string {
  const env = m.env as JSONObject | undefined;
  const v = env?.[key];
  return typeof v === 'string' ? v : '';
}

function autoCompactEnabled(m: JSONObject): boolean {
  const v = m.autoCompactEnabled;
  if (typeof v !== 'boolean') return true;
  return v;
}

function isValidJSON(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

async function readFileMaybe(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf-8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

function isJSONSubset(template: unknown, target: unknown): boolean {
  if (template === null || typeof template !== 'object') {
    return deepEqual(template, target);
  }
  if (Array.isArray(template)) {
    return deepEqual(template, target);
  }
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false;
  const t = template as Record<string, unknown>;
  const r = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(t)) {
    if (!(k in r)) return false;
    if (!isJSONSubset(v, r[k])) return false;
  }
  return true;
}

export { ANTHROPIC_KEYS };
