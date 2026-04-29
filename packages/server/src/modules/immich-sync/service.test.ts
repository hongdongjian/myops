import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ImmichSyncService } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'immich-svc-'));
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

describe('ImmichSyncService', () => {
  it('start loads empty defaults', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    expect(svc.listAccounts()).toEqual([]);
    expect(svc.listPlans()).toEqual([]);
    expect(svc.getActiveAccountId()).toBe('');
  });

  it('addAccount sets active when first', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    const a = await svc.addAccount({ name: 'a', email: 'a@b', apiKey: 'k', baseUrl: '' });
    expect(a.id).toBeTruthy();
    expect(a.baseUrl).toBe('http://localhost:2283');
    expect(svc.getActiveAccountId()).toBe(a.id);
    const cfg = svc.getConfig();
    expect(cfg.apiKey).toBe('k');
  });

  it('createPlan / updatePlan / setPlanEnabled / deletePlan', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    const acc = await svc.addAccount({ name: 'a', email: 'a@b', apiKey: 'k', baseUrl: '' });
    const plan = await svc.createPlan({
      accountId: '',
      name: 'p',
      personIds: ['x'],
      personNames: ['X'],
      albumId: 'al',
      albumName: 'AL',
      removeDeleted: false,
      enabled: false,
      scheduleInterval: 0,
    });
    expect(plan.status).toBe('idle');
    expect(plan.accountId).toBe(acc.id); // backfilled with active

    await svc.updatePlan(plan.id, {
      accountId: '',
      name: 'p2',
      personIds: ['y'],
      personNames: ['Y'],
      albumId: 'al2',
      albumName: 'AL2',
      removeDeleted: true,
      enabled: false,
      scheduleInterval: 60,
    });
    const after = svc.listPlans()[0]!;
    expect(after.name).toBe('p2');
    expect(after.scheduleInterval).toBe(60);
    expect(after.removeDeleted).toBe(true);

    await svc.setPlanEnabled(plan.id, true);
    expect(svc.listPlans()[0]!.enabled).toBe(true);

    await svc.deletePlan(plan.id);
    expect(svc.listPlans()).toEqual([]);
  });

  it('persists across restarts', async () => {
    const { deps } = makeDeps();
    const svc1 = new ImmichSyncService(deps);
    await svc1.start();
    await svc1.addAccount({ name: 'n', email: 'e', apiKey: 'k', baseUrl: 'http://x' });

    const svc2 = new ImmichSyncService(deps);
    await svc2.start();
    expect(svc2.listAccounts()).toHaveLength(1);
    expect(svc2.getActiveAccountId()).toBeTruthy();
  });

  it('updatePlan on missing id throws 404', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    await expect(
      svc.updatePlan('nope', {
        accountId: '',
        name: 'x',
        personIds: ['a'],
        personNames: [],
        albumId: 'b',
        albumName: '',
        removeDeleted: false,
        enabled: false,
        scheduleInterval: 0,
      }),
    ).rejects.toThrow();
  });

  it('setActiveAccount on missing id throws 404', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    await expect(svc.setActiveAccount('missing')).rejects.toThrow();
  });

  it('deleteAccount picks new active', async () => {
    const { deps } = makeDeps();
    const svc = new ImmichSyncService(deps);
    await svc.start();
    const a = await svc.addAccount({ name: 'a', email: '', apiKey: 'k1', baseUrl: '' });
    const b = await svc.addAccount({ name: 'b', email: '', apiKey: 'k2', baseUrl: '' });
    expect(svc.getActiveAccountId()).toBe(a.id);
    await svc.deleteAccount(a.id);
    expect(svc.getActiveAccountId()).toBe(b.id);
    await svc.deleteAccount(b.id);
    expect(svc.getActiveAccountId()).toBe('');
  });
});
