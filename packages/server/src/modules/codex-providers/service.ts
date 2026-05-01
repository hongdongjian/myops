import fs from 'node:fs/promises';
import path from 'node:path';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import { CodexSettingsService } from '../codex-settings/service.js';
import type { CodexAccountView } from '../codex-accounts/schema.js';
import type { CodexProvider, ProvidersStore, ProviderAddRequest, ProviderUpdateRequest } from './schema.js';

export interface ProvidersListResult extends ProvidersStore {
  authMode: boolean;
  accounts: CodexAccountView[];
}

export class CodexProvidersService {
  private readonly settings: CodexSettingsService;

  constructor(private readonly deps: Deps) {
    this.settings = new CodexSettingsService(deps);
  }

  storePath(): string {
    return this.deps.paths.dataPath('codex-providers.json');
  }

  async readStore(): Promise<ProvidersStore> {
    try {
      const raw = await fs.readFile(this.storePath(), 'utf-8');
      const obj = JSON.parse(raw) as Partial<ProvidersStore>;
      return { activeProvider: obj.activeProvider ?? '', providers: obj.providers ?? [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { activeProvider: '', providers: [] };
      }
      throw err;
    }
  }

  async writeStore(store: ProvidersStore): Promise<void> {
    const p = this.storePath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(store, null, 2));
  }

  async list(): Promise<ProvidersListResult> {
    const store = await this.readStore();
    const { authMode } = await this.settings.getSettings();
    const accounts = this.deps.codexAccounts
      ? await this.deps.codexAccounts.getAccountViews().catch(() => [] as CodexAccountView[])
      : [];
    return { ...store, authMode, accounts };
  }

  async add(req: ProviderAddRequest): Promise<void> {
    const name = req.name.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    if (store.providers.some((p) => p.name === name)) {
      throw new AppError('CONFLICT', 'provider name already exists', 409);
    }
    const updated: ProvidersStore = {
      ...store,
      providers: [
        ...store.providers,
        { name, baseUrl: req.baseUrl.trim(), apiKey: req.apiKey.trim(), model: req.model.trim() },
      ],
    };
    await this.writeStore(updated);
  }

  async update(req: ProviderUpdateRequest): Promise<void> {
    const name = req.name.trim();
    if (name === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const newName = req.newName.trim() || name;
    let found = false;
    const providers = store.providers.map((p): CodexProvider => {
      if (p.name !== name) return p;
      found = true;
      return { name: newName, baseUrl: req.baseUrl.trim(), apiKey: req.apiKey.trim(), model: req.model.trim() };
    });
    if (!found) throw new AppError('NOT_FOUND', 'provider not found', 404);
    const updated: ProvidersStore = {
      providers,
      activeProvider: newName !== name && store.activeProvider === name ? newName : store.activeProvider,
    };
    await this.writeStore(updated);
  }

  async remove(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const filtered = store.providers.filter((p) => p.name !== trimmed);
    if (filtered.length === store.providers.length) {
      throw new AppError('NOT_FOUND', 'provider not found', 404);
    }
    await this.writeStore({
      providers: filtered,
      activeProvider: store.activeProvider === trimmed ? '' : store.activeProvider,
    });
  }

  async apply(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') throw new AppError('INVALID_INPUT', 'name is required', 400);
    const store = await this.readStore();
    const found = store.providers.find((p) => p.name === trimmed);
    if (!found) throw new AppError('NOT_FOUND', 'provider not found', 404);
    await this.settings.applyCustomProvider({ baseUrl: found.baseUrl, apiKey: found.apiKey, model: found.model });
    await this.writeStore({ ...store, activeProvider: trimmed });
  }
}
