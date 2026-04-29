import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';
import type {
  CloudreveConfig,
  CloudreveSyncTask,
  CloudreveExecution,
  CloudreverPolicy,
  CloudreverUser,
} from './schema.js';

const DEFAULT_CONFIG: CloudreveConfig = { baseUrl: '', email: '', password: '' };

export class CloudreveService {
  private readonly dataDir: string;
  private config: CloudreveConfig = DEFAULT_CONFIG;
  private tasks: CloudreveSyncTask[] = [];
  private executions: CloudreveExecution[] = [];
  private readonly running = new Set<string>();
  private readonly mu = new Mutex();
  private loaded = false;

  constructor(private readonly deps: Deps) {
    this.dataDir = deps.paths.dataPath('cloudreve');
  }

  async start(): Promise<void> {
    if (this.loaded) return;
    await fsp.mkdir(this.dataDir, { recursive: true });
    this.config = await this.readJson<CloudreveConfig>('config.json', DEFAULT_CONFIG);
    this.tasks = await this.readJson<CloudreveSyncTask[]>('tasks.json', []);
    this.executions = await this.readJson<CloudreveExecution[]>('executions.json', []);
    this.loaded = true;
  }

  getConfig(): CloudreveConfig {
    return { ...this.config };
  }

  async saveConfig(cfg: CloudreveConfig): Promise<void> {
    this.config = { ...cfg };
    await this.writeJson('config.json', this.config);
  }

  listTasks(): CloudreveSyncTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  listExecutions(taskId: string): CloudreveExecution[] {
    return this.executions.filter((e) => e.taskId === taskId).map((e) => ({ ...e }));
  }

  async createTask(input: Omit<CloudreveSyncTask, 'id' | 'status' | 'lastRunAt' | 'errorMsg'>): Promise<CloudreveSyncTask> {
    const task: CloudreveSyncTask = { ...input, id: randomUUID(), status: 'idle' };
    this.tasks = [...this.tasks, task];
    await this.persistTasks();
    return { ...task };
  }

  async updateTask(updated: CloudreveSyncTask): Promise<void> {
    const idx = this.tasks.findIndex((t) => t.id === updated.id);
    if (idx < 0) throw new AppError('NOT_FOUND', `task not found: ${updated.id}`, 404);
    const prior = this.tasks[idx]!;
    const next: CloudreveSyncTask = {
      ...updated,
      status: prior.status,
      lastRunAt: prior.lastRunAt,
      errorMsg: prior.errorMsg,
    };
    this.tasks = this.tasks.map((t, i) => (i === idx ? next : t));
    await this.persistTasks();
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    await this.persistTasks();
  }

  async runTask(id: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new AppError('NOT_FOUND', `task not found: ${id}`, 404);
    if (this.running.has(id)) {
      throw new AppError('TASK_BUSY', '任务正在运行中', 409);
    }
    this.running.add(id);
    void this.executeTask(id).finally(() => this.running.delete(id));
  }

  // ── execution ───────────────────────────────────────────────────────────

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const cfg = this.config;

    const exec: CloudreveExecution = {
      id: randomUUID(),
      taskId,
      startedAt: new Date().toISOString(),
      success: false,
    };
    this.executions = [exec, ...this.executions].slice(0, 100);
    await this.persistExecutions();

    await this.setTaskStatus(taskId, 'running', '');

    let token: string;
    try {
      token = await login(cfg);
    } catch (err) {
      const msg = `登录失败: ${(err as Error).message}`;
      await this.finishExecution(exec, false, msg);
      await this.setTaskStatus(taskId, 'failed', msg);
      return;
    }

    let userHashId = task.userHashId;
    if (!userHashId) {
      try {
        userHashId = await getMyHashId(cfg.baseUrl, token);
      } catch (err) {
        const msg = `获取用户信息失败: ${(err as Error).message}`;
        await this.finishExecution(exec, false, msg);
        await this.setTaskStatus(taskId, 'failed', msg);
        return;
      }
    }

    try {
      const cloudTaskId = await callImport(
        cfg.baseUrl,
        token,
        task.src,
        task.dstPath,
        task.policyId,
        userHashId,
        task.recursive,
        task.extractMediaMeta,
      );
      exec.cloudTaskId = cloudTaskId;
      await this.finishExecution(exec, true, '');
      await this.setTaskStatus(taskId, 'success', '');
    } catch (err) {
      const msg = (err as Error).message;
      await this.finishExecution(exec, false, msg);
      await this.setTaskStatus(taskId, 'failed', msg);
    }
  }

  private async setTaskStatus(taskId: string, status: string, errMsg: string): Promise<void> {
    const release = await this.mu.acquire();
    try {
      const idx = this.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return;
      const next: CloudreveSyncTask = {
        ...this.tasks[idx]!,
        status,
        lastRunAt: new Date().toISOString(),
        errorMsg: errMsg,
      };
      this.tasks = this.tasks.map((t, i) => (i === idx ? next : t));
    } finally {
      release();
    }
    await this.persistTasks();
  }

  private async finishExecution(exec: CloudreveExecution, success: boolean, errMsg: string): Promise<void> {
    const idx = this.executions.findIndex((e) => e.id === exec.id);
    if (idx < 0) return;
    const updated: CloudreveExecution = {
      ...this.executions[idx]!,
      cloudTaskId: exec.cloudTaskId,
      finishedAt: new Date().toISOString(),
      success,
      errorMsg: errMsg,
    };
    this.executions = this.executions.map((e, i) => (i === idx ? updated : e));
    await this.persistExecutions();
  }

  // ── connection helpers ──────────────────────────────────────────────────

  async testConnection(cfg: CloudreveConfig): Promise<string> {
    const token = await login(cfg);
    return getMyHashId(cfg.baseUrl, token);
  }

  async fetchPolicies(cfg: CloudreveConfig): Promise<CloudreverPolicy[]> {
    const token = await login(cfg);
    const data = await cloudreveFetch(cfg.baseUrl + '/api/v4/admin/policy', {
      method: 'POST',
      token,
      body: { page: 1, page_size: 100 },
    });
    const policies = ((data as any)?.data?.policies ?? []) as Array<{ id: number; name: string; type: string }>;
    return policies.map((p) => ({ id: String(p.id), name: p.name, type: p.type }));
  }

  async fetchUsers(cfg: CloudreveConfig): Promise<CloudreverUser[]> {
    const token = await login(cfg);
    const data = await cloudreveFetch(cfg.baseUrl + '/api/v4/admin/user', {
      method: 'POST',
      token,
      body: { page: 1, page_size: 100 },
    });
    const users = ((data as any)?.data?.users ?? []) as Array<{ hash_id: string; email: string; nick: string }>;
    return users.map((u) => ({ hashId: u.hash_id, email: u.email, nick: u.nick }));
  }

  // ── persistence ──────────────────────────────────────────────────────────

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try {
      const raw = await fsp.readFile(path.join(this.dataDir, name), 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw err;
    }
  }

  private async writeJson(name: string, data: unknown): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.writeFile(path.join(this.dataDir, name), JSON.stringify(data, null, 2));
  }

  private persistTasks(): Promise<void> {
    return this.writeJson('tasks.json', this.tasks);
  }

  private persistExecutions(): Promise<void> {
    return this.writeJson('executions.json', this.executions);
  }
}

// ── Cloudreve API helpers ────────────────────────────────────────────────────

export async function login(cfg: CloudreveConfig): Promise<string> {
  const res = await fetch(cfg.baseUrl + '/api/v4/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`登录失败 (HTTP ${res.status}): ${txt}`);
  }
  const json = (await res.json()) as { data?: { token?: { access_token?: string } } };
  const token = json.data?.token?.access_token;
  if (!token) throw new Error('登录成功但未获取到访问令牌，请检查 Cloudreve 版本');
  return token;
}

export async function getMyHashId(baseUrl: string, token: string): Promise<string> {
  const data = await cloudreveFetch(baseUrl + '/api/v4/user/me', { method: 'GET', token });
  const id = (data as any)?.data?.id;
  if (!id) throw new Error('未能获取用户哈希 ID');
  return String(id);
}

export async function callImport(
  baseUrl: string,
  token: string,
  src: string,
  dstPath: string,
  policyId: string,
  userId: string,
  recursive: boolean,
  extractMedia: boolean,
): Promise<string> {
  const policyIdInt = Number.parseInt(policyId, 10);
  if (Number.isNaN(policyIdInt)) {
    throw new Error(`无效的存储策略 ID "${policyId}"`);
  }
  const data = await cloudreveFetch(baseUrl + '/api/v4/workflow/import', {
    method: 'POST',
    token,
    body: {
      src,
      dst: dstPath,
      policy_id: policyIdInt,
      user_id: userId,
      recursive,
      extract_media_meta: extractMedia,
    },
  }, '导入失败');
  return String((data as any)?.data?.id ?? '');
}

interface FetchOpts {
  method: 'GET' | 'POST';
  token: string;
  body?: unknown;
}

async function cloudreveFetch(url: string, opts: FetchOpts, errPrefix = '请求失败'): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method: opts.method, headers, body });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${errPrefix} (HTTP ${res.status}): ${txt}`);
  }
  return res.json();
}
