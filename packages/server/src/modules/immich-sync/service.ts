import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import {
  DEFAULT_IMMICH_BASE_URL,
  IMMICH_BATCH_SIZE,
  IMMICH_SEARCH_PAGE_SIZE,
  IMMICH_TICK_INTERVAL_MS,
  type ImmichAccount,
  type ImmichAlbum,
  type ImmichConfig,
  type ImmichCurrentUser,
  type ImmichPerson,
  type ImmichSyncPlan,
  type ImmichSyncProgress,
  type ImmichSyncStats,
} from './schema.js';

interface PersistConfig {
  activeAccountId: string;
}

const DEFAULT_PERSIST: PersistConfig = { activeAccountId: '' };

export class ImmichSyncService {
  private readonly dataDir: string;
  private accounts: ImmichAccount[] = [];
  private activeAccountId = '';
  private plans: ImmichSyncPlan[] = [];
  private readonly progressMap = new Map<string, ImmichSyncProgress>();
  private readonly running = new Set<string>();
  private readonly mu = new Mutex();
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(private readonly deps: Deps) {
    this.dataDir = deps.paths.dataPath('immich');
  }

  async start(): Promise<void> {
    if (this.loaded) return;
    await fsp.mkdir(this.dataDir, { recursive: true });
    const cfg = await this.readJson<PersistConfig>('config.json', DEFAULT_PERSIST);
    this.activeAccountId = cfg.activeAccountId ?? '';
    this.accounts = await this.readJson<ImmichAccount[]>('accounts.json', []);
    const plans = await this.readJson<ImmichSyncPlan[]>('plans.json', []);
    // Reset stale "running" status from previous crashes (immutable)
    this.plans = plans.map((p) => (p.status === 'running' ? { ...p, status: 'idle' } : p));
    this.loaded = true;
  }

  startTicker(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkScheduledPlans();
    }, IMMICH_TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── account management ──────────────────────────────────────────────────

  listAccounts(): ImmichAccount[] {
    return this.accounts.map((a) => ({ ...a }));
  }

  getActiveAccountId(): string {
    return this.activeAccountId;
  }

  getConfig(): ImmichConfig {
    return this.getConfigForAccount('');
  }

  getConfigForAccount(id: string): ImmichConfig {
    const target = id || this.activeAccountId;
    const acc = this.accounts.find((a) => a.id === target);
    if (!acc) return { baseUrl: '', apiKey: '' };
    return { baseUrl: acc.baseUrl || DEFAULT_IMMICH_BASE_URL, apiKey: acc.apiKey };
  }

  async addAccount(input: Omit<ImmichAccount, 'id'>): Promise<ImmichAccount> {
    const account: ImmichAccount = {
      ...input,
      id: randomUUID(),
      baseUrl: input.baseUrl || DEFAULT_IMMICH_BASE_URL,
    };
    this.accounts = [...this.accounts, account];
    if (!this.activeAccountId) {
      this.activeAccountId = account.id;
    }
    await this.saveAccounts();
    await this.saveConfig();
    return { ...account };
  }

  async deleteAccount(id: string): Promise<void> {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    if (this.activeAccountId === id) {
      this.activeAccountId = this.accounts[0]?.id ?? '';
    }
    await this.saveAccounts();
    await this.saveConfig();
  }

  async setActiveAccount(id: string): Promise<void> {
    if (!this.accounts.find((a) => a.id === id)) {
      throw new AppError('NOT_FOUND', `account ${id} not found`, 404);
    }
    this.activeAccountId = id;
    await this.saveConfig();
  }

  // ── plan CRUD ───────────────────────────────────────────────────────────

  listPlans(): ImmichSyncPlan[] {
    return this.plans.map((p) => ({ ...p }));
  }

  async createPlan(input: Omit<ImmichSyncPlan, 'id' | 'status'>): Promise<ImmichSyncPlan> {
    const plan: ImmichSyncPlan = {
      ...input,
      id: randomUUID(),
      status: 'idle',
      accountId: input.accountId || this.activeAccountId,
    };
    this.plans = [...this.plans, plan];
    await this.savePlans();
    return { ...plan };
  }

  async deletePlan(id: string): Promise<void> {
    this.plans = this.plans.filter((p) => p.id !== id);
    await this.savePlans();
  }

  async updatePlan(
    id: string,
    updates: Omit<ImmichSyncPlan, 'id' | 'status' | 'lastRunAt' | 'lastRunDate' | 'lastRunStats' | 'errorMsg'>,
  ): Promise<void> {
    const idx = this.plans.findIndex((p) => p.id === id);
    if (idx < 0) throw new AppError('NOT_FOUND', `plan not found: ${id}`, 404);
    const prior = this.plans[idx]!;
    const next: ImmichSyncPlan = {
      ...prior,
      name: updates.name,
      personIds: updates.personIds,
      personNames: updates.personNames,
      albumId: updates.albumId,
      albumName: updates.albumName,
      removeDeleted: updates.removeDeleted,
      enabled: updates.enabled,
      scheduleInterval: updates.scheduleInterval,
    };
    this.plans = this.plans.map((p, i) => (i === idx ? next : p));
    await this.savePlans();
  }

  async setPlanEnabled(id: string, enabled: boolean): Promise<void> {
    const idx = this.plans.findIndex((p) => p.id === id);
    if (idx < 0) throw new AppError('NOT_FOUND', `plan not found: ${id}`, 404);
    const next: ImmichSyncPlan = { ...this.plans[idx]!, enabled };
    this.plans = this.plans.map((p, i) => (i === idx ? next : p));
    await this.savePlans();
  }

  // ── progress ────────────────────────────────────────────────────────────

  getProgress(id: string): ImmichSyncProgress | null {
    const p = this.progressMap.get(id);
    return p ? { ...p } : null;
  }

  allProgress(): Record<string, ImmichSyncProgress> {
    const out: Record<string, ImmichSyncProgress> = {};
    for (const [k, v] of this.progressMap) out[k] = { ...v };
    return out;
  }

  // ── trigger ─────────────────────────────────────────────────────────────

  triggerRun(id: string): void {
    if (this.running.has(id)) {
      throw new AppError('PLAN_BUSY', `plan ${id} is already running`, 409);
    }
    this.running.add(id);
    void this.runSync(id).finally(() => this.running.delete(id));
  }

  // ── ticker ──────────────────────────────────────────────────────────────

  private async checkScheduledPlans(): Promise<void> {
    const now = Date.now();
    const snapshot = this.plans.map((p) => ({ ...p }));
    for (const p of snapshot) {
      if (!p.enabled || p.scheduleInterval <= 0) continue;
      if (this.running.has(p.id)) continue;
      if (p.lastRunAt) {
        const last = Date.parse(p.lastRunAt);
        if (Number.isFinite(last) && now - last < p.scheduleInterval * 1000) continue;
      }
      try {
        this.triggerRun(p.id);
      } catch {
        // already running
      }
    }
  }

  // ── sync execution ──────────────────────────────────────────────────────

  private async runSync(planId: string): Promise<void> {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return;

    await this.mutatePlan(planId, (p) => ({ ...p, status: 'running', errorMsg: '' }));

    const prog: ImmichSyncProgress = {
      planId,
      running: true,
      phase: 'fetching_person',
      total: 0,
      done: 0,
      added: 0,
      removed: 0,
      startedAt: new Date().toISOString(),
    };
    this.progressMap.set(planId, prog);

    const cfg = this.getConfigForAccount(plan.accountId ?? '');

    let personAssets: string[];
    try {
      personAssets = await this.fetchPersonAssets(cfg, plan.personIds, planId);
    } catch (err) {
      await this.finishSync(planId, null, `获取人物照片失败: ${(err as Error).message}`);
      return;
    }

    this.updateProgress(planId, (p) => ({ ...p, phase: 'fetching_album', total: personAssets.length }));

    let albumAssets: string[];
    try {
      albumAssets = await this.fetchAlbumAssets(cfg, plan.albumId);
    } catch (err) {
      await this.finishSync(planId, null, `获取相册照片失败: ${(err as Error).message}`);
      return;
    }

    const personSet = new Set(personAssets);
    const albumSet = new Set(albumAssets);
    const toAdd = personAssets.filter((id) => !albumSet.has(id));
    const toRemove = plan.removeDeleted ? albumAssets.filter((id) => !personSet.has(id)) : [];

    this.updateProgress(planId, (p) => ({ ...p, phase: 'syncing', total: toAdd.length + toRemove.length }));

    let added = 0;
    for (let i = 0; i < toAdd.length; i += IMMICH_BATCH_SIZE) {
      const batch = toAdd.slice(i, i + IMMICH_BATCH_SIZE);
      try {
        await this.addAssetsToAlbum(cfg, plan.albumId, batch);
      } catch (err) {
        await this.finishSync(planId, null, `添加照片到相册失败: ${(err as Error).message}`);
        return;
      }
      added += batch.length;
      const cur = added;
      this.updateProgress(planId, (p) => ({ ...p, added: cur, done: cur }));
    }

    let removed = 0;
    for (let i = 0; i < toRemove.length; i += IMMICH_BATCH_SIZE) {
      const batch = toRemove.slice(i, i + IMMICH_BATCH_SIZE);
      try {
        await this.removeAssetsFromAlbum(cfg, plan.albumId, batch);
      } catch (err) {
        await this.finishSync(planId, null, `从相册移除照片失败: ${(err as Error).message}`);
        return;
      }
      removed += batch.length;
      const cur = removed;
      this.updateProgress(planId, (p) => ({ ...p, removed: cur, done: added + cur }));
    }

    const stats: ImmichSyncStats = { added, removed, total: personAssets.length };
    await this.finishSync(planId, stats, '');
  }

  private updateProgress(planId: string, fn: (p: ImmichSyncProgress) => ImmichSyncProgress): void {
    const cur = this.progressMap.get(planId);
    if (!cur) return;
    this.progressMap.set(planId, fn(cur));
  }

  private async finishSync(planId: string, stats: ImmichSyncStats | null, errMsg: string): Promise<void> {
    const now = new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    await this.mutatePlan(planId, (p) => {
      if (errMsg) {
        return { ...p, status: 'failed', errorMsg: errMsg, lastRunAt: iso };
      }
      return {
        ...p,
        status: 'success',
        errorMsg: '',
        lastRunStats: stats ?? undefined,
        lastRunDate: date,
        lastRunAt: iso,
      };
    });

    const cur = this.progressMap.get(planId);
    if (cur) {
      this.progressMap.set(planId, {
        ...cur,
        running: false,
        phase: 'done',
        added: stats?.added ?? cur.added,
        removed: stats?.removed ?? cur.removed,
        total: stats?.total ?? cur.total,
      });
    }
  }

  private async mutatePlan(id: string, fn: (p: ImmichSyncPlan) => ImmichSyncPlan): Promise<void> {
    const release = await this.mu.acquire();
    try {
      const idx = this.plans.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const next = fn(this.plans[idx]!);
      this.plans = this.plans.map((p, i) => (i === idx ? next : p));
    } finally {
      release();
    }
    await this.savePlans();
  }

  // ── Immich API calls ────────────────────────────────────────────────────

  async getCurrentUser(cfg: ImmichConfig): Promise<ImmichCurrentUser> {
    const data = await immichRequest(cfg, 'GET', '/api/users/me');
    return data as ImmichCurrentUser;
  }

  async listPeople(cfg: ImmichConfig): Promise<ImmichPerson[]> {
    const all: ImmichPerson[] = [];
    let page = 1;
    const pageSize = 500;
    for (;;) {
      const data = (await immichRequest(
        cfg,
        'GET',
        `/api/people?withHidden=true&size=${pageSize}&page=${page}`,
      )) as { people?: ImmichPerson[]; hasNextPage?: boolean } | ImmichPerson[];
      if (Array.isArray(data)) {
        return all.concat(data);
      }
      const people = data.people ?? [];
      all.push(...people);
      if (!data.hasNextPage || people.length === 0) break;
      page += 1;
    }
    return all;
  }

  async listAlbums(cfg: ImmichConfig): Promise<ImmichAlbum[]> {
    const owned = (await immichRequest(cfg, 'GET', '/api/albums')) as ImmichAlbum[];
    const out: ImmichAlbum[] = Array.isArray(owned) ? [...owned] : [];
    try {
      const shared = (await immichRequest(cfg, 'GET', '/api/albums?shared=true')) as ImmichAlbum[];
      if (Array.isArray(shared)) {
        const seen = new Set(out.map((a) => a.id));
        for (const a of shared) {
          if (!seen.has(a.id)) {
            out.push(a);
            seen.add(a.id);
          }
        }
      }
    } catch {
      // shared albums optional
    }
    return out;
  }

  async createAlbum(cfg: ImmichConfig, name: string): Promise<ImmichAlbum> {
    const data = await immichRequest(cfg, 'POST', '/api/albums', { albumName: name });
    return data as ImmichAlbum;
  }

  private async fetchPersonAssets(
    cfg: ImmichConfig,
    personIds: string[],
    planId: string,
  ): Promise<string[]> {
    const all: string[] = [];
    let page = 1;
    for (;;) {
      const data = (await immichRequest(cfg, 'POST', '/api/search/metadata', {
        personIds,
        page,
        size: IMMICH_SEARCH_PAGE_SIZE,
        withDeleted: false,
        withArchived: true,
      })) as { assets?: { total?: number; items?: Array<{ id: string }> } };
      const total = data.assets?.total ?? 0;
      const items = data.assets?.items ?? [];
      for (const it of items) all.push(it.id);
      this.updateProgress(planId, (p) => ({ ...p, done: all.length, total }));
      if (all.length >= total || items.length === 0) break;
      page += 1;
    }
    return all;
  }

  private async fetchAlbumAssets(cfg: ImmichConfig, albumId: string): Promise<string[]> {
    const data = (await immichRequest(cfg, 'GET', `/api/albums/${albumId}`)) as {
      assets?: Array<{ id: string }>;
    };
    return (data.assets ?? []).map((a) => a.id);
  }

  private async addAssetsToAlbum(cfg: ImmichConfig, albumId: string, ids: string[]): Promise<void> {
    await immichRequest(cfg, 'PUT', `/api/albums/${albumId}/assets`, { ids });
  }

  private async removeAssetsFromAlbum(cfg: ImmichConfig, albumId: string, ids: string[]): Promise<void> {
    await immichRequest(cfg, 'DELETE', `/api/albums/${albumId}/assets`, { ids });
  }

  // ── persistence ─────────────────────────────────────────────────────────

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try {
      const raw = await fsp.readFile(path.join(this.dataDir, name), 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw err;
    }
  }

  private async writeJson(name: string, data: unknown): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.writeFile(path.join(this.dataDir, name), JSON.stringify(data, null, 2));
  }

  private saveConfig(): Promise<void> {
    return this.writeJson('config.json', { activeAccountId: this.activeAccountId });
  }

  private saveAccounts(): Promise<void> {
    return this.writeJson('accounts.json', this.accounts);
  }

  private savePlans(): Promise<void> {
    return this.writeJson('plans.json', this.plans);
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function immichRequest(
  cfg: ImmichConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new AppError('IMMICH_NOT_CONFIGURED', 'Immich 账号未配置', 400);
  }
  const headers: Record<string, string> = {
    'x-api-key': cfg.apiKey,
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(cfg.baseUrl + path, {
      method,
      headers,
      body: payload,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}
