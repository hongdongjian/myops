import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';

export const CLAUDE_HOOK_FILES = ['notify-permission.sh', 'notify-stop.sh'];

export const MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
];

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

  templatePath(): string {
    return this.deps.paths.confPath('claude', 'settings.json');
  }

  powerlineConfPath(): string {
    return this.deps.paths.confPath('claude', 'claude-powerline.json');
  }

  powerlineHomePath(): string {
    return this.deps.paths.claudePath('claude-powerline.json');
  }

  hooksDirPath(): string {
    return this.deps.paths.claudePath('hooks');
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
      renderModelEnvEnabled: renderModelEnvEnabled(gc),
      path: this.settingsPath(),
    };
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

    await this.syncHooks();
  }

  // ── auto compact ─────────────────────────────────────────────────────────

  async setAutoCompact(enabled: boolean): Promise<void> {
    const p = this.globalConfigPath();
    const m = await readJSONObject(p);
    m.autoCompactEnabled = enabled;
    await writeJSONIndented(p, m);
  }

  // ── render model env ─────────────────────────────────────────────────────

  async setRenderModelEnv(enabled: boolean): Promise<void> {
    const gcPath = this.globalConfigPath();
    const gc = await readJSONObject(gcPath);
    gc.renderModelEnv = enabled;
    await writeJSONIndented(gcPath, gc);

    const settingsPath = this.settingsPath();
    const m = await readJSONObject(settingsPath);
    const env = (m.env as JSONObject) ?? {};

    if (enabled) {
      try {
        const tmpl = JSON.parse(await fs.readFile(this.templatePath(), 'utf-8')) as JSONObject;
        const tmplEnv = (tmpl.env as JSONObject) ?? {};
        for (const key of MODEL_ENV_KEYS) {
          const v = tmplEnv[key];
          if (typeof v === 'string' && v !== '') env[key] = v;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          // template invalid JSON or unreadable; skip restore
        }
      }
    } else {
      for (const key of MODEL_ENV_KEYS) delete env[key];
    }
    m.env = env;
    await writeJSONIndented(settingsPath, m);
  }

  isRenderModelEnvEnabled(): boolean {
    try {
      const raw = fsSync.readFileSync(this.globalConfigPath(), 'utf-8');
      const gc = JSON.parse(raw) as JSONObject;
      return renderModelEnvEnabled(gc);
    } catch {
      return true;
    }
  }

  // ── template ─────────────────────────────────────────────────────────────

  async getTemplate(): Promise<{ content: string; path: string; exists: boolean }> {
    const p = this.templatePath();
    try {
      const data = await fs.readFile(p, 'utf-8');
      return { content: data, path: p, exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: '', path: p, exists: false };
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
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    let settingsContent = content;
    if (!this.isRenderModelEnvEnabled()) {
      settingsContent = stripModelEnvKeys(content);
    }
    await fs.writeFile(settingsPath, settingsContent);
    await this.syncHooks();
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

  // ── hooks ────────────────────────────────────────────────────────────────

  async syncHooks(): Promise<void> {
    const hooksDir = this.hooksDirPath();
    await fs.mkdir(hooksDir, { recursive: true });
    const sourceDir = this.deps.paths.confPath('claude', 'hooks');
    for (const name of CLAUDE_HOOK_FILES) {
      const src = path.join(sourceDir, name);
      const dst = path.join(hooksDir, name);
      try {
        await fs.unlink(dst);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      await fs.symlink(src, dst);
    }
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

function renderModelEnvEnabled(m: JSONObject): boolean {
  const v = m.renderModelEnv;
  if (typeof v !== 'boolean') return true;
  return v;
}

function isValidJSON(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

export function stripModelEnvKeys(content: string): string {
  let m: JSONObject;
  try { m = JSON.parse(content) as JSONObject; } catch { return content; }
  const env = m.env as JSONObject | undefined;
  if (!env) return content;
  for (const key of MODEL_ENV_KEYS) delete env[key];
  m.env = env;
  return JSON.stringify(m, null, 2);
}

export { ANTHROPIC_KEYS };
