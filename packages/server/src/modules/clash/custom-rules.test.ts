import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import Fastify from 'fastify';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import type { ClashCustomRule } from './schema.js';
import { ClashService } from './service.js';
import { clashModule } from './routes.js';

afterEach(() => vi.restoreAllMocks());

const rule = (id: string, domain = 'claude.example'): ClashCustomRule => ({
  id, name: id, target_group: 'DIRECT', behavior: 'classical', enabled: true,
  rules: ['# comment', 'DOMAIN,' + domain, ''],
});
const resourcePath = (id: string) => '/api/clash/static/list/custom-' + id + '.list?api-key=test-key';

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'clash-custom-rules-'));
  const deps = { paths: createPaths(root) } as Deps;
  const service = new ClashService(deps);
  let app: ReturnType<typeof Fastify> | undefined;
  onTestFinished(async () => {
    await app?.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const syncConf = async (rules: ClashCustomRule[]) => {
    // Simulate Git checkout: only replace conf, never call the config-save API.
    await fsp.mkdir(service.rootDir(), { recursive: true });
    await fsp.writeFile(service.customPath(), JSON.stringify({ custom_proxies: [], custom_rules: rules }));
  };
  await syncConf([rule('claude')]);
  await service.saveTemplate('proxy-groups: []\nrules:\n  - MATCH,DIRECT\n');
  await fsp.mkdir(service.dataDir(), { recursive: true });
  await fsp.writeFile(service.configPath(), JSON.stringify({ api_key: 'test-key' }));
  const createApp = async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(clashModule, { deps });
    await app.ready();
    return app;
  };
  return { service, syncConf, createApp };
}

describe('custom rule files after conf sync', () => {
  it('generates files when syncing resources and preserves unchanged file timestamps', async () => {
    const { service } = await fixture();
    const before = await fsp.readFile(service.customPath(), 'utf8');
    const manifest = await service.syncManifest();
    const file = service.customRuleListPath('claude');
    expect(await fsp.readFile(file, 'utf8')).toBe('DOMAIN,claude.example\n');
    expect(manifest.list).toContainEqual(expect.objectContaining({ filename: 'custom-claude.list', source: 'local' }));
    await fsp.utimes(file, 1, 1);
    await service.syncManifest();
    expect((await fsp.stat(file)).mtimeMs).toBe(1000);
    expect(await fsp.readFile(service.customPath(), 'utf8')).toBe(before);
  });

  it('prepares custom files before publishing subscription resource URLs', async () => {
    const { service } = await fixture();
    const doc = YAML.parse(await service.buildSubscribe('https://clash.example.com'));
    expect(new URL(doc['rule-providers'].claude.url).pathname).toBe('/api/clash/static/list/custom-claude.list');
    expect(await fsp.readFile(service.customRuleListPath('claude'), 'utf8')).toBe('DOMAIN,claude.example\n');
  });

  it('generates files during startup without a config-save request', async () => {
    const { service, createApp } = await fixture();
    await createApp();
    await vi.waitFor(async () => {
      expect(await fsp.readFile(service.customRuleListPath('claude'), 'utf8')).toBe('DOMAIN,claude.example\n');
    });
  });

  it('reconciles conf updates and removals during automatic rule refresh', async () => {
    const { service, syncConf } = await fixture();
    await service.writeCustomRuleFiles(await service.loadConfig());
    const remoteFile = path.join(service.groupDir('list'), 'remote.list');
    await fsp.writeFile(remoteFile, 'DOMAIN,remote.example\n');
    await syncConf([rule('new', 'updated.example')]);
    expect(await service.refreshDueRules()).toEqual({ refreshed: 0, failed: 0 });
    expect(await fsp.readFile(service.customRuleListPath('new'), 'utf8')).toBe('DOMAIN,updated.example\n');
    await expect(fsp.access(service.customRuleListPath('claude'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fsp.readFile(remoteFile, 'utf8')).toBe('DOMAIN,remote.example\n');
  });

  it('repairs missing files and serves current conf to already subscribed clients', async () => {
    const { service, syncConf, createApp } = await fixture();
    const app = await createApp();
    await service.writeCustomRuleFiles(await service.loadConfig());
    await fsp.rm(service.customRuleListPath('claude'));
    const restored = await app.inject(resourcePath('claude'));
    expect(restored.statusCode).toBe(200);
    expect(restored.body).toBe('DOMAIN,claude.example\n');
    await syncConf([rule('claude', 'changed.example'), rule('added', 'new.example')]);
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => app.inject(resourcePath(index % 2 ? 'claude' : 'added'))));
    for (const [index, response] of responses.entries()) {
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(index % 2 ? 'DOMAIN,changed.example\n' : 'DOMAIN,new.example\n');
    }
    expect((await fsp.readdir(service.groupDir('list'))).some(file => file.endsWith('.tmp'))).toBe(false);
  });

  it('keeps authentication and returns 404 for removed and unknown rules', async () => {
    const { service, syncConf, createApp } = await fixture();
    const app = await createApp();
    await service.writeCustomRuleFiles(await service.loadConfig());
    await syncConf([rule('added')]);
    expect((await app.inject('/api/clash/static/list/custom-added.list')).statusCode).toBe(401);
    expect((await app.inject('/api/clash/static/list/custom-added.list?api-key=wrong')).statusCode).toBe(401);
    await expect(fsp.access(service.customRuleListPath('added'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await app.inject(resourcePath('claude'))).statusCode).toBe(404);
    expect((await app.inject(resourcePath('missing'))).statusCode).toBe(404);
    expect((await app.inject(resourcePath('added'))).statusCode).toBe(200);
  });

  it('keeps the previous file if atomic replacement fails and reports a server error', async () => {
    const { service, syncConf, createApp } = await fixture();
    const app = await createApp();
    await service.writeCustomRuleFiles(await service.loadConfig());
    const file = service.customRuleListPath('claude');
    const original = await fsp.readFile(file, 'utf8');
    await syncConf([rule('claude', 'updated.example')]);
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (source, target) => {
      if (target === file) throw Object.assign(new Error('replacement failed'), { code: 'EACCES' });
      return rename(source, target);
    });
    expect((await app.inject(resourcePath('claude'))).statusCode).toBe(500);
    expect(await fsp.readFile(file, 'utf8')).toBe(original);
    expect((await fsp.readdir(service.groupDir('list'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });
});
