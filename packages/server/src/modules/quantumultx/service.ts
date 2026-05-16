import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Mutex } from 'async-mutex';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import {
  QX_GROUPS,
  emptyManifest,
  type QxConfig,
  type QxGroup,
  type QxManifest,
  type QxResource,
} from './schema.js';
import { parseQxConf, urlToFilename, type ParsedResources } from './parser.js';

export const QX_FETCH_TIMEOUT_MS = 30 * 1000;
export const QX_CONCURRENCY = 4;

function envProxy(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    undefined
  );
}

let cachedProxy: { url: string; agent: ProxyAgent } | null = null;
function getProxyAgent(): ProxyAgent | undefined {
  const url = envProxy();
  if (!url) return undefined;
  if (url.startsWith('socks')) return undefined;
  if (cachedProxy?.url !== url) {
    cachedProxy = { url, agent: new ProxyAgent(url) };
  }
  return cachedProxy.agent;
}

async function fetchWithProxy(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  const dispatcher = getProxyAgent();
  if (dispatcher) {
    return undiciFetch(url, { signal, dispatcher }) as unknown as Promise<{
      ok: boolean;
      status: number;
      arrayBuffer(): Promise<ArrayBuffer>;
    }>;
  }
  return fetch(url, { signal }) as unknown as Promise<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

export class QuantumultXService {
  private readonly mu = new Mutex();

  constructor(private readonly deps: Deps) {}

  rootDir(): string {
    return this.deps.paths.confPath('quantumultx');
  }
  dataDir(): string {
    return this.deps.paths.dataPath('quantumultx');
  }
  configPath(): string {
    return path.join(this.dataDir(), 'config.json');
  }
  private legacyConfigPath(): string {
    return path.join(this.rootDir(), 'config.json');
  }
  confPath(): string {
    return path.join(this.rootDir(), 'QuantumultX.conf');
  }
  manifestPath(): string {
    return path.join(this.dataDir(), 'manifest.json');
  }
  groupDir(group: QxGroup): string {
    return path.join(this.dataDir(), group);
  }

  async loadConfig(): Promise<QxConfig> {
    let data: string;
    try {
      data = await fsp.readFile(this.configPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AppError('QX_CONFIG_READ', `failed to read qx config: ${(err as Error).message}`, 500);
      }
      // Try legacy location (conf/quantumultx/config.json) — migrate forward on next save.
      try {
        data = await fsp.readFile(this.legacyConfigPath(), 'utf-8');
      } catch (legacyErr) {
        if ((legacyErr as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw new AppError(
          'QX_CONFIG_READ',
          `failed to read legacy qx config: ${(legacyErr as Error).message}`,
          500,
        );
      }
    }
    if (!data.trim()) return {};
    try {
      return JSON.parse(data) as QxConfig;
    } catch {
      return {};
    }
  }

  async saveConfig(cfg: QxConfig): Promise<void> {
    await fsp.mkdir(this.dataDir(), { recursive: true });
    const target = this.configPath();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
    await fsp.rename(tmp, target);
    // Best-effort cleanup of legacy file once migrated.
    await fsp.unlink(this.legacyConfigPath()).catch(() => undefined);
  }

  async loadConf(): Promise<string> {
    try {
      return await fsp.readFile(this.confPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new AppError('QX_CONF_READ', `failed to read .conf: ${(err as Error).message}`, 500);
    }
  }

  async saveConf(text: string): Promise<void> {
    await fsp.mkdir(this.rootDir(), { recursive: true });
    await fsp.writeFile(this.confPath(), text);
  }

  async loadManifest(): Promise<QxManifest> {
    let data: string;
    try {
      data = await fsp.readFile(this.manifestPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest();
      throw new AppError('QX_MANIFEST_READ', `failed to read manifest: ${(err as Error).message}`, 500);
    }
    if (!data.trim()) return emptyManifest();
    let parsed: Partial<QxManifest>;
    try {
      parsed = JSON.parse(data) as Partial<QxManifest>;
    } catch {
      // Corrupted manifest (e.g., torn write) — recover by starting empty
      return emptyManifest();
    }
    const m = emptyManifest();
    for (const g of QX_GROUPS) {
      if (Array.isArray(parsed[g])) m[g] = parsed[g] as QxResource[];
    }
    return m;
  }

  async saveManifest(m: QxManifest): Promise<void> {
    await fsp.mkdir(this.dataDir(), { recursive: true });
    const target = this.manifestPath();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(m, null, 2));
    await fsp.rename(tmp, target);
  }

  async rotateApiKey(): Promise<string> {
    const cfg = await this.loadConfig();
    const newKey = crypto.randomBytes(24).toString('hex');
    await this.saveConfig({ ...cfg, api_key: newKey });
    return newKey;
  }

  /**
   * Merge parsed remote URLs from .conf into manifest, preserving manual entries.
   * Removes remote entries that are no longer in .conf.
   */
  async syncManifestFromConf(): Promise<QxManifest> {
    const text = await this.loadConf();
    const parsed = parseQxConf(text);
    const release = await this.mu.acquire();
    try {
      const current = await this.loadManifest();
      const next: QxManifest = emptyManifest();

      for (const group of QX_GROUPS) {
        const remoteUrls = (parsed[group] as string[]) ?? [];
        const remoteSet = new Set(remoteUrls);

        // Keep manual entries
        const manual = current[group].filter((r) => r.source === 'manual');
        const manualUrlSet = new Set(manual.map((r) => r.url));

        // Existing remote entries we should preserve (still in .conf)
        const existingRemoteByUrl = new Map(
          current[group].filter((r) => r.source === 'remote').map((r) => [r.url, r]),
        );

        const remoteEntries: QxResource[] = remoteUrls
          .filter((u) => !manualUrlSet.has(u))
          .map((url) => {
            const existing = existingRemoteByUrl.get(url);
            if (existing) return existing;
            return {
              url,
              filename: this.uniqueFilenameFor(url, group, [...manual]),
              source: 'remote' as const,
            };
          });

        // Ensure filenames are unique within group
        const seen = new Set<string>();
        const finalEntries = [...remoteEntries, ...manual].map((e) => {
          let fn = e.filename;
          if (seen.has(fn)) fn = this.uniqueFilenameFor(e.url, group, [{ filename: fn } as QxResource], seen);
          seen.add(fn);
          return { ...e, filename: fn };
        });

        // Discard if removed
        void remoteSet;
        next[group] = finalEntries;
      }

      await this.saveManifest(next);
      return next;
    } finally {
      release();
    }
  }

  uniqueFilenameFor(url: string, _group: QxGroup, existing: { filename: string }[], extra?: Set<string>): string {
    const base = urlToFilename(url);
    const used = new Set([...existing.map((e) => e.filename), ...(extra ? Array.from(extra) : [])]);
    if (!used.has(base)) return base;
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? `${base.slice(0, dot)}-${hash}${base.slice(dot)}` : `${base}-${hash}`;
  }

  /**
   * Refresh resources: download all (or one URL) for given group(s).
   * Cleans up local files not in manifest (only when full-group refresh).
   * Downloads happen OUTSIDE the mutex so concurrent per-URL requests run in parallel.
   */
  async refresh(group?: QxGroup, url?: string): Promise<QxManifest> {
    if (url) {
      const g = group;
      if (!g) throw new AppError('QX_REFRESH', 'group is required when url is provided', 400);
      return this.refreshSingle(g, url);
    }
    await this.syncManifestFromConf();
    const groups: QxGroup[] = group ? [group] : [...QX_GROUPS];
    const manifest = await this.loadManifest();
    const urls: { group: QxGroup; url: string }[] = [];
    for (const g of groups) {
      await fsp.mkdir(this.groupDir(g), { recursive: true });
      for (const e of manifest[g]) urls.push({ group: g, url: e.url });
    }

    for (let i = 0; i < urls.length; i += QX_CONCURRENCY) {
      const batch = urls.slice(i, i + QX_CONCURRENCY);
      await Promise.all(batch.map((u) => this.refreshSingle(u.group, u.url).catch(() => undefined)));
    }

    const release = await this.mu.acquire();
    try {
      const next = await this.loadManifest();
      for (const g of groups) await this.cleanupGroup(g, next[g]);
      return next;
    } finally {
      release();
    }
  }

  private async refreshSingle(group: QxGroup, url: string): Promise<QxManifest> {
    const manifest = await this.loadManifest();
    const entry = manifest[group].find((e) => e.url === url);
    if (!entry) {
      throw new AppError('QX_NOT_FOUND', `url not in manifest: ${url}`, 404);
    }
    await fsp.mkdir(this.groupDir(group), { recursive: true });
    const result: QxResource = { ...entry };
    await this.downloadOne(group, result);

    const release = await this.mu.acquire();
    try {
      const cur = await this.loadManifest();
      const idx = cur[group].findIndex((e) => e.url === url);
      if (idx >= 0) {
        const prev = cur[group][idx]!;
        cur[group][idx] = {
          ...prev,
          size: result.size,
          updatedAt: result.updatedAt,
          error: result.error,
        };
        await this.saveManifest(cur);
      }
      return cur;
    } finally {
      release();
    }
  }

  private async downloadOne(group: QxGroup, entry: QxResource): Promise<void> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), QX_FETCH_TIMEOUT_MS);
      let buf: Buffer;
      try {
        const res = await fetchWithProxy(entry.url, ctrl.signal);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const ab = await res.arrayBuffer();
        buf = Buffer.from(ab);
      } finally {
        clearTimeout(timer);
      }
      const dest = path.join(this.groupDir(group), entry.filename);
      await fsp.writeFile(dest, buf);
      entry.size = buf.byteLength;
      entry.updatedAt = Date.now();
      entry.error = undefined;
    } catch (err) {
      const usedProxy = envProxy();
      const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.message ?? cause?.code ?? (err as Error).message;
      entry.error = usedProxy
        ? `${reason}（代理: ${usedProxy}）`
        : `${reason}（提示：可设置 HTTPS_PROXY 环境变量）`;
    }
  }

  private async cleanupGroup(group: QxGroup, entries: QxResource[]): Promise<void> {
    const dir = this.groupDir(group);
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return;
    }
    const keep = new Set(entries.map((e) => e.filename));
    for (const f of files) {
      if (!keep.has(f)) {
        await fsp.unlink(path.join(dir, f)).catch(() => undefined);
      }
    }
  }

  async addManual(group: QxGroup, url: string): Promise<QxManifest> {
    const release = await this.mu.acquire();
    try {
      const manifest = await this.loadManifest();
      if (manifest[group].some((e) => e.url === url)) {
        throw new AppError('QX_DUPLICATE', 'URL already exists in this group', 409);
      }
      const entry: QxResource = {
        url,
        filename: this.uniqueFilenameFor(url, group, manifest[group]),
        source: 'manual',
      };
      manifest[group] = [...manifest[group], entry];
      await this.saveManifest(manifest);
      return manifest;
    } finally {
      release();
    }
  }

  async removeEntry(group: QxGroup, filename: string): Promise<QxManifest> {
    const release = await this.mu.acquire();
    try {
      const manifest = await this.loadManifest();
      manifest[group] = manifest[group].filter((e) => e.filename !== filename);
      await fsp.unlink(path.join(this.groupDir(group), filename)).catch(() => undefined);
      await this.saveManifest(manifest);
      return manifest;
    } finally {
      release();
    }
  }

  async resolveStaticPath(group: QxGroup, filename: string): Promise<string> {
    const safe = path.basename(filename);
    const full = path.join(this.groupDir(group), safe);
    await fsp.access(full);
    return full;
  }

  /**
   * Build subscribe content: load .conf and replace each remote URL with local static URL.
   */
  async buildSubscribe(baseUrl: string): Promise<string> {
    const text = await this.loadConf();
    if (!text) {
      throw new AppError('QX_NO_CONF', 'QuantumultX.conf not configured', 400);
    }
    const manifest = await this.loadManifest();
    return replaceUrls(text, manifest, baseUrl);
  }

  parsedFromConf(): Promise<ParsedResources> {
    return this.loadConf().then(parseQxConf);
  }
}

export function replaceUrls(text: string, manifest: QxManifest, baseUrl: string): string {
  const mapping = new Map<string, string>();
  const base = baseUrl.replace(/\/+$/, '');
  for (const group of QX_GROUPS) {
    for (const entry of manifest[group]) {
      mapping.set(entry.url, `${base}/api/qx/static/${group}/${encodeURIComponent(entry.filename)}`);
    }
  }
  // Sort by descending length to avoid prefix collisions
  const sortedUrls = Array.from(mapping.keys()).sort((a, b) => b.length - a.length);
  let out = text;
  for (const url of sortedUrls) {
    const local = mapping.get(url)!;
    out = out.split(url).join(local);
  }
  return out;
}
