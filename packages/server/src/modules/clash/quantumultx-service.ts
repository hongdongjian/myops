import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Paths } from '../../paths.js';
import { AppError } from '../../core/errors.js';
import type { ClashConfig, ClashManifest } from './schema.js';
import { ClashService, buildClashDocument, fetchWithProxy, CLASH_FETCH_TIMEOUT_MS } from './service.js';
import { convertQxRuleResource, qxRuleLayout } from './quantumultx-rules.js';
import {
  convertClashToQuantumultX, parseProviderNodes, parseProviderRules,
  type ClashDocument, type QxConversion, type QxSources, type ConversionIssue,
} from './quantumultx-converter.js';

export class ClashQuantumultXService {
  constructor(private readonly clash: ClashService, private readonly paths: Paths) {}

  private async providerText(
    kind: 'nodes' | 'rules', name: string, provider: ClashDocument,
    validate: (text: string) => unknown, issues: ConversionIssue[],
  ): Promise<string> {
    if (provider.type === 'file') {
      const file = path.resolve(this.paths.rootDir, String(provider.path ?? ''));
      const text = await fsp.readFile(file, 'utf-8');
      validate(text);
      return text;
    }
    if (provider.type !== 'http' || typeof provider.url !== 'string' || !/^https?:\/\//.test(provider.url)) {
      throw new Error('invalid provider');
    }
    const headers: Record<string, string> = { 'User-Agent': 'clash.meta' };
    for (const [key, entry] of Object.entries(provider.header ?? {})) {
      headers[key] = Array.isArray(entry) ? entry.join(', ') : String(entry);
    }
    const hash = crypto.createHash('sha256').update(provider.url + JSON.stringify(headers)).digest('hex').slice(0, 24);
    const cache = this.paths.dataPath('clash', 'providers', kind + '-' + hash + '.txt');
    let previous: string | undefined;
    let modified = 0;
    try {
      previous = await fsp.readFile(cache, 'utf-8');
      validate(previous);
      modified = (await fsp.stat(cache)).mtimeMs;
    } catch { previous = undefined; }
    const interval = Number(provider.interval) > 0 ? Number(provider.interval) : 3600;
    if (previous !== undefined && Date.now() - modified < interval * 1000) return previous;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLASH_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchWithProxy(provider.url, controller.signal, headers);
      if (!response.ok) throw new Error('upstream failed');
      const text = Buffer.from(await response.arrayBuffer()).toString('utf-8');
      validate(text);
      await fsp.mkdir(path.dirname(cache), { recursive: true });
      const temporary = cache + '.' + crypto.randomUUID() + '.tmp';
      await fsp.writeFile(temporary, text);
      await fsp.rename(temporary, cache);
      return text;
    } catch (error) {
      if (previous === undefined) throw error;
      issues.push({ code: 'stale:' + kind + ':' + name, message: '集合暂时无法更新，使用上次缓存：' + name, count: 1 });
      return previous;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async context(baseUrl = '') {
    const [template, config, manifest] = await Promise.all([
      this.clash.loadTemplate(), this.clash.loadConfig(), this.clash.loadManifest(),
    ]);
    if (!template.trim()) throw new AppError('CLASH_NO_TEMPLATE', '请先在 Clash 管理中保存 YAML 模板', 400);
    const doc = buildClashDocument(template, config, baseUrl) as ClashDocument;
    return { doc, config, manifest };
  }

  private async ruleSources(
    doc: ClashDocument, config: ClashConfig, manifest: ClashManifest,
    names: string[], issues: ConversionIssue[],
  ): Promise<Record<string, string[]>> {
    const rules: Record<string, string[]> = {};
    const custom = new Map(config.custom_rules.filter(rule => rule.enabled !== false).map(rule => [rule.name, rule.rules]));
    const visited = new Set<string>();
    const load = async (name: string): Promise<void> => {
      if (visited.has(name)) return;
      visited.add(name);
      const provider = doc['rule-providers']?.[name] as ClashDocument | undefined;
      if (!provider) return;
      try {
        let entries: string[] | undefined;
        if (custom.has(name)) entries = custom.get(name)!;
        else if (provider.format === 'mrs') throw new Error('mrs');
        else if (provider.type === 'inline' && Array.isArray(provider.payload)) entries = provider.payload;
        else {
          const cached = manifest.list.find(entry => entry.url === provider.url);
          if (cached) {
            try {
              entries = parseProviderRules(await fsp.readFile(path.join(this.clash.groupDir('list'), path.basename(cached.filename)), 'utf-8'), provider.format ?? 'yaml');
            } catch { /* Fetch a missing or invalid cached resource below. */ }
          }
          if (!entries) {
            const validate = (text: string) => parseProviderRules(text, provider.format ?? 'yaml');
            entries = validate(await this.providerText('rules', name, provider, validate, issues));
          }
        }
        rules[name] = entries!;
        if (!provider.behavior || provider.behavior === 'classical') {
          const nested = entries!.filter(line => line.trim().startsWith('RULE-SET,')).map(line => line.split(',')[1]!.trim());
          await Promise.all(nested.map(load));
        }
      } catch {
        issues.push({ code: 'provider:rules:' + name, message: '规则集合读取失败或格式不支持：' + name, count: 1 });
      }
    };
    await Promise.all(names.map(load));
    return rules;
  }

  async buildRuleResource(id: string): Promise<string> {
    const { doc, config, manifest } = await this.context();
    const spec = qxRuleLayout(doc).resources.find(resource => resource.id === id);
    if (!spec) throw new AppError('QX_RULE_NOT_FOUND', '规则资源不存在或已移除', 404);
    const issues: ConversionIssue[] = [];
    const rules = await this.ruleSources(doc, config, manifest, spec.providerName === undefined ? [] : [spec.providerName], issues);
    const result = convertQxRuleResource(spec, doc, { rules });
    if (!result.available) throw new AppError('QX_RULE_UNAVAILABLE', '规则资源暂时不可用，请在 Clash 页面检查或刷新规则集', 503);
    return result.content;
  }

  async build(baseUrl: string): Promise<QxConversion> {
    const { doc, config, manifest } = await this.context(baseUrl);
    const issues: ConversionIssue[] = [];
    const sources: QxSources = { nodes: {}, rules: {}, issues, iconUrls: new Map() };
    const base = baseUrl.replace(/\/+$/, '');
    sources.ruleResourceUrl = id => base + '/api/qx/rules/' + id
      + (config.api_key ? '?api-key=' + encodeURIComponent(config.api_key) : '');
    for (const resource of manifest.icon) {
      sources.iconUrls!.set(resource.url, base + '/api/clash/static/icon/' + encodeURIComponent(resource.filename));
    }
    const nodeProviders = Object.entries(doc['proxy-providers'] ?? {}) as [string, ClashDocument][];
    for (const [name] of nodeProviders) sources.nodes[name] = [];
    await Promise.all(nodeProviders.map(async ([name, provider]) => {
      try {
        let nodes: ClashDocument[];
        if (provider.type === 'inline' && Array.isArray(provider.payload)) nodes = provider.payload;
        else nodes = parseProviderNodes(await this.providerText('nodes', name, provider, parseProviderNodes, issues));
        const overrides = provider.override ?? {};
        sources.nodes[name] = nodes.map(node => ({
          ...node,
          ...Object.fromEntries(['tfo', 'udp', 'skip-cert-verify'].filter(key => key in overrides).map(key => [key, overrides[key]])),
          name: String(overrides['additional-prefix'] ?? '') + node.name + String(overrides['additional-suffix'] ?? ''),
        }));
      } catch {
        sources.nodes[name] = [];
        issues.push({ code: 'provider:nodes:' + name, message: '节点集合读取失败或不是 Clash 节点格式：' + name, count: 1 });
      }
    }));
    const names = qxRuleLayout(doc).resources.map(resource => resource.providerName).filter((name): name is string => name !== undefined);
    sources.rules = await this.ruleSources(doc, config, manifest, names, issues);
    return convertClashToQuantumultX(doc, sources);
  }
}
