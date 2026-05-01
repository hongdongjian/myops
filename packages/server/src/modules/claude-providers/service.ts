import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { ClaudeSettingsService } from '../claude-settings/service.js';
import type {
  ClaudeProvider,
  ProvidersStore,
  ProviderAddRequest,
  ProviderUpdateRequest,
} from './schema.js';

type JSONObject = Record<string, unknown>;

export class ClaudeProvidersService {
  private readonly settings: ClaudeSettingsService;

  constructor(private readonly deps: Deps) {
    this.settings = new ClaudeSettingsService(deps);
  }

  storePath(): string {
    return this.deps.paths.dataPath('claude-providers.json');
  }

  async readStore(): Promise<ProvidersStore> {
    let raw: string;
    try {
      raw = await fs.readFile(this.storePath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { activeProvider: '', providers: [] };
      }
      throw err;
    }
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(raw) as ClaudeProvider[];
      return { activeProvider: '', providers: arr };
    }
    const obj = JSON.parse(raw) as Partial<ProvidersStore>;
    return {
      activeProvider: obj.activeProvider ?? '',
      providers: obj.providers ?? [],
    };
  }

  async writeStore(store: ProvidersStore): Promise<void> {
    const p = this.storePath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(store, null, 2));
  }

  async list(): Promise<ProvidersStore> {
    return this.readStore();
  }

  async add(req: ProviderAddRequest): Promise<void> {
    const name = req.name.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    if (store.providers.some((p) => p.name === name)) {
      throw new AppError('CONFLICT', 'provider name already exists', 409);
    }
    const baseUrl = req.baseUrl.trim() || 'http://localhost:4141';
    const token = req.token.trim() || 'dummy';
    store.providers = [
      ...store.providers,
      {
        name,
        baseUrl,
        token,
        model: req.model.trim(),
        haikuModel: req.haikuModel.trim(),
        sonnetModel: (req.sonnetModel ?? '').trim(),
        opusModel: (req.opusModel ?? '').trim(),
      },
    ];
    await this.writeStore(store);
  }

  async update(req: ProviderUpdateRequest): Promise<void> {
    const name = req.name.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const newName = req.newName.trim() || name;
    let found = false;
    const updated = store.providers.map((p) => {
      if (p.name !== name) return p;
      found = true;
      return {
        name: newName,
        baseUrl: req.baseUrl.trim(),
        token: req.token.trim(),
        model: req.model.trim(),
        haikuModel: req.haikuModel.trim(),
        sonnetModel: (req.sonnetModel ?? '').trim(),
        opusModel: (req.opusModel ?? '').trim(),
      };
    });
    if (!found) throw new AppError('NOT_FOUND', 'provider not found', 404);
    const next: ProvidersStore = {
      providers: updated,
      activeProvider:
        newName !== name && store.activeProvider === name ? newName : store.activeProvider,
    };
    await this.writeStore(next);
  }

  async remove(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const filtered = store.providers.filter((p) => p.name !== trimmed);
    if (filtered.length === store.providers.length) {
      throw new AppError('NOT_FOUND', 'provider not found', 404);
    }
    const next: ProvidersStore = {
      providers: filtered,
      activeProvider: store.activeProvider === trimmed ? '' : store.activeProvider,
    };
    await this.writeStore(next);
  }

  async apply(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const found = store.providers.find((p) => p.name === trimmed);
    if (!found) throw new AppError('NOT_FOUND', 'provider not found', 404);

    const settingsPath = this.settings.settingsPath();
    let m: JSONObject = {};
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8');
      m = JSON.parse(raw) as JSONObject;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const env = (m.env as JSONObject) ?? {};
    if (found.baseUrl) env.ANTHROPIC_BASE_URL = found.baseUrl;
    else delete env.ANTHROPIC_BASE_URL;
    if (found.token) env.ANTHROPIC_AUTH_TOKEN = found.token;
    else delete env.ANTHROPIC_AUTH_TOKEN;

    const sonnet = found.sonnetModel || found.model;
    const opus = found.opusModel || found.model;
    const haiku = found.haikuModel;

    if (sonnet) {
      env.ANTHROPIC_MODEL = sonnet;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    } else {
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    }
    if (opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    else delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    if (haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
    else delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    m.env = env;

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(m, null, 2));

    await this.writeStore({ ...store, activeProvider: trimmed });
  }
}
