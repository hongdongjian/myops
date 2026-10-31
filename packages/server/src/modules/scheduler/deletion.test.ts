import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import Fastify from 'fastify';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';
import { errorHandlerPlugin } from '../../plugins/error-handler.js';
import { schedulerModule } from './routes.js';
import { SchedulerService } from './service.js';

afterEach(() => vi.restoreAllMocks());

async function makeFixture() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-deletion-'));
  const paths = createPaths(tmp);
  const deps = { paths } as Deps;
  const svc = new SchedulerService(deps);
  const app = Fastify();
  onTestFinished(async () => {
    svc.stopTicker();
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });
  await app.register(errorHandlerPlugin);
  await app.register(schedulerModule, { deps, service: svc });
  const task = await svc.createTask({
    name: 'to delete',
    command: "printf 'done'",
    enabled: false,
    scheduleType: 'interval',
    intervalSeconds: 60,
  });
  const logDir = paths.dataPath('scheduler', 'logs', task.id);
  const historyFile = paths.dataPath('scheduler', 'history', `${task.id}.json`);
  await fsp.mkdir(path.join(logDir, 'nested'), { recursive: true });
  await fsp.writeFile(path.join(logDir, 'current.log'), 'current');
  await fsp.writeFile(path.join(logDir, 'legacy.log'), 'unindexed');
  await fsp.writeFile(path.join(logDir, 'nested', 'old.log'), 'nested');
  await fsp.writeFile(historyFile, JSON.stringify([{
    id: 'current', taskId: task.id, startTime: new Date(0).toISOString(),
    success: true, running: false, logFile: path.join(logDir, 'current.log'),
  }]));
  await fsp.writeFile(`${historyFile}.tmp`, 'temporary');
  return { tmp, paths, svc, app, task, logDir, historyFile };
}

async function expectRemoved(file: string) {
  await expect(fsp.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('scheduler task deletion', () => {
  it('deletes history and the whole log directory without affecting another task', async () => {
    const { paths, svc, app, task, logDir, historyFile } = await makeFixture();
    const other = await svc.createTask({ ...task, name: 'keep' });
    const otherHistory = paths.dataPath('scheduler', 'history', `${other.id}.json`);
    const otherLog = paths.dataPath('scheduler', 'logs', other.id, 'keep.log');
    await fsp.mkdir(path.dirname(otherLog), { recursive: true });
    await fsp.writeFile(otherHistory, '[]');
    await fsp.writeFile(otherLog, 'keep');

    const response = await app.inject({ method: 'POST', url: '/api/cron/tasks/delete', payload: { id: task.id } });

    expect(response.statusCode).toBe(200);
    expect(svc.getTask(task.id)).toBeUndefined();
    const saved = JSON.parse(await fsp.readFile(paths.dataPath('scheduler', 'tasks.json'), 'utf-8'));
    expect(saved.map((item: { id: string }) => item.id)).toEqual([other.id]);
    await expectRemoved(historyFile);
    await expectRemoved(`${historyFile}.tmp`);
    await expectRemoved(logDir);
    await expect(fsp.readFile(otherHistory, 'utf-8')).resolves.toBe('[]');
    await expect(fsp.readFile(otherLog, 'utf-8')).resolves.toBe('keep');
  });

  it('allows missing files and repeated deletion', async () => {
    const { svc, task, logDir, historyFile } = await makeFixture();
    await fsp.rm(historyFile);
    await fsp.rm(`${historyFile}.tmp`);
    await fsp.rm(logDir, { recursive: true });

    await svc.deleteTask(task.id);
    await svc.deleteTask(task.id);

    expect(svc.getTask(task.id)).toBeUndefined();
    await expectRemoved(logDir);
  });

  it('keeps the task and its files when saving the task list fails', async () => {
    const { svc, task, logDir, historyFile } = await makeFixture();
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(failure);

    await expect(svc.deleteTask(task.id)).rejects.toThrow('disk full');

    expect(svc.getTask(task.id)).toEqual(task);
    await expect(fsp.readFile(path.join(logDir, 'current.log'), 'utf-8')).resolves.toBe('current');
    expect(JSON.parse(await fsp.readFile(historyFile, 'utf-8'))).toHaveLength(1);
  });

  it('can retry cleanup after a filesystem error', async () => {
    const { svc, task, logDir, historyFile } = await makeFixture();
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.spyOn(fsp, 'rm').mockRejectedValueOnce(failure);

    await expect(svc.deleteTask(task.id)).rejects.toThrow('permission denied');
    await svc.deleteTask(task.id);

    await expectRemoved(historyFile);
    await expectRemoved(logDir);
  });

  it('rejects task IDs that could delete a parent directory', async () => {
    const { app, svc, task, logDir } = await makeFixture();
    for (const id of ['.', '..', '../other']) {
      const response = await app.inject({ method: 'POST', url: '/api/cron/tasks/delete', payload: { id } });
      expect(response.statusCode).toBe(400);
    }
    expect(svc.getTask(task.id)).toEqual(task);
    await expect(fsp.readFile(path.join(logDir, 'current.log'), 'utf-8')).resolves.toBe('current');
  });

  it('rejects deletion during execution and removes files after execution finishes', async () => {
    const { tmp, app, svc, task, logDir, historyFile } = await makeFixture();
    const started = path.join(tmp, 'started');
    const gate = path.join(tmp, 'finish');
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    await svc.updateTask({
      ...task,
      command: `printf started > ${quote(started)}; while [ ! -f ${quote(gate)} ]; do sleep 0.01; done`,
    });
    const run = svc['runTask'](task.id);
    try {
      await vi.waitFor(async () => {
        await expect(fsp.readFile(started, 'utf-8')).resolves.toBe('started');
      });
      const response = await app.inject({ method: 'POST', url: '/api/cron/tasks/delete', payload: { id: task.id } });
      expect(response.statusCode).toBe(409);
      expect(svc.getTask(task.id)).toBeDefined();
    } finally {
      await fsp.writeFile(gate, '');
      await run;
    }
    await svc.deleteTask(task.id);
    await expectRemoved(historyFile);
    await expectRemoved(logDir);
  });

  it('does not let a queued execution recreate deleted files', async () => {
    const { svc, task, logDir, historyFile } = await makeFixture();
    const release = await svc['mu'].acquire();
    const deletion = svc.deleteTask(task.id);
    const queuedRun = svc['runTask'](task.id);
    release();

    await Promise.all([deletion, queuedRun]);

    await expectRemoved(historyFile);
    await expectRemoved(logDir);
  });
});
