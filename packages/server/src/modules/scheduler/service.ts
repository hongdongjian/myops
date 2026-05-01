import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type { ScheduledTask, TaskExecution } from './schema.js';

export const SCHEDULER_TICK_MS = 3 * 1000;

function nowID(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

function parseScheduleTime(scheduleTime: string, base: Date): Date {
  const m = /^(\d+):(\d+)$/.exec(scheduleTime.trim());
  const hour = m ? parseInt(m[1]!, 10) : 0;
  const minute = m ? parseInt(m[2]!, 10) : 0;
  const out = new Date(base);
  out.setHours(hour, minute, 0, 0);
  return out;
}

export function recalcNextRun(task: ScheduledTask, now: Date = new Date()): void {
  switch (task.scheduleType) {
    case 'once': {
      if (task.runAt) {
        const t = new Date(task.runAt);
        task.nextRunAt = t.getTime() > now.getTime() ? task.runAt : undefined;
      } else {
        task.nextRunAt = undefined;
      }
      break;
    }
    case 'interval': {
      const secs = task.intervalSeconds ?? 60;
      task.nextRunAt = new Date(now.getTime() + secs * 1000).toISOString();
      break;
    }
    case 'periodic': {
      if (!task.scheduleTime) {
        task.nextRunAt = undefined;
        return;
      }
      const intervalMs = (task.intervalDays ?? 1) * 24 * 60 * 60 * 1000;
      const todayAt = parseScheduleTime(task.scheduleTime, now);
      let next: Date;
      if (todayAt.getTime() > now.getTime()) {
        next = todayAt;
      } else {
        next = new Date(todayAt.getTime() + intervalMs);
        while (next.getTime() <= now.getTime()) {
          next = new Date(next.getTime() + intervalMs);
        }
      }
      const delaySecs = task.randomDelaySeconds ?? 0;
      if (delaySecs > 0) {
        const min = delaySecs / 2;
        next = new Date(next.getTime() + Math.floor(min + Math.random() * (delaySecs - min + 1)) * 1000);
      }
      task.nextRunAt = next.toISOString();
      break;
    }
  }
}

export class SchedulerService {
  private readonly dataDir: string;
  private tasks: ScheduledTask[] = [];
  private readonly running = new Set<string>();
  private readonly mu = new Mutex();
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly deps: Deps) {
    this.dataDir = deps.paths.dataPath('scheduler');
  }

  async start(): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'logs'), { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'history'), { recursive: true });
    await this.loadTasks();
    const now = new Date();
    for (const task of this.tasks) {
      if (task.enabled) {
        task.status = 'scheduled';
        recalcNextRun(task, now);
      } else {
        task.status = 'stopped';
      }
    }
    await this.persistTasks();
  }

  startTicker(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.tick();
    }, SCHEDULER_TICK_MS);
    this.interval.unref?.();
  }

  stopTicker(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // ── public API ───────────────────────────────────────────────────────────

  listTasks(): ScheduledTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  getTask(id: string): ScheduledTask | undefined {
    const t = this.tasks.find((x) => x.id === id);
    return t ? { ...t } : undefined;
  }

  async createTask(
    input: Omit<ScheduledTask, 'id' | 'status' | 'nextRunAt' | 'lastRunAt'>,
  ): Promise<ScheduledTask> {
    const task: ScheduledTask = { ...input, id: nowID(), status: 'stopped' };
    if (task.enabled) {
      task.status = 'scheduled';
      recalcNextRun(task);
    }
    this.tasks = [...this.tasks, task];
    await this.persistTasks();
    return { ...task };
  }

  async updateTask(updated: ScheduledTask): Promise<ScheduledTask> {
    const idx = this.tasks.findIndex((t) => t.id === updated.id);
    if (idx < 0) throw new AppError('NOT_FOUND', `task not found: ${updated.id}`, 404);
    const isRunning = this.running.has(updated.id);
    const next: ScheduledTask = { ...this.tasks[idx]!, ...updated };
    if (isRunning) {
      next.status = 'running';
    } else if (next.enabled) {
      next.status = 'scheduled';
      recalcNextRun(next);
    } else {
      next.status = 'stopped';
      next.nextRunAt = undefined;
    }
    this.tasks = this.tasks.map((t, i) => (i === idx ? next : t));
    await this.persistTasks();
    return { ...next };
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    await this.persistTasks();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw new AppError('NOT_FOUND', `task not found: ${id}`, 404);
    const next = { ...this.tasks[idx]!, enabled };
    if (!enabled) {
      next.status = 'stopped';
      next.nextRunAt = undefined;
    } else if (!this.running.has(id)) {
      next.status = 'scheduled';
      recalcNextRun(next);
    }
    this.tasks = this.tasks.map((t, i) => (i === idx ? next : t));
    await this.persistTasks();
  }

  async runTaskNow(id: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new AppError('NOT_FOUND', `task not found: ${id}`, 404);
    if (this.running.has(id)) {
      throw new AppError('TASK_BUSY', `task is already running: ${id}`, 409);
    }
    void this.runTask(id);
  }

  async listExecutions(taskID: string): Promise<TaskExecution[]> {
    const execs = await this.loadExecutions(taskID);
    return execs.slice().reverse();
  }

  async getExecutionLog(taskID: string, execID: string): Promise<string> {
    const file = path.join(this.dataDir, 'logs', taskID, `${execID}.log`);
    try {
      return await fsp.readFile(file, 'utf-8');
    } catch (err) {
      throw new AppError('NOT_FOUND', `log not found: ${(err as Error).message}`, 404);
    }
  }

  // ── tick ─────────────────────────────────────────────────────────────────

  async tick(): Promise<void> {
    const now = new Date();
    const due: string[] = [];
    for (const task of this.tasks) {
      if (!task.enabled || this.running.has(task.id)) continue;
      if (task.nextRunAt && now.getTime() > new Date(task.nextRunAt).getTime()) {
        due.push(task.id);
      }
    }
    for (const id of due) void this.runTask(id);
  }

  private async runTask(taskID: string): Promise<void> {
    const release = await this.mu.acquire();
    let command = '';
    let taskName = '';
    let scheduleType: ScheduledTask['scheduleType'] = 'periodic';
    try {
      const task = this.tasks.find((t) => t.id === taskID);
      if (!task || this.running.has(taskID)) return;
      this.running.add(taskID);
      task.status = 'running';
      command = task.command;
      taskName = task.name;
      scheduleType = task.scheduleType;
    } finally {
      release();
    }
    await this.persistTasks();

    const execID = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const logDir = path.join(this.dataDir, 'logs', taskID);
    await fsp.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${execID}.log`);

    const startTime = new Date();
    const exec: TaskExecution = {
      id: execID,
      taskId: taskID,
      startTime: startTime.toISOString(),
      success: false,
      running: true,
      logFile,
    };
    await this.appendExecution(taskID, exec);

    const logStream = fs.createWriteStream(logFile, { flags: 'w' });
    logStream.write(`=== Task: ${taskName} ===\n=== Start: ${startTime.toISOString()} ===\n\nSTDOUT:\n`);

    let runErr: string | null = null;
    try {
      const { code, stderr } = await new Promise<{ code: number; stderr: string }>((resolve) => {
        const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderrStr = '';
        child.stdout.on('data', (chunk: Buffer) => { logStream.write(chunk); });
        child.stderr.on('data', (chunk: Buffer) => { stderrStr += chunk.toString(); });
        child.on('close', (exitCode) => resolve({ code: exitCode ?? -1, stderr: stderrStr }));
      });
      logStream.write(`\n\nSTDERR:\n${stderr}`);
      if (code !== 0) {
        runErr = stderr.trim() || `exit ${code}`;
      }
    } catch (err) {
      runErr = (err as Error).message;
      logStream.write(`\n\nERROR:\n${runErr}`);
    } finally {
      await new Promise<void>((r) => logStream.end(r));
    }

    const endTime = new Date();
    const finished: TaskExecution = {
      ...exec,
      endTime: endTime.toISOString(),
      running: false,
      success: runErr === null,
    };
    if (runErr) finished.errorMsg = runErr;
    await this.appendExecution(taskID, finished);

    const release2 = await this.mu.acquire();
    try {
      const task = this.tasks.find((t) => t.id === taskID);
      if (task) {
        task.lastRunAt = endTime.toISOString();
        this.running.delete(taskID);
        if (scheduleType === 'once') {
          task.enabled = false;
          task.status = 'stopped';
          task.nextRunAt = undefined;
          task.retryAttempts = 0;
        } else if (task.enabled) {
          task.status = 'scheduled';
          const maxRetries = task.retryCount ?? 1;
          const currentAttempts = task.retryAttempts ?? 0;
          if (runErr !== null && currentAttempts < maxRetries) {
            task.retryAttempts = currentAttempts + 1;
            const intervalSecs = task.retryIntervalSeconds ?? 0;
            if (intervalSecs > 0) {
              const min = intervalSecs / 2;
              const delay = Math.floor(min + Math.random() * (intervalSecs - min + 1));
              task.nextRunAt = new Date(endTime.getTime() + delay * 1000).toISOString();
            } else {
              task.nextRunAt = new Date(endTime.getTime() + 1000).toISOString();
            }
          } else {
            task.retryAttempts = 0;
            recalcNextRun(task, endTime);
          }
        } else {
          task.status = 'stopped';
        }
      }
    } finally {
      release2();
    }
    await this.persistTasks();
  }

  // ── persistence ──────────────────────────────────────────────────────────

  private tasksFile(): string {
    return path.join(this.dataDir, 'tasks.json');
  }

  private historyFile(taskID: string): string {
    return path.join(this.dataDir, 'history', `${taskID}.json`);
  }

  private async loadTasks(): Promise<void> {
    try {
      const data = await fsp.readFile(this.tasksFile(), 'utf-8');
      this.tasks = JSON.parse(data) as ScheduledTask[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.tasks = [];
        return;
      }
      throw err;
    }
  }

  private async persistTasks(): Promise<void> {
    const data = JSON.stringify(this.tasks, null, 2);
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.writeFile(this.tasksFile(), data);
  }

  private async loadExecutions(taskID: string): Promise<TaskExecution[]> {
    try {
      const data = await fsp.readFile(this.historyFile(taskID), 'utf-8');
      return JSON.parse(data) as TaskExecution[];
    } catch {
      return [];
    }
  }

  private async appendExecution(taskID: string, exec: TaskExecution): Promise<void> {
    let history = await this.loadExecutions(taskID);
    const idx = history.findIndex((e) => e.id === exec.id);
    if (idx >= 0) {
      history = history.map((e, i) => (i === idx ? exec : e));
    } else {
      history = [...history, exec];
    }
    if (history.length > 500) history = history.slice(history.length - 500);
    await fsp.mkdir(path.dirname(this.historyFile(taskID)), { recursive: true });
    await fsp.writeFile(this.historyFile(taskID), JSON.stringify(history, null, 2));
  }
}

export function _testFsExists(p: string): boolean {
  return fs.existsSync(p);
}
