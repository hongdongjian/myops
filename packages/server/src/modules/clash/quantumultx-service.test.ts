import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import Fastify from 'fastify';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { clashModule } from './routes.js';
import { ClashService } from './service.js';
import { ClashQuantumultXService } from './quantumultx-service.js';

const node = (name: string) => ({ name, type: 'ss', server: 'example.com', port: 443, cipher: 'aes-128-gcm', password: 'node-password' });
const references = (profile: string) => profile.split('[filter_remote]\n')[1]!.split('\n[')[0]!.trim().split('\n')
  .filter(Boolean).map(line => ({ line, url: new URL(line.split(', ')[0]!) }));
const requestPath = (url: URL) => url.pathname + url.search;
beforeEach(() => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(key, '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function fixture() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'clash-qx-'));
  const paths = createPaths(tmp);
  const clash = new ClashService({ paths } as Deps);
  await clash.saveConfig({
    api_key: 'clash-secret',
    custom_proxies: [node('Local')],
    custom_rules: [{ id: 'mine', name: 'Mine', target_group: 'Proxy', behavior: 'classical', enabled: true, rules: ['DOMAIN,local.example'] }],
  });
  await clash.saveTemplate(YAML.stringify({
    'proxy-providers': { Airport: { type: 'http', url: 'https://airport.example/sub?token=private-token', interval: 60, header: { 'X-Test': ['one'] } } },
    'proxy-groups': [
      { name: 'Proxy', type: 'select', proxies: ['Region', 'DIRECT'] },
      { name: 'Region', type: 'url-test', 'include-all': true, filter: '(?i)hk', interval: 300 },
    ],
    'rule-providers': { Remote: { type: 'http', url: 'https://rules.example/list', format: 'text', behavior: 'classical' } },
    rules: ['RULE-SET,Remote,Proxy', 'MATCH,Proxy'],
  }));
  await clash.saveManifest({
    list: [{ url: 'https://rules.example/list', filename: 'remote.list', source: 'remote' }],
    icon: [],
  });
  await fsp.mkdir(clash.groupDir('list'), { recursive: true });
  await fsp.writeFile(path.join(clash.groupDir('list'), 'remote.list'), 'DOMAIN-SUFFIX,remote.example\nPROCESS-NAME,app\n');
  const app = Fastify();
  onTestFinished(async () => { await app.close(); await fsp.rm(tmp, { recursive: true, force: true }); });
  await app.register(errorHandlerPlugin);
  await app.register(clashModule, { deps: { paths } as Deps });
  return { tmp, paths, clash, app, converter: new ClashQuantumultXService(clash, paths) };
}

describe('Clash QX subscriptions', () => {
  it('shares the Clash key, keeps default YAML, and returns a report without credentials', async () => {
    const fetchStub = vi.fn(async () => new Response(YAML.stringify({ proxies: [node('HK-1'), node('US-1')] })));
    vi.stubGlobal('fetch', fetchStub);
    const { app, paths } = await fixture();
    await fsp.mkdir(paths.confPath('quantumultx'), { recursive: true });
    await fsp.writeFile(paths.confPath('quantumultx', 'QuantumultX.conf'), '[mitm]\nhostname=old.example\n');
    expect((await app.inject('/api/qx/subscribe')).statusCode).toBe(401);
    expect(fetchStub).not.toHaveBeenCalled();
    const qx = await app.inject('/api/qx/subscribe?api-key=clash-secret');
    expect(qx.statusCode).toBe(200);
    expect(qx.headers['content-type']).toContain('text/plain');
    expect(qx.body).not.toContain('host, local.example,');
    expect(qx.body).not.toContain('host-suffix, remote.example,');
    const resources = references(qx.body);
    expect(resources.map(resource => resource.line.match(/tag=([^,]+)/)![1])).toEqual(['Mine', 'Remote']);
    expect(resources.every(resource => resource.line.includes('force-policy=Proxy'))).toBe(true);
    expect(resources.every(resource => resource.url.searchParams.get('api-key') === 'clash-secret')).toBe(true);
    const mine = await app.inject(requestPath(resources[0]!.url));
    const remote = await app.inject(requestPath(resources[1]!.url));
    expect(mine.statusCode).toBe(200);
    expect(remote.statusCode).toBe(200);
    expect(remote.headers['content-type']).toContain('text/plain');
    expect(mine.body).toContain('host, local.example, direct');
    expect(remote.body).toContain('host-suffix, remote.example, direct');
    expect(remote.body).not.toContain('PROCESS-NAME');
    const noKey = new URL(resources[0]!.url);
    noKey.search = '';
    expect((await app.inject(requestPath(noKey))).statusCode).toBe(401);
    expect((await app.inject(noKey.pathname + '?api-key=wrong')).statusCode).toBe(401);
    expect((await app.inject('/api/qx/static/rules/' + '0'.repeat(24) + '?api-key=clash-secret')).statusCode).toBe(404);
    expect(qx.body).toContain('static=Region, HK-1\n');
    expect(qx.body.split('[mitm]\n')[1]!.trim()).toBe('');
    const alias = await app.inject('/api/clash/subscribe?format=quantumultx&api-key=clash-secret');
    expect(alias.body).toBe(qx.body);
    const yaml = await app.inject('/api/clash/subscribe?api-key=clash-secret');
    expect(yaml.headers['content-type']).toContain('text/yaml');
    expect(YAML.parse(yaml.body).proxies[0].name).toBe('Local');
    const policyNames = qx.body.split('[policy]\n')[1]!.split('\n[')[0]!.trim().split('\n')
      .map(line => line.slice(line.indexOf('=') + 1).split(',')[0]);
    expect(policyNames).toEqual(YAML.parse(yaml.body)['proxy-groups'].map((group: { name: string }) => group.name));
    const report = await app.inject('/api/clash/quantumultx/report');
    expect(report.json().data.stats).toMatchObject({ nodes: 3, groups: 2, rules: 3, skippedRules: 1 });
    expect(report.json().data).not.toHaveProperty('content');
    expect(report.json().data).not.toHaveProperty('ruleResources');
    expect(report.body).not.toContain('node-password');
    expect(report.body).not.toContain('private-token');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: { 'User-Agent': 'clash.meta', 'X-Test': 'one' },
    }));
    expect((await app.inject('/api/clash/subscribe?format=unknown')).statusCode).toBe(400);
    for (const url of ['/api/qx/conf', '/api/qx/resources', '/api/qx/config']) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
  });

  it('keeps rules on their own public origins and serves shared icons from both subscriptions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(YAML.stringify({ proxies: [node('HK-1')] }))));
    const { app, clash } = await fixture();
    const config = {
      ...await clash.loadConfig(),
      api_key: 'shared&key/#?%',
      clash_public_base_url: 'https://clash.example.com:20443/',
      qx_public_base_url: 'https://qx.example.com:20443/',
    };
    const query = '?api-key=' + encodeURIComponent(config.api_key);
    await clash.saveConfig(config);
    await clash.writeCustomRuleFiles(config);
    const template = YAML.parse(await clash.loadTemplate());
    template['proxy-groups'][0].icon = 'https://icons.example.com/YouTube.png';
    await clash.saveTemplate(YAML.stringify(template));
    const manifest = await clash.loadManifest();
    manifest.icon.push({ url: 'https://icons.example.com/YouTube.png', filename: 'You Tube.png', source: 'remote' });
    await clash.saveManifest(manifest);
    await fsp.mkdir(clash.groupDir('icon'), { recursive: true });
    const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5i8AAAAASUVORK5CYII=', 'base64');
    await fsp.writeFile(path.join(clash.groupDir('icon'), 'You Tube.png'), icon);

    const qx = await app.inject('/api/qx/subscribe' + query);
    expect(qx.statusCode).toBe(200);
    const resources = references(qx.body);
    expect(resources).toHaveLength(2);
    for (const { url } of resources) {
      expect(url.origin).toBe('https://qx.example.com:20443');
      expect(url.pathname).toMatch(/^\/api\/qx\/static\/rules\/[a-f0-9]{24}$/);
      expect(url.searchParams.get('api-key')).toBe(config.api_key);
      expect((await app.inject(requestPath(url))).statusCode).toBe(200);
    }
    expect(qx.body).toContain('img-url=https://qx.example.com:20443/api/static/icon/You%20Tube.png' + query);
    expect(qx.body).not.toContain('/api/clash/');
    expect(qx.body).not.toContain('/api/qx/rules/');

    const clashResponse = await app.inject('/api/clash/subscribe' + query);
    expect(clashResponse.statusCode).toBe(200);
    const doc = YAML.parse(clashResponse.body);
    expect(doc['proxy-groups'][0].icon).toBe('https://clash.example.com:20443/api/static/icon/You%20Tube.png' + query);
    const staticPaths = ['/api/static/icon/You%20Tube.png', '/api/clash/static/icon/You%20Tube.png'];
    for (const provider of Object.values(doc['rule-providers']) as { url: string }[]) {
      const url = new URL(provider.url);
      expect(url.origin).toBe('https://clash.example.com:20443');
      expect(url.pathname).toMatch(/^\/api\/clash\/static\/list\//);
      expect(url.searchParams.get('api-key')).toBe(config.api_key);
      expect((await app.inject(requestPath(url))).statusCode).toBe(200);
      staticPaths.push(url.pathname);
    }
    for (const staticPath of staticPaths) {
      expect((await app.inject(staticPath)).statusCode).toBe(401);
      expect((await app.inject(staticPath + '?api-key=wrong')).statusCode).toBe(401);
      expect((await app.inject(staticPath + query)).statusCode).toBe(200);
    }
    const image = await app.inject('/api/static/icon/You%20Tube.png' + query);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('private, max-age=300');
    expect(image.rawPayload).toEqual(icon);
    expect((await app.inject('/api/static/icon/missing.png' + query)).statusCode).toBe(404);
    expect((await app.inject('/api/static/list/remote.list')).statusCode).toBe(404);
    expect((await app.inject('/api/qx/rules/' + resources[0]!.url.pathname.split('/').pop() + '?api-key=clash-secret')).statusCode).toBe(404);
    const manualKey = 'manual&secret/?#';
    const manualQuery = '?api-key=' + encodeURIComponent(manualKey);
    const saved = await app.inject({
      method: 'PUT', url: '/api/clash/config',
      payload: { ...config, api_key: ' ' + manualKey + ' ' },
    });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject('/api/clash/config')).json().data).toEqual({ ...config, api_key: manualKey });
    for (const staticPath of staticPaths) {
      expect((await app.inject(staticPath + query)).statusCode).toBe(401);
      expect((await app.inject(staticPath + manualQuery)).statusCode).toBe(200);
    }
    expect((await app.inject('/api/qx/subscribe' + query)).statusCode).toBe(401);
    expect((await app.inject('/api/clash/subscribe' + query)).statusCode).toBe(401);
    const updatedQx = await app.inject('/api/qx/subscribe' + manualQuery);
    expect(updatedQx.statusCode).toBe(200);
    expect(references(updatedQx.body).every(resource => resource.url.searchParams.get('api-key') === manualKey)).toBe(true);
    const updatedClash = await app.inject('/api/clash/subscribe' + manualQuery);
    expect(updatedClash.statusCode).toBe(200);
    expect(new URL(YAML.parse(updatedClash.body)['proxy-groups'][0].icon).searchParams.get('api-key')).toBe(manualKey);
  });

  it('refreshes individual resources from current saved rules without fetching airport nodes', async () => {
    const fetchStub = vi.fn(async () => new Response(YAML.stringify({ proxies: [node('HK-1')] })));
    vi.stubGlobal('fetch', fetchStub);
    const { app, clash } = await fixture();
    const profile = await app.inject('/api/qx/subscribe?api-key=clash-secret');
    const resources = references(profile.body);
    fetchStub.mockClear();
    const config = await clash.loadConfig();
    config.custom_rules[0]!.rules.push('DOMAIN,new.example');
    await clash.saveConfig(config);
    await fsp.writeFile(path.join(clash.groupDir('list'), 'remote.list'), 'DOMAIN-SUFFIX,updated.example\n');
    const mine = await app.inject(requestPath(resources[0]!.url));
    const remote = await app.inject(requestPath(resources[1]!.url));
    expect(mine.body).toContain('host, new.example, direct');
    expect(remote.body).toContain('host-suffix, updated.example, direct');
    expect(fetchStub).not.toHaveBeenCalled();
    await clash.saveConfig({ ...config, custom_rules: [], api_key: 'rotated-secret' });
    expect((await app.inject(requestPath(resources[0]!.url))).statusCode).toBe(401);
    expect((await app.inject(requestPath(resources[1]!.url))).statusCode).toBe(401);
    const removed = new URL(resources[0]!.url);
    removed.searchParams.set('api-key', 'rotated-secret');
    expect((await app.inject(requestPath(removed))).statusCode).toBe(404);
    const current = new URL(resources[1]!.url);
    current.searchParams.set('api-key', 'rotated-secret');
    expect((await app.inject(requestPath(current))).statusCode).toBe(200);
    expect((await app.inject('/api/qx/subscribe?api-key=clash-secret')).statusCode).toBe(401);
    expect((await app.inject('/api/clash/subscribe?api-key=clash-secret')).statusCode).toBe(401);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns a resource error when its rule source is unavailable', async () => {
    const fetchStub = vi.fn(async () => new Response(YAML.stringify({ proxies: [node('HK-1')] })));
    vi.stubGlobal('fetch', fetchStub);
    const { app, clash } = await fixture();
    const profile = await app.inject('/api/qx/subscribe?api-key=clash-secret');
    const resource = references(profile.body)[1]!;
    await fsp.rm(path.join(clash.groupDir('list'), 'remote.list'));
    fetchStub.mockClear();
    fetchStub.mockRejectedValue(new Error('upstream private-token'));
    const response = await app.inject(requestPath(resource.url));
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-token');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0]![0])).toBe('https://rules.example/list');
  });

  it('uses last valid provider cache when upstream refresh fails', async () => {
    const fetchStub = vi.fn(async () => new Response(YAML.stringify({ proxies: [node('HK-1')] })));
    vi.stubGlobal('fetch', fetchStub);
    const { converter, paths } = await fixture();
    expect((await converter.build('http://local')).stats.nodes).toBe(2);
    const directory = paths.dataPath('clash', 'providers');
    for (const file of await fsp.readdir(directory)) await fsp.utimes(path.join(directory, file), 0, 0);
    fetchStub.mockRejectedValueOnce(new Error('network private-token'));
    const result = await converter.build('http://local');
    expect(result.stats.nodes).toBe(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'stale:nodes:Airport' }));
    expect(JSON.stringify(result.issues)).not.toContain('private-token');
  });

  it('reports missing provider data and keeps unavailable groups rejecting traffic', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable'); }));
    const { converter } = await fixture();
    const result = await converter.build('http://local');
    expect(result.stats.nodes).toBe(1);
    expect(result.content).toContain('static=Region, reject');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'provider:nodes:Airport' }));
  });
});
