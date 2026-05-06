import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClashService, mergeClashConfig, parseUpstreamInfo } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

const sampleYaml = `proxies:
  - name: A
    type: ss
  - name: B
    type: ss
proxy-groups:
  - name: G1
    type: select
    proxies: [A, B]
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

describe('clash service', () => {
  it('parseUpstreamInfo extracts proxies and groups', () => {
    const info = parseUpstreamInfo(sampleYaml);
    expect(info.proxies).toEqual(['A', 'B']);
    expect(info.groups).toEqual(['G1']);
  });

  it('mergeClashConfig prepends custom rules and appends groups', () => {
    const merged = mergeClashConfig(sampleYaml, {
      subscribe_url: '',
      custom_proxies: [],
      groups: [{ name: 'My', type: 'select', proxies: ['A'] }],
      rule_sets: [{ name: 'r1', group: 'My', rules: ['DOMAIN,abc.com'] }],
    });
    expect(merged).toContain('DOMAIN,abc.com,My');
    expect(merged.indexOf('DOMAIN,abc.com,My')).toBeLessThan(merged.indexOf('DOMAIN-SUFFIX,example.com'));
    expect(merged).toContain('name: My');
  });

  it('loadConfig returns defaults when file missing', async () => {
    const { deps } = makeDeps();
    const svc = new ClashService(deps);
    const cfg = await svc.loadConfig();
    expect(cfg).toEqual({ subscribe_url: '', refresh_interval_minutes: 60, custom_proxies: [], groups: [], rule_sets: [] });
  });

  it('saveConfig + loadConfig roundtrip', async () => {
    const { deps } = makeDeps();
    const svc = new ClashService(deps);
    await svc.saveConfig({
      subscribe_url: 'https://example.com/sub',
      custom_proxies: [],
      groups: [{ name: 'g', type: 'select', proxies: ['A'] }],
      rule_sets: [],
    });
    const back = await svc.loadConfig();
    expect(back.subscribe_url).toBe('https://example.com/sub');
    expect(back.groups).toHaveLength(1);
  });

  it('mergeClashConfig prepends custom proxies and includes them in keyword matching', () => {
    const merged = mergeClashConfig(sampleYaml, {
      subscribe_url: '',
      custom_proxies: [
        {
          name: '日本自建节点',
          type: 'vmess',
          server: 'proxy.example.com',
          port: 443,
          uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          alterId: 0,
          cipher: 'auto',
          tls: true,
          'skip-cert-verify': true,
          network: 'ws',
          'ws-opts': {
            path: '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            headers: { Host: 'proxy.example.com' },
          },
          udp: true,
          tfo: false,
        },
      ],
      groups: [{ name: 'JP', type: 'url-test', proxies: [], keywords: ['日本'] }],
      rule_sets: [],
    });
    expect(merged).toContain('日本自建节点');
    expect(merged).toContain('proxy.example.com');
    expect(merged).toContain('alterId: 0');
    expect(merged).toContain('skip-cert-verify: true');
    expect(merged).toContain('name: JP');
    expect(merged).toContain('日本自建节点');
  });
});
