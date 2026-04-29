import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StateStore } from './state.js';

export interface SpawnSpec {
  cmd: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stripClaudeCode?: boolean;
}

export interface ProcessStatus {
  running: boolean;
  pid?: number;
  startedAt?: number;
  uptimeMs?: number;
  command?: string;
  args?: string[];
  logPath?: string;
}

export class ProcessManager {
  constructor(private store: StateStore, private logsDir: string) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  logPathFor(name: string): string {
    return path.join(this.logsDir, `${name}.log`);
  }

  async spawn(name: string, spec: SpawnSpec): Promise<{ pid: number }> {
    if (this.status(name).running) {
      throw new Error(`process ${name} already running`);
    }
    const env = { ...process.env, ...spec.env };
    if (spec.stripClaudeCode) delete env.CLAUDECODE;
    const logFile = this.logPathFor(name);
    const fd = fs.openSync(logFile, 'a');
    const args = spec.args ?? [];
    const child = spawn(spec.cmd, args, {
      cwd: spec.cwd,
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    const pid = child.pid!;
    this.store.set(name, {
      pid,
      startedAt: Date.now(),
      command: spec.cmd,
      args: [...args],
      logPath: logFile,
    });
    return { pid };
  }

  status(name: string): ProcessStatus {
    const s = this.store.get(name);
    if (!s) return { running: false };
    if (!isAlive(s.pid)) {
      this.store.delete(name);
      return { running: false };
    }
    return {
      running: true,
      pid: s.pid,
      startedAt: s.startedAt,
      uptimeMs: Date.now() - s.startedAt,
      command: s.command,
      args: [...s.args],
      logPath: s.logPath,
    };
  }

  async stop(name: string, timeoutMs = 3000): Promise<void> {
    const s = this.store.get(name);
    if (!s || !isAlive(s.pid)) {
      this.store.delete(name);
      return;
    }
    try { process.kill(s.pid, 'SIGTERM'); } catch {}
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isAlive(s.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isAlive(s.pid)) {
      try { process.kill(s.pid, 'SIGKILL'); } catch {}
    }
    this.store.delete(name);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
