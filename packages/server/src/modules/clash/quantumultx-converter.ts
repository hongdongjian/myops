import YAML from 'yaml';
import { convertClashRules, type QxRuleResource } from './quantumultx-rules.js';

export type ClashDocument = Record<string, any>;
export interface ConversionIssue {
  code: string;
  message: string;
  count: number;
}
export interface QxConversion {
  content: string;
  ruleResources: QxRuleResource[];
  stats: { nodes: number; groups: number; rules: number; skippedNodes: number; skippedRules: number };
  issues: ConversionIssue[];
}
export interface QxSources {
  nodes: Record<string, ClashDocument[]>;
  rules: Record<string, string[]>;
  issues?: ConversionIssue[];
  iconUrls?: Map<string, string>;
  ruleResourceUrl?: (id: string) => string;
}

export function parseProviderNodes(text: string): ClashDocument[] {
  const parsed = YAML.parse(text);
  const nodes = Array.isArray(parsed) ? parsed : parsed?.proxies;
  if (!Array.isArray(nodes)) throw new Error('节点集合必须包含 proxies 数组');
  return nodes.filter((node): node is ClashDocument => !!node && typeof node === 'object');
}

export function parseProviderRules(text: string, format = 'text'): string[] {
  if (format === 'mrs') throw new Error('暂不支持 MRS 二进制规则');
  if (/^\s*(<!doctype|<html)/i.test(text)) throw new Error('规则资源返回了网页');
  if (format === 'yaml') {
    const parsed = YAML.parse(text);
    const rules = Array.isArray(parsed) ? parsed : parsed?.payload;
    if (!Array.isArray(rules)) throw new Error('规则集合必须包含 payload 数组');
    return rules.filter((rule): rule is string => typeof rule === 'string');
  }
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^(#|;|\/\/)/.test(line));
}

function value(input: unknown): string {
  const text = String(input ?? '');
  if (!text || /[,\r\n]/.test(text)) throw new Error('字段为空或含 QX 不支持的分隔符');
  return text;
}

function nodeLine(node: ClashDocument): string {
  const type = String(node.type ?? '').toLowerCase();
  if (!['ss', 'ssr', 'vmess', 'vless', 'trojan', 'http', 'socks5', 'anytls'].includes(type)) {
    throw new Error('不支持节点协议 ' + (type || '(空)'));
  }
  if (node['dialer-proxy'] && node['dialer-proxy'] !== 'DIRECT') throw new Error('不支持 dialer-proxy 链式节点');
  if (node.smux?.enabled) throw new Error('不支持 smux 多路复用');
  const server = value(node.server);
  const port = Number(node.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('节点端口无效');
  const address = (server.includes(':') && !server.startsWith('[') ? '[' + server + ']' : server) + ':' + port;
  const params: string[] = [];
  const add = (key: string, entry: unknown) => params.push(key + '=' + value(entry));
  const network = String(node.network ?? 'tcp').toLowerCase();
  if (!['tcp', 'ws', 'http'].includes(network)) throw new Error('不支持传输方式 ' + network);

  if (['ss', 'ssr'].includes(type)) {
    add('method', node.cipher);
    add('password', node.password);
    if (type === 'ssr') {
      add('ssr-protocol', node.protocol);
      if (node['protocol-param']) add('ssr-protocol-param', node['protocol-param']);
      if (node.obfs && node.obfs !== 'plain') add('obfs', node.obfs);
      if (node['obfs-param']) add('obfs-host', node['obfs-param']);
    }
    if (node.plugin) {
      const options = node['plugin-opts'] ?? {};
      if (node.plugin === 'obfs') {
        if (!['http', 'tls'].includes(options.mode)) throw new Error('不支持该 obfs 模式');
        add('obfs', options.mode);
      } else if (node.plugin === 'v2ray-plugin' && options.mode === 'websocket' && !options.mux) {
        add('obfs', options.tls ? 'wss' : 'ws');
        if (options.path) add('obfs-uri', options.path);
      } else {
        throw new Error('不支持插件 ' + node.plugin);
      }
      if (options.host) add('obfs-host', options.host);
    }
  } else if (['vmess', 'vless'].includes(type)) {
    add('method', type === 'vless' ? 'none' : (!node.cipher || node.cipher === 'auto' ? 'aes-128-gcm' : node.cipher));
    add('password', node.uuid);
    if (type === 'vmess' && Number(node.alterId ?? 0) > 0) add('aead', false);
    if (type === 'vless' && node.flow) {
      if (node.flow !== 'xtls-rprx-vision') throw new Error('不支持 VLESS flow ' + node.flow);
      add('vless-flow', node.flow);
    }
  } else {
    if (node.username) add('username', node.username);
    if (node.password) add('password', node.password);
    if (['trojan', 'anytls'].includes(type) && !node.password) throw new Error('节点密码缺失');
  }

  const tls = !!node.tls || ['trojan', 'anytls'].includes(type);
  const ws = node['ws-opts'] ?? {};
  const headers = ws.headers ?? {};
  const host = headers.Host ?? headers.host;
  const sni = node.servername ?? node.sni;
  if (network === 'ws') {
    if (['http', 'socks5', 'anytls'].includes(type)) throw new Error('该协议不支持 WebSocket 转换');
    if (ws['max-early-data'] || ws['early-data-header-name']) throw new Error('不支持 WebSocket early-data');
    if (Object.keys(headers).some(key => key.toLowerCase() !== 'host')) throw new Error('不支持额外 WebSocket 请求头');
    if (host && sni && host !== sni) throw new Error('WebSocket Host 与 TLS SNI 不一致');
    add('obfs', tls ? 'wss' : 'ws');
    if (host || sni) add('obfs-host', host || sni);
    if (ws.path) add('obfs-uri', ws.path);
  } else if (network === 'http') {
    if (!['vmess', 'vless'].includes(type) || tls) throw new Error('不支持该 HTTP 伪装组合');
    const options = node['http-opts'] ?? {};
    const httpHost = options.headers?.Host ?? options.headers?.host;
    add('obfs', 'http');
    if (httpHost) add('obfs-host', Array.isArray(httpHost) ? httpHost[0] : httpHost);
    if (options.path?.length) add('obfs-uri', Array.isArray(options.path) ? options.path[0] : options.path);
  } else if (tls) {
    if (['vmess', 'vless', 'ss'].includes(type)) {
      add('obfs', 'over-tls');
      if (sni) add('obfs-host', sni);
    } else {
      add('over-tls', true);
      if (sni) add('tls-host', sni);
    }
  }
  if (tls) {
    add('tls-verification', node['skip-cert-verify'] !== true);
    const reality = node['reality-opts'];
    if (reality) {
      add('reality-base64-pubkey', reality['public-key']);
      if (reality['short-id']) add('reality-hex-shortid', reality['short-id']);
    }
    if (node.fingerprint) {
      const fingerprint = String(node.fingerprint).replace(/:/g, '');
      if (!/^[a-fA-F0-9]{64}$/.test(fingerprint)) throw new Error('无法转换证书指纹');
      add('tls-cert-sha256', fingerprint);
    }
    if (Array.isArray(node.alpn) && node.alpn.length) {
      add('tls-alpn', Buffer.concat(node.alpn.map((entry: string) => {
        const bytes = Buffer.from(entry);
        if (bytes.length > 255) throw new Error('ALPN 无效');
        return Buffer.concat([Buffer.from([bytes.length]), bytes]);
      })).toString('hex'));
    }
  }
  add('fast-open', !!node.tfo);
  add('udp-relay', !!node.udp);
  add('tag', node.name);
  return (['ss', 'ssr'].includes(type) ? 'shadowsocks' : type) + '=' + address + ', ' + params.join(', ');
}

export function convertClashToQuantumultX(doc: ClashDocument, sources: QxSources): QxConversion {
  const issues = new Map<string, ConversionIssue>();
  const note = (code: string, message: string, count = 1) => {
    const previous = issues.get(code);
    issues.set(code, { code, message, count: (previous?.count ?? 0) + count });
  };
  for (const issue of sources.issues ?? []) note(issue.code, issue.message, issue.count);
  let skippedNodes = 0;
  let skippedRules = 0;
  const nodes = new Map<string, { node: ClashDocument; line: string }>();
  const inlineNames: string[] = [];
  const providerNames = new Map<string, string[]>();
  const addNode = (node: ClashDocument): string | undefined => {
    const name = String(node.name ?? '');
    if (nodes.has(name)) return name;
    try {
      value(name);
      const line = nodeLine(node);
      nodes.set(name, { node, line });
      if (node['client-fingerprint']) note('client-fingerprint', '客户端 TLS 指纹由 Quantumult X 自身实现处理');
      return name;
    } catch (error) {
      skippedNodes++;
      const reason = (error as Error).message;
      note('node:' + reason, reason);
      return undefined;
    }
  };
  for (const node of Array.isArray(doc.proxies) ? doc.proxies : []) {
    const name = addNode(node);
    if (name) inlineNames.push(name);
  }
  for (const [provider, entries] of Object.entries(sources.nodes)) {
    providerNames.set(provider, entries.map(addNode).filter((name): name is string => !!name));
  }

  const groups = new Map<string, ClashDocument>();
  for (const group of Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : []) {
    try { value(group.name); groups.set(group.name, group); }
    catch { note('invalid-group', '跳过名称无效的策略组'); }
  }
  const builtins: Record<string, string> = { DIRECT: 'direct', REJECT: 'reject', 'REJECT-DROP': 'reject' };
  const target = (name: string): string => {
    if (builtins[name]) return builtins[name]!;
    if (nodes.has(name) || groups.has(name)) return name;
    note('target:' + name, '策略目标不可用，改为拒绝连接：' + name);
    return 'reject';
  };
  const compiledPolicies = new Map<string, string>();
  const edges = new Map<string, string[]>();
  const visits = new Set<string>();
  const completed = new Set<string>();
  const compileGroup = (name: string): void => {
    if (completed.has(name)) return;
    visits.add(name);
    const group = groups.get(name)!;
    const explicit: string[] = Array.isArray(group.proxies) ? group.proxies : [];
    let dynamic: string[] = [];
    if (group['include-all'] || group['include-all-proxies']) dynamic.push(...inlineNames);
    if (group['include-all'] || group['include-all-providers']) dynamic.push(...Array.from(providerNames.values()).flat());
    for (const provider of Array.isArray(group.use) ? group.use : []) {
      if (!providerNames.has(provider)) note('group-provider:' + provider, '策略组引用的节点集合不可用：' + provider);
      dynamic.push(...(providerNames.get(provider) ?? []));
    }
    try {
      if (group.filter) {
        const regex = new RegExp(String(group.filter).replace(/^\(\?i\)/, ''), String(group.filter).startsWith('(?i)') ? 'i' : '');
        dynamic = dynamic.filter(entry => regex.test(entry));
      }
      if (group['exclude-filter']) {
        const regex = new RegExp(String(group['exclude-filter']).replace(/^\(\?i\)/, ''), String(group['exclude-filter']).startsWith('(?i)') ? 'i' : '');
        dynamic = dynamic.filter(entry => !regex.test(entry));
      }
      if (group['exclude-type']) {
        const excluded = new Set(String(group['exclude-type']).toLowerCase().split('|'));
        dynamic = dynamic.filter(entry => !excluded.has(String(nodes.get(entry)?.node.type).toLowerCase()));
      }
    } catch {
      dynamic = [];
      note('filter:' + name, '节点筛选正则无法转换：' + name);
    }
    const members: string[] = [];
    for (const candidate of new Set([...explicit, ...dynamic])) {
      if (groups.has(candidate)) {
        if (visits.has(candidate)) {
          note('cycle:' + name, '策略组循环引用已移除：' + name);
          continue;
        }
        compileGroup(candidate);
        if (group.type !== 'select') {
          note('nested:' + name, '非手选组中的嵌套策略已展开：' + name);
          members.push(...(edges.get(candidate) ?? []).filter(entry => !groups.has(entry)));
          continue;
        }
      }
      if (builtins[candidate] || nodes.has(candidate) || groups.has(candidate)) members.push(target(candidate));
      else note('member:' + name, '策略组中不可用的节点引用已移除：' + name);
    }
    const unique = [...new Set(members)];
    const empty = unique.length === 0;
    if (empty) {
      unique.push('reject');
      note('empty:' + name, '策略组没有兼容节点，暂时拒绝连接：' + name);
    }
    edges.set(name, unique);
    let type = 'static';
    if (!empty && group.type === 'url-test') type = 'url-latency-benchmark';
    else if (!empty && group.type === 'fallback') {
      type = 'available';
      note('fallback', 'fallback 已映射为 available，可用性检测机制由 Quantumult X 决定');
    } else if (!empty && group.type === 'load-balance') {
      type = group.strategy === 'round-robin' ? 'round-robin' : 'dest-hash';
      note('load-balance', '负载均衡已近似映射，哈希与会话保持机制可能不同');
    } else if (!empty && group.type !== 'select' && group.type !== 'url-test') {
      unique.splice(0, unique.length, 'reject');
      note('group-type:' + group.type, '不支持策略组类型 ' + group.type + '，暂时拒绝连接');
    }
    // A single candidate needs no benchmark; QX tag regexes do not include server_local nodes.
    if (type === 'url-latency-benchmark' && unique.length === 1) {
      type = 'static';
      note('single-candidate', '仅有一个候选节点的测速组已改为固定选择');
    }
    const options: string[] = [];
    if (type === 'url-latency-benchmark') {
      if (Number(group.interval) > 0) options.push('check-interval=' + Math.floor(Number(group.interval)));
      if (Number(group.tolerance) >= 0) options.push('tolerance=' + Number(group.tolerance));
      options.push('alive-checking=' + (group.lazy === false));
    }
    if (group.icon && !/[,\r\n]/.test(group.icon)) options.push('img-url=' + (sources.iconUrls?.get(group.icon) ?? group.icon));
    compiledPolicies.set(name, type + '=' + name + ', ' + [...unique, ...options].join(', '));
    visits.delete(name);
    completed.add(name);
  };
  for (const name of groups.keys()) compileGroup(name);
  // Resolve dependencies recursively, but display policies in the source YAML order.
  const policyLines = Array.from(groups.keys(), name => compiledPolicies.get(name)!);

  const ruleConversion = convertClashRules(doc, sources, target);
  skippedRules = ruleConversion.skippedRules;
  for (const issue of ruleConversion.issues) note(issue.code, issue.message, issue.count);

  const dnsLines: string[] = [];
  const doh: string[] = [];
  const doq: string[] = [];
  for (const server of Array.isArray(doc.dns?.nameserver) ? doc.dns.nameserver : []) {
    if (typeof server !== 'string' || /[,\r\n#]/.test(server)) note('dns-server', '部分 DNS 服务器参数无法转换');
    else if (server.startsWith('https://')) doh.push(server);
    else if (server.startsWith('quic://')) doq.push(server);
    else if (/^[\da-fA-F.:[\]]+(?::\d+)?$/.test(server)) dnsLines.push('server=' + server);
    else if (server !== 'system') note('dns-server', '部分 DNS 服务器类型无法转换');
  }
  if (doh.length) dnsLines.push('doh-server=' + doh.join(', '));
  if (doq.length) dnsLines.push('doq-server=' + doq.join(', '));
  if (doc.dns?.ipv6 === false) dnsLines.push('no-ipv6');
  if (Object.keys(doc.dns ?? {}).some(key => !['enable', 'nameserver', 'ipv6'].includes(key))) {
    note('dns-options', 'DNS 分流、fake-ip 等客户端专属选项使用 Quantumult X 默认机制');
  }
  note('rule-priority', '规则集按 Clash 分类与引用顺序输出，实际匹配优先级和测速行为由 Quantumult X 决定');
  let testUrl = 'http://www.gstatic.com/generate_204';
  const clashTestUrl = Array.from(groups.values()).find(group => typeof group.url === 'string')?.url;
  if (clashTestUrl) {
    try {
      const url = new URL(value(clashTestUrl));
      // Quantumult X rejects HTTPS server_check_url values when loading the profile.
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error('Unsupported server check URL');
      testUrl = url.href;
    } catch {
      note('server-check-url', 'Clash 测速地址不适用于 Quantumult X，已使用默认 HTTP 测速地址');
    }
  }
  const warnings = Array.from(issues.values());
  const header = ['# 由 Clash 配置自动生成，请在 Clash 页面维护。'];
  for (const issue of warnings) header.push('# ' + issue.message.replace(/[\r\n]/g, ' ') + ' (' + issue.count + ')');
  const content = [
    ...header, '', '[general]', 'server_check_url=' + value(testUrl), '',
    '[dns]', ...dnsLines, '', '[policy]', ...policyLines, '',
    '[server_remote]', '', '[server_local]', ...Array.from(nodes.values(), node => node.line), '',
    '[filter_remote]', ...ruleConversion.remoteRules, '', '[filter_local]', ...ruleConversion.localRules, '',
    '[rewrite_remote]', '', '[rewrite_local]', '', '[task_local]', '', '[http_backend]', '', '[mitm]', '',
  ].join('\n');
  return {
    content,
    ruleResources: ruleConversion.resources,
    stats: { nodes: nodes.size, groups: policyLines.length, rules: ruleConversion.totalRules, skippedNodes, skippedRules },
    issues: warnings,
  };
}
