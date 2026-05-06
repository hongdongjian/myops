import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type { ClashConfig, ClashProxy, ClashUpstreamInfo } from './schema.js';

export const CLASH_FETCH_TIMEOUT_MS = 30 * 1000;

interface UpstreamCacheEntry {
  fetchedAt: number;
  raw: string;
  info: ClashUpstreamInfo;
}

export class ClashService {
  private cache: UpstreamCacheEntry | null = null;
  private readonly cacheMu = new Mutex();

  constructor(private readonly deps: Deps) {}

  configPath(): string {
    return path.join(this.deps.paths.rootDir, 'conf', 'clash', 'config.json');
  }

  async loadConfig(): Promise<ClashConfig> {
    try {
      const data = await fsp.readFile(this.configPath(), 'utf-8');
      return JSON.parse(data) as ClashConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { subscribe_url: '', refresh_interval_minutes: 60, custom_proxies: [], groups: [], rule_sets: [] };
      }
      throw new AppError('CLASH_CONFIG_READ', `failed to read clash config: ${(err as Error).message}`, 500);
    }
  }

  async saveConfig(cfg: ClashConfig): Promise<void> {
    await fsp.mkdir(path.dirname(this.configPath()), { recursive: true });
    await fsp.writeFile(this.configPath(), JSON.stringify(cfg, null, 2));
  }

  async getUpstreamCached(cfg: ClashConfig, forceRefresh: boolean): Promise<{ raw: string; info: ClashUpstreamInfo }> {
    const ttlMs = (cfg.refresh_interval_minutes ?? 60) * 60 * 1000;
    const release = await this.cacheMu.acquire();
    try {
      if (
        !forceRefresh &&
        this.cache &&
        Date.now() - this.cache.fetchedAt < ttlMs
      ) {
        return { raw: this.cache.raw, info: { ...this.cache.info, fetchedAt: this.cache.fetchedAt } };
      }
      const raw = await fetchUpstreamRaw(cfg.subscribe_url);
      const info = parseUpstreamInfo(raw);
      const fetchedAt = Date.now();
      this.cache = { fetchedAt, raw, info };
      return { raw, info: { ...info, fetchedAt } };
    } finally {
      release();
    }
  }

  async rotateApiKey(): Promise<string> {
    const cfg = await this.loadConfig();
    const newKey = crypto.randomBytes(24).toString('hex');
    await this.saveConfig({ ...cfg, api_key: newKey });
    return newKey;
  }

  async buildSubscribe(cfg: ClashConfig): Promise<string> {
    if (!cfg.subscribe_url) {
      throw new AppError('CLASH_NO_URL', 'subscribe URL not configured', 400);
    }
    const { raw } = await this.getUpstreamCached(cfg, false);
    return mergeClashConfig(raw, cfg);
  }
}

async function fetchUpstreamRaw(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLASH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new AppError('CLASH_UPSTREAM', `upstream returned status ${res.status}`, 502);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('CLASH_UPSTREAM', `failed to fetch upstream: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export function parseUpstreamInfo(raw: string): ClashUpstreamInfo {
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch (err) {
    throw new AppError('CLASH_PARSE', `failed to parse upstream YAML: ${(err as Error).message}`, 500);
  }
  const proxies: string[] = [];
  const groups: string[] = [];
  if (doc && typeof doc === 'object') {
    const d = doc as Record<string, unknown>;
    const proxyList = d.proxies;
    if (Array.isArray(proxyList)) {
      for (const p of proxyList) {
        if (p && typeof p === 'object' && typeof (p as any).name === 'string') {
          proxies.push((p as any).name);
        }
      }
    }
    const groupList = d['proxy-groups'];
    if (Array.isArray(groupList)) {
      for (const g of groupList) {
        if (g && typeof g === 'object' && typeof (g as any).name === 'string') {
          groups.push((g as any).name);
        }
      }
    }
  }
  return { proxies, groups };
}

function serializeProxy(p: ClashProxy): Record<string, unknown> {
  return p as Record<string, unknown>;
}

export function mergeClashConfig(upstreamRaw: string, cfg: ClashConfig): string {
  const doc = (YAML.parse(upstreamRaw) ?? {}) as Record<string, unknown>;
  const upstreamProxyNames: string[] = [];
  if (Array.isArray(doc.proxies)) {
    for (const p of doc.proxies as unknown[]) {
      if (p && typeof p === 'object' && typeof (p as any).name === 'string') {
        upstreamProxyNames.push((p as any).name);
      }
    }
  }

  const customProxies = cfg.custom_proxies ?? [];
  if (customProxies.length > 0) {
    const serialized = customProxies.map(serializeProxy);
    const existingProxies = Array.isArray(doc.proxies) ? (doc.proxies as unknown[]) : [];
    doc.proxies = [...serialized, ...existingProxies];
    for (const p of customProxies) upstreamProxyNames.push(p.name);
  }

  if (cfg.groups.length > 0) {
    const existing = Array.isArray(doc['proxy-groups']) ? (doc['proxy-groups'] as unknown[]) : [];
    const additions = cfg.groups.map((g) => {
      const proxies =
        g.keywords && g.keywords.length > 0
          ? upstreamProxyNames.filter((name) =>
              g.keywords.some((kw) => name.toLowerCase().includes(kw.toLowerCase())),
            )
          : [...g.proxies];
      const entry: Record<string, unknown> = { name: g.name, type: g.type, proxies };
      if (g.url) entry.url = g.url;
      if (g.interval !== undefined) entry.interval = g.interval;
      if (g.timeout !== undefined) entry.timeout = g.timeout;
      if (g.tolerance !== undefined) entry.tolerance = g.tolerance;
      if (g.lazy !== undefined) entry.lazy = g.lazy;
      if (g.max_failed_times !== undefined) entry['max-failed-times'] = g.max_failed_times;
      if (g.strategy) entry.strategy = g.strategy;
      return entry;
    });
    const injected = existing.map((eg) => {
      if (eg && typeof eg === 'object' && (eg as any).type === 'select' && Array.isArray((eg as any).proxies)) {
        const upstreamName: string = (eg as any).name ?? '';
        const groupsToInject = cfg.groups
          .filter((g) => g.inject_into?.length && g.inject_into.includes(upstreamName))
          .map((g) => g.name);
        return { ...(eg as object), proxies: [...groupsToInject, ...(eg as any).proxies] };
      }
      return eg;
    });
    const additionsWithInjections = additions.map((ga) => {
      if ((ga as any).type !== 'select') return ga;
      const gaName = (ga as any).name as string;
      const toInject = cfg.groups
        .filter((g) => g.inject_into?.includes(gaName) && g.name !== gaName)
        .map((g) => g.name);
      if (toInject.length === 0) return ga;
      return { ...(ga as object), proxies: [...toInject, ...((ga as any).proxies ?? [])] };
    });
    doc['proxy-groups'] = [...injected, ...additionsWithInjections];
  }

  if (cfg.rule_sets.length > 0) {
    const existing = Array.isArray(doc.rules) ? (doc.rules as unknown[]) : [];
    const customRules: string[] = [];
    for (const rs of cfg.rule_sets) {
      if (rs.enabled === false) continue;
      for (const rule of rs.rules) {
        if (rule.trim().startsWith('#')) continue;
        customRules.push(`${rule},${rs.group}`);
      }
    }
    doc.rules = [...customRules, ...existing];
  }

  return YAML.stringify(doc);
}
