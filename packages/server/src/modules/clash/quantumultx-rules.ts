import { createHash } from 'node:crypto';
import type { ClashDocument, ConversionIssue, QxSources } from './quantumultx-converter.js';

export interface QxRuleResourceSpec {
  id: string;
  name: string;
  target: string;
  interval: number;
  providerName?: string;
  inlineRules?: string[];
}

export interface QxRuleResource {
  id: string;
  name: string;
  content: string;
  rules: number;
}

const builtins: Record<string, string> = { DIRECT: 'direct', REJECT: 'reject', 'REJECT-DROP': 'reject' };
const mapping: Record<string, string> = {
  DOMAIN: 'host', 'DOMAIN-SUFFIX': 'host-suffix', 'DOMAIN-KEYWORD': 'host-keyword',
  'DOMAIN-WILDCARD': 'host-wildcard', 'IP-CIDR': 'ip-cidr', 'IP-CIDR6': 'ip6-cidr',
  GEOIP: 'geoip', 'IP-ASN': 'ip-asn',
};

/** Inserted remote resources precede filter_local, so only the trailing local run stays local. */
export function qxRuleLayout(doc: ClashDocument): { resources: QxRuleResourceSpec[]; localRules: string[] } {
  const rules = (Array.isArray(doc.rules) ? doc.rules : []).filter((rule): rule is string => typeof rule === 'string');
  const finalIndex = rules.findIndex(rule => rule.trim().split(',')[0] === 'MATCH');
  const reachable = finalIndex < 0 ? rules : rules.slice(0, finalIndex + 1);
  let lastResource = -1;
  reachable.forEach((rule, index) => { if (rule.trim().startsWith('RULE-SET,')) lastResource = index; });
  const resources: QxRuleResourceSpec[] = [];
  const occurrences = new Map<string, number>();
  const tags = new Set<string>();
  let inlineRules: string[] = [];
  let inlineTarget = '';
  let inlineIndex = 0;
  const append = (spec: Omit<QxRuleResourceSpec, 'id' | 'name'>, label: string, key: string) => {
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const id = createHash('sha256').update(JSON.stringify([key, spec.target, occurrence])).digest('hex').slice(0, 24);
    const baseName = label.replace(/[,\r\n]/g, ' ').trim() || '未命名规则集';
    let name = baseName;
    for (let suffix = 2; tags.has(name); suffix++) name = baseName + ' (' + suffix + ')';
    tags.add(name);
    resources.push({ ...spec, id, name });
  };
  const flushInline = () => {
    if (!inlineRules.length) return;
    inlineIndex++;
    append({ target: inlineTarget, interval: 86400, inlineRules }, 'YAML 规则 ' + inlineIndex, 'inline:' + inlineIndex);
    inlineRules = [];
  };
  for (const rule of reachable.slice(0, lastResource + 1)) {
    const text = rule.trim();
    if (!text || /^(#|;|\/\/)/.test(text)) continue;
    const parts = text.split(',').map(part => part.trim());
    if (parts[0] === 'RULE-SET') {
      flushInline();
      const providerName = parts[1] ?? '';
      const interval = Number(doc['rule-providers']?.[providerName]?.interval);
      append({
        providerName, target: parts[2] || 'REJECT',
        interval: interval > 0 ? Math.floor(interval) : 86400,
      }, providerName, 'provider:' + providerName);
    } else {
      const policy = parts[2] || 'REJECT';
      if (inlineRules.length && inlineTarget !== policy) flushInline();
      inlineTarget = policy;
      inlineRules.push(text);
    }
  }
  flushInline();
  return { resources, localRules: reachable.slice(lastResource + 1) };
}

function ruleWriter(doc: ClashDocument, sources: Pick<QxSources, 'rules'>, resolveTarget: (name: string) => string) {
  const issues = new Map<string, ConversionIssue>();
  let skippedRules = 0;
  const note = (code: string, message: string) => {
    const previous = issues.get(code);
    issues.set(code, { code, message, count: (previous?.count ?? 0) + 1 });
  };
  const reject = (type: string) => {
    skippedRules++;
    note('rule:' + type, '未转换规则类型或附加条件：' + type);
  };
  const target = (name: string) => {
    const resolved = resolveTarget(name);
    return resolved && !/[,\r\n]/.test(resolved) ? resolved : 'reject';
  };
  const write = (raw: string, output: string[], forcedTarget?: string, behavior = 'classical', stack: string[] = []): void => {
    const text = raw.trim();
    if (!text || /^(#|;|\/\/)/.test(text)) return;
    if (/[\r\n]/.test(text) || ((behavior === 'domain' || behavior === 'ipcidr') && /[,\s]/.test(text))) {
      skippedRules++;
      note('invalid-resource-rule', '跳过格式无效的规则条目');
      return;
    }
    if (behavior === 'domain') {
      const suffix = text.startsWith('+.') || text.startsWith('.');
      output.push((suffix ? 'host-suffix' : /[*?]/.test(text) ? 'host-wildcard' : 'host') + ', '
        + text.replace(/^\+?\./, '') + ', ' + target(forcedTarget ?? 'REJECT'));
      return;
    }
    if (behavior === 'ipcidr') {
      output.push((text.includes(':') ? 'ip6-cidr' : 'ip-cidr') + ', ' + text + ', ' + target(forcedTarget ?? 'REJECT'));
      return;
    }
    const parts = text.split(',').map(part => part.trim());
    const type = parts[0] ?? '';
    if (type === 'RULE-SET') {
      const name = parts[1] ?? '';
      const provider = doc['rule-providers']?.[name];
      if (!provider || !sources.rules[name] || stack.includes(name)) {
        skippedRules++;
        note('rule-set:' + name, '规则集合未展开：' + name);
        return;
      }
      for (const line of sources.rules[name]!) {
        write(line, output, forcedTarget ?? parts[2] ?? 'REJECT', provider.behavior ?? 'classical', [...stack, name]);
      }
      return;
    }
    if (!mapping[type] || parts.includes('src') || !parts[1]) {
      reject(type);
      return;
    }
    if (parts.includes('no-resolve')) note('no-resolve', 'no-resolve 使用 Quantumult X 自身的 DNS 与规则匹配机制');
    const ruleValue = type === 'GEOIP' ? parts[1]!.toLowerCase() : parts[1]!;
    const qxType = type === 'IP-CIDR' && ruleValue.includes(':') ? 'ip6-cidr' : mapping[type];
    output.push(qxType + ', ' + ruleValue + ', ' + target(forcedTarget ?? parts[2] ?? 'REJECT'));
  };
  return {
    write, target, note,
    missingProvider(name: string) {
      skippedRules++;
      note('rule-set:' + name, '规则集合未展开：' + name);
    },
    result: () => ({ skippedRules, issues: Array.from(issues.values()) }),
  };
}

export function convertQxRuleResource(spec: QxRuleResourceSpec, doc: ClashDocument, sources: Pick<QxSources, 'rules'>) {
  const writer = ruleWriter(doc, sources, name => builtins[name] ?? name);
  const lines: string[] = [];
  let available = true;
  if (spec.providerName !== undefined) {
    const provider = doc['rule-providers']?.[spec.providerName];
    const entries = sources.rules[spec.providerName];
    if (!provider || !entries) {
      available = false;
      writer.missingProvider(spec.providerName);
    } else {
      for (const line of entries) writer.write(line, lines, 'DIRECT', provider.behavior ?? 'classical', [spec.providerName]);
    }
  } else {
    for (const line of spec.inlineRules ?? []) writer.write(line, lines, 'DIRECT');
  }
  return {
    id: spec.id, name: spec.name, available, rules: lines.length,
    content: ['# Clash 规则集：' + spec.name, ...lines, ''].join('\n'),
    ...writer.result(),
  };
}

export function convertClashRules(
  doc: ClashDocument, sources: QxSources,
  resolveTarget: (name: string) => string,
) {
  const layout = qxRuleLayout(doc);
  const writer = ruleWriter(doc, sources, resolveTarget);
  const resources: QxRuleResource[] = [];
  const remoteRules: string[] = [];
  const localRules: string[] = [];
  let remoteCount = 0;
  let skippedRules = 0;
  const issues: ConversionIssue[] = [];
  for (const spec of layout.resources) {
    const converted = convertQxRuleResource(spec, doc, sources);
    skippedRules += converted.skippedRules;
    issues.push(...converted.issues);
    if (!converted.available) continue;
    resources.push({ id: spec.id, name: spec.name, content: converted.content, rules: converted.rules });
    remoteCount += converted.rules;
    const url = sources.ruleResourceUrl?.(spec.id) ?? '/api/qx/static/rules/' + spec.id;
    remoteRules.push(url + ', tag=' + spec.name + ', force-policy=' + writer.target(spec.target)
      + ', update-interval=' + spec.interval + ', opt-parser=false, inserted-resource=true, enabled=true');
  }
  let finalPolicy: string | undefined;
  for (const rule of layout.localRules) {
    const parts = rule.trim().split(',').map(part => part.trim());
    if (parts[0] === 'MATCH') {
      finalPolicy = writer.target(parts[1] || 'REJECT');
      break;
    }
    writer.write(rule, localRules);
  }
  if (!finalPolicy) {
    finalPolicy = 'reject';
    writer.note('missing-final', 'Clash 未配置 MATCH，未匹配的流量将被拒绝');
  }
  localRules.push('final, ' + finalPolicy);
  const localResult = writer.result();
  return {
    localRules, remoteRules, resources, totalRules: localRules.length + remoteCount,
    skippedRules: skippedRules + localResult.skippedRules, issues: [...issues, ...localResult.issues],
  };
}
