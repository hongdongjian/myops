import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stripClaudeCode?: boolean;
  timeoutMs?: number;
  input?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class Runner {
  async run(cmd: string, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
    const env = { ...process.env, ...opts.env };
    if (opts.stripClaudeCode) delete env.CLAUDECODE;
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env, shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => (stdout += b.toString()));
      child.stderr.on('data', (b) => (stderr += b.toString()));
      const timer = opts.timeoutMs
        ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
        : null;
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? -1 });
      });
      if (opts.input) {
        child.stdin.end(opts.input);
      }
    });
  }
}
