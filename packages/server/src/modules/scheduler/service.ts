import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type { ScheduledTask, TaskExecution } from './schema.js';

export const SCHEDULER_TICK_MS = 30 * 1000;

function nowID(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

function dateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  if (!task.scheduleTime) {
    delete task.nextRunAt;
    return;
  }
  const todayRun = parseScheduleTime(task.scheduleTime, now);
  let next: Date;
  if (todayRun.getTime() > now.getTime()) {
    next = todayRun;
  } else {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    next = parseScheduleTime(task.scheduleTime, tomorrow);
  }
  if (task.randomDelay && task.randomDelayMax > 0) {
    const delay = Math.floor(Math.random() * (task.randomDelayMax + 1));
    next = new Date(next.getTime() + delay * 60 * 1000);
  }
  task.nextRunAt = next.toISOString();
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
    const today = dateOnly(now);
    for (const task of this.tasks) {
      if (task.enabled) {
        task.status = 'scheduled';
        recalcNextRun(task, now);
        if (task.mustSucceedDaily && task.lastSuccessDate !== today) {
          const scheduledToday = parseScheduleTime(task.scheduleTime, now);
          if (scheduledToday.getTime() <= now.getTime()) {
            const catchUp = new Date(now.getTime() + 10 * 1000);
            task.nextRunAt = catchUp.toISOString();
          }
        }
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

  async createTask(input: Omit<ScheduledTask, 'id' | 'status' | 'nextRunAt' | 'lastRunAt' | 'lastSuccessDate'>): Promise<ScheduledTask> {
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
      delete next.nextRunAt;
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
      delete next.nextRunAt;
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
    const today = dateOnly(now);
    const due: string[] = [];
    for (const task of this.tasks) {
      if (!task.enabled || this.running.has(task.id)) continue;
      if (task.lastSuccessDate === today) continue;
      if (task.nextRunAt && now.getTime() > new Date(task.nextRunAt).getTime()) {
        due.push(task.id);
      }
    }
    for (const id of due) void this.runTask(id);
  }

  private async runTask(taskID: string): Promise<void> {
    const release = await this.mu.acquire();
    let prompt = '';
    let model = '';
    let taskName = '';
    try {
      const task = this.tasks.find((t) => t.id === taskID);
      if (!task || this.running.has(taskID)) return;
      this.running.add(taskID);
      task.status = 'running';
      prompt = task.prompt;
      model = task.model;
      taskName = task.name;
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

    const args = ['--dangerously-skip-permissions', '-p', `"${prompt}"`];
    if (model) args.push('--model', model);

    let runErr: string | null = null;
    let stdout = '';
    let stderr = '';
    try {
      const result = await this.deps.runner.run('claude', args, { stripClaudeCode: true });
      stdout = result.stdout;
      stderr = result.stderr;
      if (result.code !== 0) {
        runErr = stderr.trim() || `exit ${result.code}`;
      }
    } catch (err) {
      runErr = (err as Error).message;
    }

    const logContent =
      `=== Task: ${taskName} ===\n=== Start: ${startTime.toISOString()} ===\n\n` +
      `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
    try {
      await fsp.writeFile(logFile, logContent);
    } catch {
      /* swallow */
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
        if (finished.success) task.lastSuccessDate = dateOnly(endTime);
        this.running.delete(taskID);
        if (task.enabled) {
          task.status = 'scheduled';
          if (task.mustSucceedDaily && !finished.success && this.todayHasTime(task)) {
            const retry = new Date(endTime.getTime() + 30 * 60 * 1000);
            task.nextRunAt = retry.toISOString();
          } else {
            recalcNextRun(task);
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

  private todayHasTime(task: ScheduledTask): boolean {
    if (!task.scheduleTime) return false;
    const now = new Date();
    const scheduledToday = parseScheduleTime(task.scheduleTime, now);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 0);
    return now.getTime() + 35 * 60 * 1000 < endOfDay.getTime() && scheduledToday < endOfDay;
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
    if (history.length > 100) history = history.slice(history.length - 100);
    await fsp.mkdir(path.dirname(this.historyFile(taskID)), { recursive: true });
    await fsp.writeFile(this.historyFile(taskID), JSON.stringify(history, null, 2));
  }
}

export function _testFsExists(p: string): boolean {
  return fs.existsSync(p);
}
