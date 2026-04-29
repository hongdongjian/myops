import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SchedulerService, recalcNextRun } from './service.js';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';

function makeDeps(): { deps: Deps; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-svc-'));
  const paths = createPaths(tmp);
  return {
    deps: {
      config: { port: 0, models: [] } as any,
      paths,
      runner: {
        async run() {
          return { stdout: 'ok', stderr: '', code: 0 };
        },
      } as any,
      store: {} as any,
      processMgr: {} as any,
    },
    tmp,
  };
}

describe('SchedulerService', () => {
  it('recalcNextRun schedules for tomorrow when time has passed', () => {
    const task = {
      id: 'x',
      name: 'a',
      enabled: true,
      scheduleTime: '00:00',
      randomDelay: false,
      randomDelayMax: 0,
      mustSucceedDaily: false,
      model: '',
      prompt: '',
      status: '',
    };
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    recalcNextRun(task, now);
    expect(task.nextRunAt).toBeDefined();
    expect(new Date(task.nextRunAt!).getTime()).toBeGreaterThan(now.getTime());
  });

  it('createTask + listTasks roundtrip persists', async () => {
    const { deps } = makeDeps();
    const svc = new SchedulerService(deps);
    await svc.start();
    const t = await svc.createTask({
      name: 'demo',
      enabled: false,
      scheduleTime: '09:00',
      randomDelay: false,
      randomDelayMax: 0,
      mustSucceedDaily: false,
      model: '',
      prompt: 'hello',
    });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe('stopped');
    expect(svc.listTasks()).toHaveLength(1);

    // reload from disk
    const svc2 = new SchedulerService(deps);
    await svc2.start();
    expect(svc2.listTasks()).toHaveLength(1);
  });

  it('updateTask preserves running state and recomputes next run', async () => {
    const { deps } = makeDeps();
    const svc = new SchedulerService(deps);
    await svc.start();
    const t = await svc.createTask({
      name: 'a',
      enabled: false,
      scheduleTime: '09:00',
      randomDelay: false,
      randomDelayMax: 0,
      mustSucceedDaily: false,
      model: '',
      prompt: '',
    });
    const updated = await svc.updateTask({ ...t, name: 'b', enabled: true });
    expect(updated.name).toBe('b');
    expect(updated.status).toBe('scheduled');
    expect(updated.nextRunAt).toBeDefined();
  });

  it('setEnabled false clears nextRunAt', async () => {
    const { deps } = makeDeps();
    const svc = new SchedulerService(deps);
    await svc.start();
    const t = await svc.createTask({
      name: 'a',
      enabled: true,
      scheduleTime: '09:00',
      randomDelay: false,
      randomDelayMax: 0,
      mustSucceedDaily: false,
      model: '',
      prompt: '',
    });
    expect(svc.getTask(t.id)?.nextRunAt).toBeDefined();
    await svc.setEnabled(t.id, false);
    expect(svc.getTask(t.id)?.nextRunAt).toBeUndefined();
    expect(svc.getTask(t.id)?.status).toBe('stopped');
  });

  it('deleteTask removes from list', async () => {
    const { deps } = makeDeps();
    const svc = new SchedulerService(deps);
    await svc.start();
    const t = await svc.createTask({
      name: 'a',
      enabled: false,
      scheduleTime: '',
      randomDelay: false,
      randomDelayMax: 0,
      mustSucceedDaily: false,
      model: '',
      prompt: '',
    });
    await svc.deleteTask(t.id);
    expect(svc.listTasks()).toHaveLength(0);
  });
});
