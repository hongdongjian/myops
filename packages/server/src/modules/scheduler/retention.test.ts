import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaths } from '../../paths.js';
import type { Deps } from '../../deps.js';
import type { TaskExecution } from './schema.js';
import { SchedulerService } from './service.js';

afterEach(() => vi.restoreAllMocks());

async function makeFixture(command = "printf 'nothing changed'") {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-retention-'));
  onTestFinished(() => fsp.rm(tmp, { recursive: true, force: true }));
  const paths = createPaths(tmp);
  const svc = new SchedulerService({ paths } as Deps);
  await svc.start();
  const task = await svc.createTask({
    name: 'frequent sync',
    command,
    enabled: true,
    scheduleType: 'interval',
    intervalSeconds: 5,
  });
  const logDir = paths.dataPath('scheduler', 'logs', task.id);
  const historyFile = paths.dataPath('scheduler', 'history', `${task.id}.json`);
  await fsp.mkdir(logDir, { recursive: true });
  const history: TaskExecution[] = Array.from({ length: 500 }, (_, i) => ({
    id: `${i + 1}`,
    taskId: task.id,
    startTime: new Date(i * 1000).toISOString(),
    endTime: new Date(i * 1000 + 100).toISOString(),
    success: true,
    running: false,
    logFile: path.join(logDir, `${i + 1}.log`),
  }));
  await Promise.all(history.map((exec) => fsp.writeFile(exec.logFile, `log ${exec.id}`)));
  await fsp.writeFile(historyFile, JSON.stringify(history));
  return { svc, task, logDir, historyFile, history, paths };
}

describe('scheduler log retention', () => {
  it.each([
    { command: "printf 'nothing changed'", success: true },
    { command: "printf 'failed' >&2; exit 1", success: false },
  ])('bounds logs for repeated executions (success=$success)', async ({ command, success }) => {
    const { svc, task, logDir } = await makeFixture(command);
    const legacyLog = path.join(logDir, 'legacy.log');
    await fsp.writeFile(legacyLog, 'existing untracked log');

    for (let i = 0; i < 3; i++) {
      await svc['runTask'](task.id);
      const executions = await svc.listExecutions(task.id);
      expect(executions).toHaveLength(500);
      expect(executions[0]).toMatchObject({ success, running: false });
      expect((await fsp.readdir(logDir)).sort()).toEqual(
        [...executions.map((exec) => `${exec.id}.log`), 'legacy.log'].sort(),
      );
      expect(await svc.getExecutionLog(task.id, executions[0]!.id)).toContain('STDOUT:');
      expect(svc.getTask(task.id)?.status).toBe('scheduled');
    }
    await expect(fsp.readFile(legacyLog, 'utf-8')).resolves.toBe('existing untracked log');
  });

  it('continues when an expired log is already missing', async () => {
    const { svc, task, history, logDir } = await makeFixture();
    await fsp.unlink(history[0]!.logFile);

    await svc['runTask'](task.id);
    await svc['runTask'](task.id);

    expect(await fsp.readdir(logDir)).toHaveLength(500);
    expect(svc.getTask(task.id)?.status).toBe('scheduled');
  });

  it('keeps existing logs when history persistence fails', async () => {
    const { svc, task, history, historyFile } = await makeFixture();
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(failure);

    await expect(svc['appendExecution'](task.id, { ...history[0]!, id: 'new' }))
      .rejects.toThrow('disk full');

    expect(JSON.parse(await fsp.readFile(historyFile, 'utf-8'))).toEqual(history);
    await expect(fsp.readFile(history[0]!.logFile, 'utf-8')).resolves.toBe('log 1');
  });

  it('does not let a log removal failure leave the task running', async () => {
    const { svc, task, history } = await makeFixture();
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.spyOn(fsp, 'unlink').mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await svc['runTask'](task.id);

    expect(svc.getTask(task.id)?.status).toBe('scheduled');
    expect(await svc.listExecutions(task.id)).toHaveLength(500);
    expect(warn).toHaveBeenCalledWith(expect.any(String), history[0]!.logFile, failure);
  });

  it('keeps the previous history and logs when atomic replacement fails', async () => {
    const { svc, task, history, historyFile } = await makeFixture();
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    await expect(svc['appendExecution'](task.id, { ...history[0]!, id: 'new' }))
      .rejects.toThrow('rename failed');

    expect(JSON.parse(await fsp.readFile(historyFile, 'utf-8'))).toEqual(history);
    await expect(fsp.readFile(history[0]!.logFile, 'utf-8')).resolves.toBe('log 1');
  });

  it('only removes the expired task log, not a path stored in history', async () => {
    const { svc, task, history, historyFile, paths } = await makeFixture();
    const actualLog = history[0]!.logFile;
    const otherLog = paths.dataPath('scheduler', 'logs', 'other-task', '1.log');
    await fsp.mkdir(path.dirname(otherLog), { recursive: true });
    await fsp.writeFile(otherLog, 'other task');
    history[0]!.logFile = otherLog;
    await fsp.writeFile(historyFile, JSON.stringify(history));

    await svc['runTask'](task.id);

    await expect(fsp.stat(actualLog)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.readFile(otherLog, 'utf-8')).resolves.toBe('other task');
  });

  it('does not follow an execution ID outside the task log directory', async () => {
    const { svc, task, history, historyFile, paths } = await makeFixture();
    const outsideLog = paths.dataPath('scheduler', 'logs', 'outside.log');
    await fsp.writeFile(outsideLog, 'keep');
    history[0]!.id = '../outside';
    await fsp.writeFile(historyFile, JSON.stringify(history));

    await svc['runTask'](task.id);

    await expect(fsp.readFile(outsideLog, 'utf-8')).resolves.toBe('keep');
  });
});
