import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type { ClashConfig, ClashUpstreamInfo } from './schema.js';

export const CLASH_UPSTREAM_CACHE_TTL_MS = 5 * 60 * 1000;
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
        return { subscribe_url: '', groups: [], rule_sets: [] };
      }
      throw new AppError('CLASH_CONFIG_READ', `failed to read clash config: ${(err as Error).message}`, 500);
    }
  }

  async saveConfig(cfg: ClashConfig): Promise<void> {
    await fsp.mkdir(path.dirname(this.configPath()), { recursive: true });
    await fsp.writeFile(this.configPath(), JSON.stringify(cfg, null, 2));
  }

  async getUpstreamCached(subscribeURL: string, forceRefresh: boolean): Promise<{ raw: string; info: ClashUpstreamInfo }> {
    const release = await this.cacheMu.acquire();
    try {
      if (
        !forceRefresh &&
        this.cache &&
        Date.now() - this.cache.fetchedAt < CLASH_UPSTREAM_CACHE_TTL_MS
      ) {
        return { raw: this.cache.raw, info: this.cache.info };
      }
      const raw = await fetchUpstreamRaw(subscribeURL);
      const info = parseUpstreamInfo(raw);
      this.cache = { fetchedAt: Date.now(), raw, info };
      return { raw, info };
    } finally {
      release();
    }
  }

  async buildSubscribe(cfg: ClashConfig): Promise<string> {
    if (!cfg.subscribe_url) {
      throw new AppError('CLASH_NO_URL', 'subscribe URL not configured', 400);
    }
    const { raw } = await this.getUpstreamCached(cfg.subscribe_url, false);
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

export function mergeClashConfig(upstreamRaw: string, cfg: ClashConfig): string {
  const doc = (YAML.parse(upstreamRaw) ?? {}) as Record<string, unknown>;

  if (cfg.groups.length > 0) {
    const existing = Array.isArray(doc['proxy-groups']) ? (doc['proxy-groups'] as unknown[]) : [];
    const additions = cfg.groups.map((g) => ({
      name: g.name,
      type: g.type,
      proxies: [...g.proxies],
    }));
    doc['proxy-groups'] = [...existing, ...additions];
  }

  if (cfg.rule_sets.length > 0) {
    const existing = Array.isArray(doc.rules) ? (doc.rules as unknown[]) : [];
    const customRules: string[] = [];
    for (const rs of cfg.rule_sets) {
      for (const rule of rs.rules) customRules.push(`${rule},${rs.group}`);
    }
    doc.rules = [...customRules, ...existing];
  }

  return YAML.stringify(doc);
}
