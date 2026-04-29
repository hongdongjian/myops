import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CloudreveService } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-svc-'));
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

describe('CloudreveService', () => {
  it('start loads defaults', async () => {
    const { deps } = makeDeps();
    const svc = new CloudreveService(deps);
    await svc.start();
    expect(svc.getConfig()).toEqual({ baseUrl: '', email: '', password: '' });
    expect(svc.listTasks()).toEqual([]);
  });

  it('saveConfig + getConfig persists across restarts', async () => {
    const { deps } = makeDeps();
    const svc = new CloudreveService(deps);
    await svc.start();
    await svc.saveConfig({ baseUrl: 'https://x', email: 'a@b', password: 'pw' });

    const svc2 = new CloudreveService(deps);
    await svc2.start();
    expect(svc2.getConfig()).toEqual({ baseUrl: 'https://x', email: 'a@b', password: 'pw' });
  });

  it('createTask returns idle status', async () => {
    const { deps } = makeDeps();
    const svc = new CloudreveService(deps);
    await svc.start();
    const t = await svc.createTask({
      name: 'a',
      src: '/src',
      dstPath: '/dst',
      policyId: '1',
      userHashId: '',
      recursive: false,
      extractMediaMeta: false,
      enabled: false,
    });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe('idle');
    expect(svc.listTasks()).toHaveLength(1);
  });

  it('runTask on missing id throws 404', async () => {
    const { deps } = makeDeps();
    const svc = new CloudreveService(deps);
    await svc.start();
    await expect(svc.runTask('nope')).rejects.toThrow();
  });
});
