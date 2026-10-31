import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { Mutex } from 'async-mutex';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import {
  CLASH_GROUPS,
  emptyManifest,
  type ClashConfig,
  type ClashCustomRule,
  type ClashManifest,
  type ClashProxy,
  type ClashResource,
  type ClashResourceGroup,
} from './schema.js';
import { extractGroupNames, parseClashYaml, urlToFilename } from './parser.js';

export const CLASH_FETCH_TIMEOUT_MS = 30 * 1000;
export const CLASH_CONCURRENCY = 4;
export const CLASH_DEFAULT_RULE_INTERVAL_SECONDS = 24 * 60 * 60;

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

export async function fetchWithProxy(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  const dispatcher = getProxyAgent();
  if (dispatcher) {
    return undiciFetch(url, { signal, dispatcher, headers }) as unknown as Promise<{
      ok: boolean;
      status: number;
      arrayBuffer(): Promise<ArrayBuffer>;
    }>;
  }
  return fetch(url, { signal, headers }) as unknown as Promise<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

export class ClashService {
  private readonly mu = new Mutex();
  private readonly refreshMu = new Mutex();

  constructor(private readonly deps: Deps) {}

  rootDir(): string {
    return this.deps.paths.confPath('clash');
  }
  dataDir(): string {
    return this.deps.paths.dataPath('clash');
  }
  templatePath(): string {
    return path.join(this.rootDir(), 'template.yaml');
  }
  configPath(): string {
    return path.join(this.dataDir(), 'config.json');
  }
  customPath(): string {
    return path.join(this.rootDir(), 'custom.json');
  }
  private legacyConfigPath(): string {
    return path.join(this.rootDir(), 'config.json');
  }
  manifestPath(): string {
    return path.join(this.dataDir(), 'manifest.json');
  }
  groupDir(group: ClashResourceGroup): string {
    return path.join(this.dataDir(), 'resources', group);
  }
  customRuleListPath(id: string): string {
    return path.join(this.groupDir('list'), `custom-${id}.list`);
  }
  customRuleFilename(id: string): string {
    return `custom-${id}.list`;
  }

  async loadConfig(): Promise<ClashConfig> {
    const machine = await this.readJsonFile(this.configPath());
    let custom = await this.readJsonFile(this.customPath());
    // legacy fallbacks
    const legacyData = machine ?? (await this.readJsonFile(this.legacyConfigPath()));
    if (!custom && legacyData) {
      const hasCustom =
        Array.isArray((legacyData as any).custom_proxies) ||
        Array.isArray((legacyData as any).custom_rules);
      if (hasCustom) {
        custom = {
          custom_proxies: Array.isArray((legacyData as any).custom_proxies)
            ? (legacyData as any).custom_proxies
            : [],
          custom_rules: Array.isArray((legacyData as any).custom_rules)
            ? (legacyData as any).custom_rules
            : [],
        };
        await this.writeJsonFile(this.customPath(), custom);
      }
    }
    const merged = machine ?? legacyData ?? {};
    const legacyBaseUrl = typeof merged.public_base_url === 'string' ? merged.public_base_url : undefined;
    return {
      api_key: typeof (merged as any).api_key === 'string' ? (merged as any).api_key : undefined,
      clash_public_base_url:
        typeof merged.clash_public_base_url === 'string' ? merged.clash_public_base_url : legacyBaseUrl,
      qx_public_base_url:
        typeof merged.qx_public_base_url === 'string' ? merged.qx_public_base_url : legacyBaseUrl,
      custom_proxies: Array.isArray((custom as any)?.custom_proxies)
        ? ((custom as any).custom_proxies as ClashProxy[])
        : Array.isArray((merged as any).custom_proxies)
          ? ((merged as any).custom_proxies as ClashProxy[])
          : [],
      custom_rules: Array.isArray((custom as any)?.custom_rules)
        ? ((custom as any).custom_rules as ClashCustomRule[])
        : Array.isArray((merged as any).custom_rules)
          ? ((merged as any).custom_rules as ClashCustomRule[])
          : [],
    };
  }

  private async readJsonFile(p: string): Promise<Record<string, unknown> | null> {
    let data: string;
    try {
      data = await fsp.readFile(p, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError('CLASH_CONFIG_READ', `failed to read ${p}: ${(err as Error).message}`, 500);
    }
    if (!data.trim()) return null;
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async writeJsonFile(target: string, obj: unknown): Promise<void> {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fsp.rename(tmp, target);
  }

  private defaultConfig(): ClashConfig {
    return { custom_proxies: [], custom_rules: [] };
  }

  async saveConfig(cfg: ClashConfig): Promise<void> {
    const machine: Record<string, unknown> = {};
    if (cfg.api_key) machine.api_key = cfg.api_key;
    if (cfg.clash_public_base_url) machine.clash_public_base_url = cfg.clash_public_base_url;
    if (cfg.qx_public_base_url) machine.qx_public_base_url = cfg.qx_public_base_url;
    await this.writeJsonFile(this.configPath(), machine);
    await this.writeJsonFile(this.customPath(), {
      custom_proxies: cfg.custom_proxies,
      custom_rules: cfg.custom_rules,
    });
    await fsp.unlink(this.legacyConfigPath()).catch(() => undefined);
  }

  async loadTemplate(): Promise<string> {
    try {
      return await fsp.readFile(this.templatePath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new AppError('CLASH_TEMPLATE_READ', `failed to read template: ${(err as Error).message}`, 500);
    }
  }

  async saveTemplate(text: string): Promise<void> {
    await fsp.mkdir(this.rootDir(), { recursive: true });
    await fsp.writeFile(this.templatePath(), text);
  }

  async loadManifest(): Promise<ClashManifest> {
    let data: string;
    try {
      data = await fsp.readFile(this.manifestPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest();
      throw new AppError('CLASH_MANIFEST_READ', `failed to read manifest: ${(err as Error).message}`, 500);
    }
    if (!data.trim()) return emptyManifest();
    let parsed: Partial<ClashManifest>;
    try {
      parsed = JSON.parse(data) as Partial<ClashManifest>;
    } catch {
      return emptyManifest();
    }
    const m = emptyManifest();
    for (const g of CLASH_GROUPS) {
      if (Array.isArray(parsed[g])) m[g] = parsed[g] as ClashResource[];
    }
    return m;
  }

  async saveManifest(m: ClashManifest): Promise<void> {
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

  async getGroupNames(): Promise<string[]> {
    const text = await this.loadTemplate();
    return extractGroupNames(text);
  }

  /**
   * Sync manifest from current template + custom rules.
   * Preserves manual entries; rebuilds remote and local-custom entries.
   */
  async syncManifest(): Promise<ClashManifest> {
    const text = await this.loadTemplate();
    const parsed = parseClashYaml(text);
    const cfg = await this.loadConfig();
    const release = await this.mu.acquire();
    try {
      const current = await this.loadManifest();
      const next: ClashManifest = emptyManifest();

      for (const group of CLASH_GROUPS) {
        const remoteUrls = (parsed[group] as string[]) ?? [];
        const remoteSet = new Set(remoteUrls);
        void remoteSet;

        const manual = current[group].filter((r) => r.source === 'manual');
        const manualUrlSet = new Set(manual.map((r) => r.url));

        const existingRemoteByUrl = new Map(
          current[group].filter((r) => r.source === 'remote').map((r) => [r.url, r] as const),
        );

        const remoteEntries: ClashResource[] = remoteUrls
          .filter((u) => !manualUrlSet.has(u))
          .map((url) => {
            const existing = existingRemoteByUrl.get(url);
            if (existing) return existing;
            return {
              url,
              filename: this.uniqueFilenameFor(url, group, manual),
              source: 'remote' as const,
            };
          });

        const seen = new Set<string>();
        const merged: ClashResource[] = [...remoteEntries, ...manual].map((e) => {
          let fn = e.filename;
          if (seen.has(fn)) {
            fn = this.uniqueFilenameFor(e.url, group, [{ filename: fn } as ClashResource], seen);
          }
          seen.add(fn);
          return { ...e, filename: fn };
        });

        if (group === 'list') {
          const localBaseUrl = this.localPlaceholderBase();
          for (const rule of cfg.custom_rules) {
            const filename = this.customRuleFilename(rule.id);
            if (seen.has(filename)) continue;
            seen.add(filename);
            merged.push({
              url: `${localBaseUrl}/${filename}`,
              filename,
              source: 'local',
            });
          }
        }

        next[group] = merged;
      }

      if (JSON.stringify(next) !== JSON.stringify(current)) await this.saveManifest(next);
      return next;
    } finally {
      release();
    }
  }

  private localPlaceholderBase(): string {
    return 'local://clash/list';
  }

  uniqueFilenameFor(
    url: string,
    _group: ClashResourceGroup,
    existing: { filename: string }[],
    extra?: Set<string>,
  ): string {
    const base = urlToFilename(url);
    const used = new Set([...existing.map((e) => e.filename), ...(extra ? Array.from(extra) : [])]);
    if (!used.has(base)) return base;
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? `${base.slice(0, dot)}-${hash}${base.slice(dot)}` : `${base}-${hash}`;
  }

  async refresh(group?: ClashResourceGroup, url?: string): Promise<ClashManifest> {
    return this.refreshMu.runExclusive(() => this.refreshResources(group, url));
  }

  async refreshDueRules(signal?: AbortSignal): Promise<{ refreshed: number; failed: number }> {
    return this.refreshMu.runExclusive(async () => {
      let refreshed = 0;
      let failed = 0;
      if (signal?.aborted) return { refreshed, failed };
      const manifest = await this.syncManifest();
      const template = YAML.parse(await this.loadTemplate()) ?? {};
      const intervals = new Map<string, number>();
      for (const provider of Object.values(template['rule-providers'] ?? {}) as Record<string, unknown>[]) {
        if (!provider || typeof provider.url !== 'string') continue;
        const seconds = Number(provider.interval);
        const interval = Number.isFinite(seconds) && seconds > 0 ? seconds : CLASH_DEFAULT_RULE_INTERVAL_SECONDS;
        intervals.set(provider.url, Math.min(interval, intervals.get(provider.url) ?? interval));
      }
      const due: ClashResource[] = [];
      for (const entry of manifest.list) {
        if (entry.source === 'local') continue;
        let modified: number | undefined;
        try { modified = (await fsp.stat(path.join(this.groupDir('list'), entry.filename))).mtimeMs; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const lastSuccess = entry.updatedAt ?? modified ?? 0;
        const interval = (intervals.get(entry.url) ?? CLASH_DEFAULT_RULE_INTERVAL_SECONDS) * 1000;
        if (modified === undefined || Date.now() - lastSuccess >= interval) due.push(entry);
      }
      await fsp.mkdir(this.groupDir('list'), { recursive: true });
      for (let i = 0; i < due.length && !signal?.aborted; i += CLASH_CONCURRENCY) {
        await Promise.all(due.slice(i, i + CLASH_CONCURRENCY).map(async entry => {
          try {
            const next = await this.refreshSingle('list', entry.url, signal);
            if (signal?.aborted) return;
            if (next.list.find(resource => resource.url === entry.url)?.error) failed++;
            else refreshed++;
          } catch { if (!signal?.aborted) failed++; }
        }));
      }
      return { refreshed, failed };
    });
  }

  private async refreshResources(group?: ClashResourceGroup, url?: string): Promise<ClashManifest> {
    if (url) {
      const g = group;
      if (!g) throw new AppError('CLASH_REFRESH', 'group is required when url is provided', 400);
      return this.refreshSingle(g, url);
    }
    await this.syncManifest();
    const groups: ClashResourceGroup[] = group ? [group] : [...CLASH_GROUPS];
    const manifest = await this.loadManifest();
    const targets: { group: ClashResourceGroup; url: string }[] = [];
    for (const g of groups) {
      await fsp.mkdir(this.groupDir(g), { recursive: true });
      for (const e of manifest[g]) {
        if (e.source === 'local') continue;
        targets.push({ group: g, url: e.url });
      }
    }

    for (let i = 0; i < targets.length; i += CLASH_CONCURRENCY) {
      const batch = targets.slice(i, i + CLASH_CONCURRENCY);
      await Promise.all(batch.map((t) => this.refreshSingle(t.group, t.url).catch(() => undefined)));
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

  private async refreshSingle(group: ClashResourceGroup, url: string, signal?: AbortSignal): Promise<ClashManifest> {
    const manifest = await this.loadManifest();
    const entry = manifest[group].find((e) => e.url === url);
    if (!entry) {
      throw new AppError('CLASH_NOT_FOUND', `url not in manifest: ${url}`, 404);
    }
    if (entry.source === 'local') return manifest;
    await fsp.mkdir(this.groupDir(group), { recursive: true });
    const result: ClashResource = { ...entry };
    await this.downloadOne(group, result, signal);
    if (signal?.aborted) return this.loadManifest();

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

  private async validateResource(group: ClashResourceGroup, url: string, buffer: Buffer): Promise<void> {
    if (!buffer.length) throw new Error('资源内容为空');
    const prefix = buffer.subarray(0, 512).toString('utf-8').trim();
    if (/^(<!doctype\s+html\b|<html\b)/i.test(prefix)) throw new Error('资源返回了 HTML 页面');
    if (group !== 'list') return;
    const template = YAML.parse(await this.loadTemplate()) ?? {};
    const providers = (Object.values(template['rule-providers'] ?? {}) as Record<string, unknown>[]).filter(provider => provider?.url === url);
    for (const provider of providers) {
      if (provider.format === 'mrs') continue;
      const text = buffer.toString('utf-8').trim();
      if (!text) throw new Error('规则内容为空');
      if (provider.format === 'text') {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^(#|;|\/\/)/.test(line));
        if (!lines.length) throw new Error('资源未包含规则');
        const valid = lines.every(line => {
          if (provider.behavior === 'domain') return !/[,\s<>]/.test(line);
          if (provider.behavior === 'ipcidr') return /^[\da-fA-F.:]+\/\d+$/.test(line);
          return /^[A-Z][A-Z0-9-]*\s*,/.test(line);
        });
        if (!valid) throw new Error('规则内容格式无效');
      } else {
        const parsed = YAML.parse(text);
        const payload = Array.isArray(parsed) ? parsed : parsed?.payload;
        if (!Array.isArray(payload) || !payload.every(line => typeof line === 'string')) throw new Error('规则 YAML 必须包含 payload 数组');
      }
    }
  }

  private async downloadOne(group: ClashResourceGroup, entry: ClashResource, signal?: AbortSignal): Promise<void> {
    let temporary: string | undefined;
    try {
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      if (signal?.aborted) return;
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), CLASH_FETCH_TIMEOUT_MS);
      let buf: Buffer;
      try {
        const res = await fetchWithProxy(entry.url, ctrl.signal);
        if (!res.ok) throw new Error('status ' + res.status);
        buf = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
      await this.validateResource(group, entry.url, buf);
      if (signal?.aborted) return;
      const dest = path.join(this.groupDir(group), entry.filename);
      temporary = dest + '.' + crypto.randomUUID() + '.tmp';
      await fsp.writeFile(temporary, buf);
      await fsp.rename(temporary, dest);
      entry.size = buf.byteLength;
      entry.updatedAt = Date.now();
      entry.error = undefined;
    } catch (err) {
      if (signal?.aborted) return;
      const usedProxy = envProxy();
      const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.message ?? cause?.code ?? (err as Error).message;
      entry.error = usedProxy
        ? reason + '（代理: ' + usedProxy + '）'
        : reason + '（提示：可设置 HTTPS_PROXY 环境变量）';
    } finally {
      if (temporary) await fsp.unlink(temporary).catch(() => undefined);
    }
  }

  private async cleanupGroup(group: ClashResourceGroup, entries: ClashResource[]): Promise<void> {
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

  async addManual(group: ClashResourceGroup, url: string): Promise<ClashManifest> {
    const release = await this.mu.acquire();
    try {
      const manifest = await this.loadManifest();
      if (manifest[group].some((e) => e.url === url)) {
        throw new AppError('CLASH_DUPLICATE', 'URL already exists in this group', 409);
      }
      const entry: ClashResource = {
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

  async removeEntry(group: ClashResourceGroup, filename: string): Promise<ClashManifest> {
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

  async resolveStaticPath(group: ClashResourceGroup, filename: string): Promise<string> {
    const safe = path.basename(filename);
    const full = path.join(this.groupDir(group), safe);
    await fsp.access(full);
    return full;
  }

  /**
   * Persist all custom_rules in cfg as local .list files under data/clash/resources/list/.
   * Deletes any stale custom-*.list that no longer matches a rule.
   */
  async writeCustomRuleFiles(cfg: ClashConfig): Promise<void> {
    await fsp.mkdir(this.groupDir('list'), { recursive: true });
    const keep = new Set(cfg.custom_rules.map((r) => this.customRuleFilename(r.id)));
    for (const rule of cfg.custom_rules) {
      const dest = this.customRuleListPath(rule.id);
      const validRules = rule.rules.filter((r) => {
        const trimmed = r.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//');
      });
      const content = validRules.join('\n') + (validRules.length ? '\n' : '');
      await fsp.writeFile(dest, content);
    }
    const dir = this.groupDir('list');
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const f of files) {
      if (f.startsWith('custom-') && f.endsWith('.list') && !keep.has(f)) {
        await fsp.unlink(path.join(dir, f)).catch(() => undefined);
      }
    }
  }

  /**
   * Build subscribe yaml: parse template, inject custom_proxies, inject custom_rules as
   * rule-providers + prepend RULE-SET lines, and replace remote resource URLs with local
   * /api/clash/static/list/<filename> or /api/static/icon/<filename>.
   */
  async buildSubscribe(baseUrl: string): Promise<string> {
    const text = await this.loadTemplate();
    if (!text.trim()) {
      throw new AppError('CLASH_NO_TEMPLATE', '请先在 Clash 管理中保存 YAML 模板', 400);
    }
    const cfg = await this.loadConfig();
    const manifest = await this.loadManifest();
    return buildClashSubscribe(text, cfg, manifest, baseUrl);
  }
}

export function buildClashSubscribe(
  templateText: string,
  cfg: ClashConfig,
  manifest: ClashManifest,
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const query = cfg.api_key ? '?api-key=' + encodeURIComponent(cfg.api_key) : '';
  let out = YAML.stringify(buildClashDocument(templateText, cfg, baseUrl));
  const mapping = new Map<string, string>();
  for (const group of CLASH_GROUPS) {
    for (const entry of manifest[group]) {
      if (entry.source === 'local') continue;
      const prefix = group === 'icon' ? '/api/static/icon/' : '/api/clash/static/list/';
      mapping.set(entry.url, base + prefix + encodeURIComponent(entry.filename) + query);
    }
  }
  const sortedUrls = Array.from(mapping.keys()).sort((a, b) => b.length - a.length);
  for (const url of sortedUrls) out = out.split(url).join(mapping.get(url)!);
  return out;
}

export function buildClashDocument(
  templateText: string,
  cfg: ClashConfig,
  baseUrl: string,
): Record<string, unknown> {
  const base = baseUrl.replace(/\/+$/, '');
  const query = cfg.api_key ? '?api-key=' + encodeURIComponent(cfg.api_key) : '';
  let doc: Record<string, unknown>;
  try {
    doc = (YAML.parse(templateText) ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw new AppError('CLASH_TEMPLATE_PARSE', `模板 YAML 解析失败: ${(err as Error).message}`, 400);
  }

  if (cfg.custom_proxies.length > 0) {
    const existingProxies = Array.isArray(doc.proxies) ? (doc.proxies as unknown[]) : [];
    doc.proxies = [...cfg.custom_proxies.map((p) => p as Record<string, unknown>), ...existingProxies];
  }

  const enabledRules = cfg.custom_rules.filter((r) => r.enabled !== false);
  if (enabledRules.length > 0) {
    const providers = (doc['rule-providers'] && typeof doc['rule-providers'] === 'object'
      ? (doc['rule-providers'] as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    for (const rule of enabledRules) {
      providers[rule.name] = {
        type: 'http',
        behavior: rule.behavior,
        format: 'text',
        interval: 86400,
        url: `${base}/api/clash/static/list/custom-${encodeURIComponent(rule.id)}.list${query}`,
      };
    }
    doc['rule-providers'] = providers;

    const existing = Array.isArray(doc.rules) ? (doc.rules as unknown[]) : [];
    const prepend = enabledRules.map((r) => `RULE-SET,${r.name},${r.target_group}`);
    doc.rules = [...prepend, ...existing];
  }

  const providers = doc['rule-providers'];
  if (providers && typeof providers === 'object') {
    for (const value of Object.values(providers)) {
      if (!value || typeof value !== 'object') continue;
      const provider = value as Record<string, unknown>;
      if (provider.type !== 'http' || typeof provider.url !== 'string') continue;
      // Rule downloads must not depend on the rules they are about to load.
      provider.proxy = 'DIRECT';
    }
  }

  return doc;
}
