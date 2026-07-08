import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClashService, buildClashSubscribe } from './service.js';
import { parseClashYaml, extractGroupNames } from './parser.js';
import { emptyManifest } from './schema.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

const sampleYaml = `proxies:
  - {name: A, type: ss}
  - {name: B, type: ss}
proxy-groups:
  - {name: 香港节点, type: select, proxies: [A, B], icon: 'https://example.com/icons/hk.png'}
  - {name: 国外网站, type: select, proxies: [香港节点]}
rule-providers:
  Direct: {type: http, behavior: classical, format: text, url: 'https://example.com/lists/direct.list', interval: 86400}
proxy-providers:
  Sub: {type: http, url: 'https://example.com/sub.yaml', interval: 86400}
rules:
  - DOMAIN-SUFFIX,example.com,DIRECT
`;

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-svc-'));
  const paths = createPaths(tmp);
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: {} as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

describe('clash parser', () => {
  it('extracts list URLs from rule-providers but not proxy-providers', () => {
    const parsed = parseClashYaml(sampleYaml);
    expect(parsed.list).toContain('https://example.com/lists/direct.list');
    expect(parsed.list).not.toContain('https://example.com/sub.yaml');
  });

  it('extracts icon URLs from proxy-groups', () => {
    const parsed = parseClashYaml(sampleYaml);
    expect(parsed.icon).toEqual(['https://example.com/icons/hk.png']);
  });

  it('extractGroupNames returns proxy-groups names in order', () => {
    expect(extractGroupNames(sampleYaml)).toEqual(['香港节点', '国外网站']);
  });
});

describe('clash service', () => {
  it('loadConfig returns defaults when file missing', async () => {
    const { deps } = makeDeps();
    const svc = new ClashService(deps);
    const cfg = await svc.loadConfig();
    expect(cfg).toEqual({ custom_proxies: [], custom_rules: [] });
  });

  it('saveConfig + loadConfig roundtrip stores in data dir', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new ClashService(deps);
    await svc.saveConfig({
      api_key: 'k',
      custom_proxies: [{ name: 'X', type: 'ss' } as any],
      custom_rules: [],
    });
    const back = await svc.loadConfig();
    expect(back.api_key).toBe('k');
    expect(back.custom_proxies).toHaveLength(1);
    expect(fs.existsSync(path.join(tmp, 'data', 'clash', 'config.json'))).toBe(true);
  });

  it('saveTemplate + loadTemplate roundtrip', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new ClashService(deps);
    await svc.saveTemplate(sampleYaml);
    expect(fs.existsSync(path.join(tmp, 'conf', 'clash', 'template.yaml'))).toBe(true);
    const back = await svc.loadTemplate();
    expect(back).toBe(sampleYaml);
  });

  it('syncManifest registers remote URLs and custom rule files', async () => {
    const { deps } = makeDeps();
    const svc = new ClashService(deps);
    await svc.saveTemplate(sampleYaml);
    await svc.saveConfig({
      custom_proxies: [],
      custom_rules: [
        { id: 'abc', name: 'MyRules', target_group: '香港节点', behavior: 'classical', rules: ['DOMAIN,foo.com'], enabled: true },
      ],
    });
    const manifest = await svc.syncManifest();
    expect(manifest.list.find((e) => e.url === 'https://example.com/lists/direct.list')).toBeTruthy();
    expect(manifest.list.find((e) => e.url === 'https://example.com/sub.yaml')).toBeUndefined();
    expect(manifest.icon.find((e) => e.url === 'https://example.com/icons/hk.png')).toBeTruthy();
    expect(manifest.list.find((e) => e.filename === 'custom-abc.list' && e.source === 'local')).toBeTruthy();
  });

  it('writeCustomRuleFiles writes .list files and cleans up stale', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new ClashService(deps);
    await svc.writeCustomRuleFiles({
      custom_proxies: [],
      custom_rules: [
        { id: 'r1', name: 'A', target_group: 'X', behavior: 'classical', rules: ['DOMAIN,x.com'], enabled: true },
      ],
    });
    const dir = path.join(tmp, 'data', 'clash', 'resources', 'list');
    expect(fs.existsSync(path.join(dir, 'custom-r1.list'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'custom-r1.list'), 'utf-8')).toContain('DOMAIN,x.com');

    await svc.writeCustomRuleFiles({ custom_proxies: [], custom_rules: [] });
    expect(fs.existsSync(path.join(dir, 'custom-r1.list'))).toBe(false);
  });

  it('writeCustomRuleFiles filters out comments and empty lines', async () => {
    const { deps, tmp } = makeDeps();
    const svc = new ClashService(deps);
    await svc.writeCustomRuleFiles({
      custom_proxies: [],
      custom_rules: [
        {
          id: 'r2',
          name: 'B',
          target_group: 'Y',
          behavior: 'classical',
          rules: ['# comment', 'DOMAIN,valid.com', '', '// another comment', 'DOMAIN-SUFFIX,test.com'],
          enabled: true,
        },
      ],
    });
    const dir = path.join(tmp, 'data', 'clash', 'resources', 'list');
    const content = fs.readFileSync(path.join(dir, 'custom-r2.list'), 'utf-8');
    expect(content).toContain('DOMAIN,valid.com');
    expect(content).toContain('DOMAIN-SUFFIX,test.com');
    expect(content).not.toContain('# comment');
    expect(content).not.toContain('// another comment');
  });
});

describe('buildClashSubscribe', () => {
  it('prepends custom proxies and rules; rewrites remote URLs to local static paths', () => {
    const manifest = emptyManifest();
    manifest.list.push({
      url: 'https://example.com/lists/direct.list',
      filename: 'direct.list',
      source: 'remote',
    });
    manifest.icon.push({
      url: 'https://example.com/icons/hk.png',
      filename: 'hk.png',
      source: 'remote',
    });
    const out = buildClashSubscribe(
      sampleYaml,
      {
        custom_proxies: [{ name: '日本自建节点', type: 'vmess' } as any],
        custom_rules: [
          { id: 'abc', name: 'MyRules', target_group: '香港节点', behavior: 'classical', rules: [], enabled: true },
        ],
      },
      manifest,
      'http://my.host:3333',
    );
    expect(out).toContain('日本自建节点');
    // Custom RULE-SET is prepended before the upstream MATCH/SUFFIX rule
    const ruleSetIdx = out.indexOf('RULE-SET,MyRules,香港节点');
    const upstreamRuleIdx = out.indexOf('DOMAIN-SUFFIX,example.com');
    expect(ruleSetIdx).toBeGreaterThan(-1);
    expect(ruleSetIdx).toBeLessThan(upstreamRuleIdx);
    // Custom rule-provider added pointing to local static URL
    expect(out).toContain('http://my.host:3333/api/clash/static/list/custom-abc.list');
    // Remote URLs rewritten
    expect(out).toContain('http://my.host:3333/api/clash/static/list/direct.list');
    expect(out).toContain('http://my.host:3333/api/clash/static/icon/hk.png');
    expect(out).not.toContain('https://example.com/lists/direct.list');
  });

  it('omits custom rule injection when none enabled', () => {
    const out = buildClashSubscribe(
      sampleYaml,
      { custom_proxies: [], custom_rules: [] },
      emptyManifest(),
      'http://x',
    );
    expect(out).not.toContain('RULE-SET,MyRules');
  });
});
