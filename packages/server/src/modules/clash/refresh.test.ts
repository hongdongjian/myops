import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { ClashService } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

beforeEach(() => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(key, '');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function fixture(interval: number | undefined = 60) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'clash-refresh-'));
  onTestFinished(() => fsp.rm(tmp, { recursive: true, force: true }));
  const service = new ClashService({ paths: createPaths(tmp) } as Deps);
  await service.saveConfig({
    custom_proxies: [],
    custom_rules: [{ id: 'local', name: 'Local', behavior: 'classical', rules: ['DOMAIN,local.example'], target_group: 'DIRECT', enabled: true }],
  });
  const template = {
    'rule-providers': { Rules: { type: 'http', url: 'https://rules.example/list', behavior: 'classical', format: 'text', interval } },
    'proxy-providers': { Airport: { type: 'http', url: 'https://airport.example/sub' } },
    'proxy-groups': [{ name: 'Proxy', type: 'select', proxies: ['DIRECT'], icon: 'https://icons.example/proxy.png' }],
  };
  await service.saveTemplate(YAML.stringify(template));
  const manifest = await service.syncManifest();
  const entry = manifest.list.find(resource => resource.source === 'remote')!;
  const previousTime = Date.now() - 2 * 60 * 1000;
  const old = 'DOMAIN,old.example\n';
  entry.updatedAt = previousTime;
  entry.size = Buffer.byteLength(old);
  await service.saveManifest(manifest);
  await fsp.mkdir(service.groupDir('list'), { recursive: true });
  await fsp.writeFile(path.join(service.groupDir('list'), entry.filename), old);
  return { service, template, manifest, entry, previousTime, old, file: path.join(service.groupDir('list'), entry.filename) };
}

describe('Clash rules refresh', () => {
  it('refreshes only due rules and preserves icons, local rules and airport sources', async () => {
    const { service, file } = await fixture();
    const fetchStub = vi.fn(async () => new Response('DOMAIN,new.example\n'));
    vi.stubGlobal('fetch', fetchStub);
    expect(await service.refreshDueRules()).toEqual({ refreshed: 1, failed: 0 });
    expect(await fsp.readFile(file, 'utf-8')).toBe('DOMAIN,new.example\n');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe('https://rules.example/list');
    expect(await service.refreshDueRules()).toEqual({ refreshed: 0, failed: 0 });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect((await fsp.readdir(service.groupDir('list'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('defaults to twenty-four hours when no provider interval is specified', async () => {
    const { service, template, entry } = await fixture();
    delete (template['rule-providers'].Rules as { interval?: number }).interval;
    await service.saveTemplate(YAML.stringify(template));
    const fetchStub = vi.fn(async () => new Response('DOMAIN,new.example\n'));
    vi.stubGlobal('fetch', fetchStub);
    expect(await service.refreshDueRules()).toEqual({ refreshed: 0, failed: 0 });
    const manifest = await service.loadManifest();
    manifest.list.find(resource => resource.url === entry.url)!.updatedAt = Date.now() - 25 * 60 * 60 * 1000;
    await service.saveManifest(manifest);
    expect(await service.refreshDueRules()).toEqual({ refreshed: 1, failed: 0 });
  });

  it('downloads a missing rule file even when its timestamp is fresh', async () => {
    const { service, file } = await fixture(86400);
    await fsp.rm(file);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('DOMAIN,new.example\n')));
    expect(await service.refreshDueRules()).toEqual({ refreshed: 1, failed: 0 });
    expect(await fsp.readFile(file, 'utf-8')).toContain('new.example');
  });

  it.each([
    ['HTTP error', () => new Response('failure', { status: 503 })],
    ['empty response', () => new Response('')],
    ['HTML response', () => new Response('<!doctype html><html>error</html>')],
    ['invalid rule content', () => new Response('upstream rate limit exceeded')],
  ])('keeps the previous rule file and success timestamp on %s', async (_name, response) => {
    const { service, file, old, previousTime } = await fixture();
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    expect(await service.refreshDueRules()).toEqual({ refreshed: 0, failed: 1 });
    expect(await fsp.readFile(file, 'utf-8')).toBe(old);
    const current = (await service.loadManifest()).list.find(resource => resource.source === 'remote')!;
    expect(current.updatedAt).toBe(previousTime);
    expect(current.size).toBe(Buffer.byteLength(old));
    expect(current.error).toBeTruthy();
  });

  it('keeps a valid YAML payload when the new response cannot be parsed', async () => {
    const { service, template, file } = await fixture();
    template['rule-providers'].Rules.format = 'yaml';
    await service.saveTemplate(YAML.stringify(template));
    const previous = 'payload:\n  - DOMAIN,old.example\n';
    await fsp.writeFile(file, previous);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('payload: [')));
    await service.refreshDueRules();
    expect(await fsp.readFile(file, 'utf-8')).toBe(previous);
  });

  it('keeps the previous file and removes temporary output if replacement fails', async () => {
    const { service, file, old, previousTime } = await fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('DOMAIN,new.example\n')));
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (source, target) => {
      if (target === file) throw new Error('simulated replacement failure');
      return rename(source, target);
    });
    expect(await service.refreshDueRules()).toEqual({ refreshed: 0, failed: 1 });
    expect(await fsp.readFile(file, 'utf-8')).toBe(old);
    expect((await service.loadManifest()).list.find(resource => resource.source === 'remote')!.updatedAt).toBe(previousTime);
    expect((await fsp.readdir(service.groupDir('list'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('does not replace an old file when an automatic request is cancelled', async () => {
    const { service, file, old } = await fixture();
    const fetchStub = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchStub);
    const controller = new AbortController();
    const pending = service.refreshDueRules(controller.signal);
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toEqual({ refreshed: 0, failed: 0 });
    expect(await fsp.readFile(file, 'utf-8')).toBe(old);
  });
});
