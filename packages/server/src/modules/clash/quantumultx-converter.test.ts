import { describe, expect, it } from 'vitest';
import { convertClashToQuantumultX, parseProviderNodes, parseProviderRules } from './quantumultx-converter.js';

const ss = (name: string, extra = {}) => ({ name, type: 'ss', server: 'example.com', port: 443, cipher: 'aes-128-gcm', password: 'test', ...extra });
const source = { nodes: {}, rules: {} };

describe('Clash to Quantumult X', () => {
  it('maps VLESS Reality Vision and VMess WebSocket TLS with the required empty QX sections', () => {
    const result = convertClashToQuantumultX({
      proxies: [
        { name: 'Vision', type: 'vless', server: 'example.com', port: 443, uuid: 'test-uuid', tls: true, flow: 'xtls-rprx-vision', servername: 'sni.example', 'reality-opts': { 'public-key': 'public-key', 'short-id': 'abcd' }, udp: true },
        { name: 'WS', type: 'vmess', server: 'example.com', port: 8443, uuid: 'ws-uuid', tls: true, cipher: 'auto', network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'ws.example' } } },
      ],
      'proxy-groups': [{ name: 'Proxy', type: 'select', 'include-all': true }],
      rules: ['DOMAIN,example.com,Proxy', 'MATCH,Proxy'],
    }, source);
    expect(result.content).toContain('vless-flow=xtls-rprx-vision');
    expect(result.content).toContain('reality-base64-pubkey=public-key');
    expect(result.content).toContain('reality-hex-shortid=abcd');
    expect(result.content).toContain('obfs=wss, obfs-host=ws.example, obfs-uri=/ws');
    expect(result.content).toContain('static=Proxy, Vision, WS');
    expect(result.stats).toMatchObject({ nodes: 2, groups: 1, rules: 2, skippedNodes: 0 });
    for (const section of ['server_remote', 'filter_remote', 'mitm', 'rewrite_remote', 'rewrite_local', 'task_local', 'http_backend']) {
      expect(result.content).toContain('[' + section + ']\n');
      expect(result.content.split('[' + section + ']\n')[1]!.split('\n[')[0]!.trim()).toBe('');
    }
  });

  it('keeps rule sets as ordered resources with their forced policies', () => {
    const result = convertClashToQuantumultX({
      'rule-providers': { C: { behavior: 'classical' }, D: { behavior: 'domain' }, I: { behavior: 'ipcidr' } },
      rules: ['RULE-SET,C,DIRECT', 'RULE-SET,D,REJECT', 'RULE-SET,I,DIRECT', 'MATCH,REJECT'],
    }, {
      nodes: {},
      rules: {
        C: ['# ignored', 'DOMAIN,one.example', 'DOMAIN-KEYWORD,news', 'IP-ASN,123', 'PROCESS-NAME,app', 'DST-PORT,443'],
        D: ['+.example.com', '*.other.example', 'exact.example'],
        I: ['10.0.0.0/8', '2001:db8::/32'],
      },
    });
    const rules = result.content.split('[filter_local]\n')[1]!.split('\n[')[0]!.trim().split('\n');
    expect(rules).toEqual(['final, reject']);
    expect(result.ruleResources.map(resource => resource.name)).toEqual(['C', 'D', 'I']);
    expect(result.ruleResources.map(resource => resource.rules)).toEqual([3, 3, 2]);
    expect(result.ruleResources[0]!.content).toContain('host, one.example, direct');
    expect(result.ruleResources[1]!.content).toContain('host-suffix, example.com, direct');
    expect(result.ruleResources[1]!.content).toContain('host-wildcard, *.other.example, direct');
    expect(result.ruleResources[2]!.content).toContain('ip6-cidr, 2001:db8::/32, direct');
    const references = result.content.split('[filter_remote]\n')[1]!.split('\n[')[0]!.trim().split('\n');
    expect(references.map(line => line.match(/tag=([^,]+)/)![1])).toEqual(['C', 'D', 'I']);
    expect(references[1]).toContain('force-policy=reject');
    expect(references.every(line => line.includes('inserted-resource=true'))).toBe(true);
    expect(result.stats.rules).toBe(9);
    expect(result.stats.skippedRules).toBe(2);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'rule:PROCESS-NAME', count: 1 }),
      expect.objectContaining({ code: 'rule:DST-PORT', count: 1 }),
    ]));
  });

  it('expands providers, filters region members and preserves nested policies', () => {
    const result = convertClashToQuantumultX({
      proxies: [ss('Local')],
      'proxy-groups': [
        { name: 'Proxy', type: 'select', proxies: ['HK', 'DIRECT'] },
        { name: 'HK', type: 'url-test', 'include-all': true, filter: '(?i)hk', interval: 300, tolerance: 50, lazy: false },
        { name: 'OnlyProvider', type: 'select', use: ['Airport'], filter: 'US' },
      ],
      rules: ['MATCH,Proxy'],
    }, { nodes: { Airport: [ss('hk-1'), ss('US-1')] }, rules: {} });
    expect(result.content).toContain('static=HK, hk-1\n');
    expect(result.content).toContain('static=Proxy, HK, direct');
    expect(result.content).toContain('static=OnlyProvider, US-1');
    const policyNames = result.content.split('[policy]\n')[1]!.split('\n[')[0]!.trim().split('\n')
      .map(line => line.slice(line.indexOf('=') + 1).split(',')[0]);
    expect(policyNames).toEqual(['Proxy', 'HK', 'OnlyProvider']);
  });

  it('preserves interleaved local runs, repeated providers and their individual policies', () => {
    const doc = {
      'rule-providers': { C: { behavior: 'classical', interval: 600 } },
      rules: [
        'DOMAIN,before.example,DIRECT', 'RULE-SET,C,REJECT',
        'DOMAIN,middle.example,DIRECT', 'DOMAIN,other.example,REJECT',
        'RULE-SET,C,DIRECT', 'GEOIP,CN,DIRECT', 'MATCH,REJECT',
        'RULE-SET,C,DIRECT',
      ],
    };
    const result = convertClashToQuantumultX(doc, { nodes: {}, rules: { C: ['DOMAIN,remote.example'] } });
    expect(result.ruleResources.map(resource => resource.name)).toEqual(['YAML 规则 1', 'C', 'YAML 规则 2', 'YAML 规则 3', 'C (2)']);
    expect(new Set(result.ruleResources.map(resource => resource.id)).size).toBe(5);
    const remote = result.content.split('[filter_remote]\n')[1]!.split('\n[')[0]!.trim().split('\n');
    expect(remote.map(line => line.match(/force-policy=([^,]+)/)![1])).toEqual(['direct', 'reject', 'direct', 'reject', 'direct']);
    expect(remote[1]).toContain('update-interval=600');
    const local = result.content.split('[filter_local]\n')[1]!.split('\n[')[0]!.trim().split('\n');
    expect(local).toEqual(['geoip, cn, direct', 'final, reject']);
    expect(result.stats.rules).toBe(7);
    const updated = convertClashToQuantumultX(doc, { nodes: {}, rules: { C: ['DOMAIN,changed.example'] } });
    expect(updated.ruleResources.map(resource => resource.id)).toEqual(result.ruleResources.map(resource => resource.id));
  });

  it('keeps nested rule sets inside their parent resource and detects cycles', () => {
    const result = convertClashToQuantumultX({
      'rule-providers': { Parent: { behavior: 'classical' }, Child: { behavior: 'domain' } },
      rules: ['RULE-SET,Parent,REJECT', 'MATCH,DIRECT'],
    }, { nodes: {}, rules: { Parent: ['RULE-SET,Child,DIRECT', 'RULE-SET,Parent,DIRECT'], Child: ['+.child.example'] } });
    expect(result.ruleResources).toHaveLength(1);
    expect(result.ruleResources[0]!.content).toContain('host-suffix, child.example, direct');
    expect(result.stats).toMatchObject({ rules: 2, skippedRules: 1 });
    expect(result.content).toContain('force-policy=reject');
  });

  it('directly references a single local node without using a resource tag regex', () => {
    const name = 'Only [HK] (1).+';
    const result = convertClashToQuantumultX({
      proxies: [ss(name), ss('Other')],
      'proxy-groups': [{ name: 'Auto', type: 'url-test', proxies: [name], interval: 300 }],
      rules: ['MATCH,Auto'],
    }, source);
    expect(result.content).toContain('static=Auto, ' + name + '\n');
    expect(result.content).not.toContain('server-tag-regex=');
    expect(result.content).not.toContain('check-interval=');
    expect(result.content).toContain('tag=' + name + '\n');
    expect(result.stats).toMatchObject({ nodes: 2, groups: 1, skippedNodes: 0 });
  });

  it('keeps multiple benchmark candidates explicit and retains their test options', () => {
    const result = convertClashToQuantumultX({
      proxies: [ss('HK-1'), ss('HK-2')],
      'proxy-groups': [{ name: 'Auto', type: 'url-test', 'include-all': true, interval: 300, tolerance: 50, lazy: false }],
      rules: ['MATCH,Auto'],
    }, source);
    expect(result.content).toContain('url-latency-benchmark=Auto, HK-1, HK-2, check-interval=300, tolerance=50, alive-checking=true\n');
    expect(result.content).not.toContain('server-tag-regex=');
  });

  it('reports unsupported nodes and prevents missing references or accidental direct fallback', () => {
    const result = convertClashToQuantumultX({
      proxies: [ss('Chain', { 'dialer-proxy': 'Other' }), ss('HY', { type: 'hysteria2' }), ss('gRPC', { type: 'vless', network: 'grpc' })],
      'proxy-groups': [{ name: 'Unavailable', type: 'url-test', 'include-all': true }],
      rules: ['DOMAIN,x.example,HY', 'MATCH,Unavailable'],
    }, source);
    expect(result.stats.skippedNodes).toBe(3);
    expect(result.content).toContain('static=Unavailable, reject');
    expect(result.content).toContain('host, x.example, reject');
    expect(result.content).not.toContain('tag=HY');
    expect(result.issues.some(issue => issue.code.startsWith('empty:'))).toBe(true);
  });

  it('breaks group cycles and produces a reject final when MATCH is absent', () => {
    const result = convertClashToQuantumultX({
      'proxy-groups': [{ name: 'A', type: 'select', proxies: ['B'] }, { name: 'B', type: 'select', proxies: ['A'] }],
    }, source);
    expect(result.content).toContain('static=B, reject');
    expect(result.content).toContain('static=A, B');
    expect(result.content).toContain('final, reject');
    expect(result.issues.some(issue => issue.code.startsWith('cycle:'))).toBe(true);
  });

  it('does not put credential values into diagnostics', () => {
    const result = convertClashToQuantumultX({
      proxies: [ss('bad', { password: 'secret,with,commas' })],
      rules: ['MATCH,DIRECT'],
    }, source);
    expect(result.stats.skippedNodes).toBe(1);
    expect(JSON.stringify(result.issues)).not.toContain('secret');
    expect(result.content).not.toContain('secret');
  });

  it('combines DoH servers on one line and maps IPv6 DNS settings', () => {
    const result = convertClashToQuantumultX({
      dns: { nameserver: ['223.5.5.5', 'https://dns.example/a', 'https://dns.example/b'], ipv6: false },
      rules: ['IP-CIDR6,::1/128,DIRECT,no-resolve', 'GEOIP,CN,DIRECT', 'MATCH,REJECT'],
    }, source);
    expect(result.content).toContain('server=223.5.5.5');
    expect(result.content).toContain('doh-server=https://dns.example/a, https://dns.example/b');
    expect(result.content).toContain('no-ipv6');
    expect(result.content).toContain('geoip, cn, direct');
  });

  it('keeps valid HTTP server check URLs accepted by Quantumult X', () => {
    const result = convertClashToQuantumultX({
      'proxy-groups': [{ name: 'Auto', type: 'url-test', proxies: ['DIRECT'], url: 'http://example.com/check?status=204' }],
      rules: ['MATCH,DIRECT'],
    }, source);
    expect(result.content).toContain('server_check_url=http://example.com/check?status=204\n');
    expect(result.issues.some(issue => issue.code === 'server-check-url')).toBe(false);
  });

  it.each(['https://www.gstatic.com/generate_204', 'ftp://example.com/check', 'invalid', 'http://example.com/check\n[mitm]'])(
    'uses an HTTP fallback for incompatible server check URL %s', url => {
      const result = convertClashToQuantumultX({
        'proxy-groups': [{ name: 'Auto', type: 'url-test', proxies: ['DIRECT'], url }],
        rules: ['MATCH,DIRECT'],
      }, source);
      expect(result.content).toContain('server_check_url=http://www.gstatic.com/generate_204\n');
      expect(result.content.split('[mitm]')).toHaveLength(2);
      expect(result.content.split('[mitm]\n')[1]!.trim()).toBe('');
      expect(result.issues.some(issue => issue.code === 'server-check-url')).toBe(true);
    },
  );

  it('uses an HTTP server check URL when Clash does not specify one', () => {
    const result = convertClashToQuantumultX({ rules: ['MATCH,DIRECT'] }, source);
    expect(result.content).toContain('server_check_url=http://www.gstatic.com/generate_204\n');
  });

  it('parses Clash provider payloads and rejects unknown binary formats', () => {
    expect(parseProviderNodes('proxies:\n  - { name: Test, type: ss }\n')).toHaveLength(1);
    expect(() => parseProviderNodes('<html>not a subscription</html>')).toThrow();
    expect(parseProviderRules('payload:\n  - DOMAIN,example.com\n', 'yaml')).toEqual(['DOMAIN,example.com']);
    expect(parseProviderRules('# comment\nDOMAIN,example.com\n')).toEqual(['DOMAIN,example.com']);
    expect(() => parseProviderRules('binary', 'mrs')).toThrow(/MRS/);
  });

  it('does not activate unreachable rules after MATCH', () => {
    const result = convertClashToQuantumultX({
      rules: ['MATCH,DIRECT', 'DOMAIN,unreachable.example,REJECT'],
    }, source);
    expect(result.content).not.toContain('host, unreachable.example');
    expect(result.stats.rules).toBe(1);
    expect(result.content).toContain('final, direct');
  });

  it('rejects injected sections in domain resources', () => {
    const result = convertClashToQuantumultX({
      'rule-providers': { D: { behavior: 'domain' } },
      rules: ['RULE-SET,D,DIRECT', 'MATCH,REJECT'],
    }, { nodes: {}, rules: { D: ['safe.example', 'evil.example\n[mitm]'] } });
    expect(result.content.split('[mitm]')).toHaveLength(2);
    expect(result.content.split('[mitm]\n')[1]!.trim()).toBe('');
    expect(result.ruleResources[0]!.content).toContain('host, safe.example, direct');
    expect(result.ruleResources[0]!.content).not.toContain('[mitm]');
    expect(result.stats.skippedRules).toBe(1);
  });
});
