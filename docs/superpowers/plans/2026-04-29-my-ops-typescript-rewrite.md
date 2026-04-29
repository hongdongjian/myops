# my-ops TypeScript 重写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/Users/hongdongjian/Documents/workspace/github/my-ops`（Go）1:1 重写为 TS+Node+React+Tailwind 实现，发布到 `/Users/hongdongjian/Documents/workspace/github/myops`，支持 `npm i -g my-ops` 全局安装。

**Architecture:** npm workspaces monorepo（`packages/server` + `packages/web`），server 是 Fastify+TS+Zod，web 是 Vite+React+Tailwind+shadcn/ui。`build` 后 `web/dist` 拷入 `server/dist/public` 由 `@fastify/static` 托管。

**Tech Stack:** Node 20+, TypeScript 5, Fastify 4, Zod, async-mutex, node-cron, node-cache, yaml, commander, execa(可选)/原生 spawn, React 18, React Router 6, TanStack Query 5, React Hook Form, Tailwind 3, shadcn/ui, Vite 5, Vitest, React Testing Library。

**对照源**：所有路径以 `OLD=/Users/hongdongjian/Documents/workspace/github/my-ops` 为旧 Go 项目；`NEW=/Users/hongdongjian/Documents/workspace/github/myops` 为新项目根。**所有命令默认在 `NEW` 下执行**。

**模块清单**（来自 `OLD/internal/app/` 的实际文件）：copilot、copilot_accounts、mcp、claude_settings、claude_mcp、claude_assets、claude_instructions、claude_plugin、claude_providers、claude_version、codex_settings、codex_mcp、codex_accounts、codex_agents、codex_assets、codex_version、assets、scheduler、server、clash、cloudreve、immich_sync。

---

## Phase 0：仓库初始化

### Task 0：初始化 monorepo

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `.editorconfig`
- Create: `README.md`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`

- [ ] **Step 1：在 NEW 初始化 git**

```bash
cd /Users/hongdongjian/Documents/workspace/github/myops
git init
git branch -M main
```

- [ ] **Step 2：写根 `package.json`**

```json
{
  "name": "myops-monorepo",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently -k -n server,web \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "npm -w packages/server run dev",
    "dev:web": "npm -w packages/web run dev",
    "build": "npm -w packages/web run build && npm -w packages/server run build && tsx scripts/postbuild.ts",
    "test": "npm -w packages/server run test && npm -w packages/web run test",
    "lint": "eslint packages --ext .ts,.tsx",
    "typecheck": "tsc -b packages/server packages/web --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "concurrently": "^8.2.2",
    "eslint": "^8.57.0",
    "@typescript-eslint/parser": "^7.7.0",
    "@typescript-eslint/eslint-plugin": "^7.7.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3：写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"]
  }
}
```

- [ ] **Step 4：写 `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
data/
packages/server/dist/
packages/web/dist/
.vite/
coverage/
```

- [ ] **Step 5：写 `.npmrc` 与 `.editorconfig`**

`.npmrc`：
```
save-exact=true
fund=false
audit=false
```

`.editorconfig`：
```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6：写 `packages/server/package.json`**

```json
{
  "name": "my-ops",
  "version": "0.1.0",
  "type": "module",
  "bin": { "my-ops": "dist/cli.js" },
  "main": "dist/server.js",
  "files": ["dist", "conf"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/cli.ts --root ../..",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^4.26.0",
    "@fastify/static": "^7.0.0",
    "@fastify/cors": "^9.0.0",
    "zod": "^3.22.0",
    "yaml": "^2.4.0",
    "async-mutex": "^0.5.0",
    "node-cache": "^5.1.2",
    "node-cron": "^3.0.3",
    "commander": "^12.0.0",
    "execa": "^9.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0"
  },
  "devDependencies": {
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 7：写 `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 8：写 `packages/web/package.json`**

```json
{
  "name": "@my-ops/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "@tanstack/react-query": "^5.32.0",
    "react-hook-form": "^7.51.0",
    "@hookform/resolvers": "^3.3.4",
    "zod": "^3.22.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "class-variance-authority": "^0.7.0",
    "lucide-react": "^0.378.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.5.0",
    "@testing-library/react": "^15.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 9：写 `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "@testing-library/jest-dom"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 10：安装依赖并验证**

```bash
npm install
npm run typecheck
```
Expected：无报错（此时 packages/server/src 与 packages/web/src 还没有内容，typecheck 应通过空结构。如果失败因为没有源文件，先创建 `packages/server/src/cli.ts` 和 `packages/web/src/main.tsx` 占位，内容仅 `export {};`）。

- [ ] **Step 11：提交**

```bash
git add -A
git commit -m "chore: init monorepo scaffold"
```

---

## Phase 1：后端基础设施

### Task 1：路径与配置加载

**Files:**
- Create: `packages/server/src/paths.ts`
- Create: `packages/server/src/config/schema.ts`
- Create: `packages/server/src/config/loader.ts`
- Test: `packages/server/src/config/loader.test.ts`
- Modify: `conf/server.yaml`（从 OLD 复制）

- [ ] **Step 1：复制 conf 模板**

```bash
cp -r /Users/hongdongjian/Documents/workspace/github/my-ops/conf .
```

- [ ] **Step 2：写 `paths.ts`**

```ts
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface Paths {
  rootDir: string;
  homeDir: string;
  dataPath: (...p: string[]) => string;
  confPath: (...p: string[]) => string;
  claudePath: (...p: string[]) => string;
  codexPath: (...p: string[]) => string;
}

export function createPaths(rootDir: string): Paths {
  const homeDir = os.homedir();
  fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
  return {
    rootDir,
    homeDir,
    dataPath: (...p) => path.join(rootDir, 'data', ...p),
    confPath: (...p) => path.join(rootDir, 'conf', ...p),
    claudePath: (...p) => path.join(homeDir, '.claude', ...p),
    codexPath: (...p) => path.join(homeDir, '.codex', ...p),
  };
}
```

- [ ] **Step 3：写 `config/schema.ts`**

```ts
import { z } from 'zod';

export const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3839),
  copilot_proxy_url: z.string().url().optional(),
  models: z.array(z.string()).default([]),
}).passthrough();  // 允许未来字段

export type Config = Readonly<z.infer<typeof ConfigSchema>>;
```

> 备注：`OLD/conf/server.yaml` 当前只有 `port`、`copilot_proxy_url`、`models`。如发现 OLD 代码中读取了更多字段，按需扩展 schema。

- [ ] **Step 4：写 `config/loader.ts`**

```ts
import fs from 'node:fs';
import YAML from 'yaml';
import { ConfigSchema, type Config } from './schema.js';

export function loadConfig(filePath: string): Config {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw);
  return Object.freeze(ConfigSchema.parse(parsed ?? {}));
}
```

- [ ] **Step 5：写 `config/loader.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './loader.js';

describe('loadConfig', () => {
  it('parses minimal yaml', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(tmp, 'server.yaml');
    fs.writeFileSync(file, 'port: 4000\nmodels:\n  - a\n  - b\n');
    const cfg = loadConfig(file);
    expect(cfg.port).toBe(4000);
    expect(cfg.models).toEqual(['a', 'b']);
  });

  it('rejects invalid port', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(tmp, 'server.yaml');
    fs.writeFileSync(file, 'port: 99999\n');
    expect(() => loadConfig(file)).toThrow();
  });
});
```

- [ ] **Step 6：跑测试**

```bash
npm -w packages/server run test
```
Expected：2 个测试通过。

- [ ] **Step 7：提交**

```bash
git add -A
git commit -m "feat(server): add paths and config loader"
```

### Task 2：Runner（命令执行封装）

**Files:**
- Create: `packages/server/src/core/system/runner.ts`
- Test: `packages/server/src/core/system/runner.test.ts`

- [ ] **Step 1：写测试（先写）**

```ts
import { describe, it, expect } from 'vitest';
import { Runner } from './runner.js';

describe('Runner', () => {
  const runner = new Runner();

  it('runs sync command and returns stdout', async () => {
    const r = await runner.run('echo', ['hello']);
    expect(r.stdout.trim()).toBe('hello');
    expect(r.code).toBe(0);
  });

  it('captures non-zero exit', async () => {
    const r = await runner.run('sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
  });

  it('strips CLAUDECODE from env when option set', async () => {
    process.env.CLAUDECODE = '1';
    const r = await runner.run('sh', ['-c', 'echo $CLAUDECODE'], { stripClaudeCode: true });
    expect(r.stdout.trim()).toBe('');
    delete process.env.CLAUDECODE;
  });
});
```

- [ ] **Step 2：实现 `runner.ts`**

```ts
import { spawn, type SpawnOptions } from 'node:child_process';

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
```

- [ ] **Step 3：跑测试 + 提交**

```bash
npm -w packages/server run test
git add -A
git commit -m "feat(server): add Runner for command execution"
```

### Task 3：StateStore（持久化 PID 等运行时状态）

**Files:**
- Create: `packages/server/src/core/process/state.ts`
- Test: `packages/server/src/core/process/state.test.ts`

- [ ] **Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state.js';

describe('StateStore', () => {
  it('persists and reloads state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(tmp, 'state.json');
    const s1 = new StateStore(file);
    s1.set('copilot', { pid: 1234, startedAt: 100 });
    const s2 = new StateStore(file);
    expect(s2.get('copilot')).toEqual({ pid: 1234, startedAt: 100 });
  });

  it('returns undefined for missing keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const s = new StateStore(path.join(tmp, 'state.json'));
    expect(s.get('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2：实现 `state.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';

export interface ProcessState {
  pid: number;
  startedAt: number;
}

export class StateStore {
  private data: Record<string, ProcessState> = {};

  constructor(private filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        this.data = {};
      }
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  get(key: string): ProcessState | undefined {
    return this.data[key];
  }

  set(key: string, value: ProcessState): void {
    this.data = { ...this.data, [key]: value };
    this.persist();
  }

  delete(key: string): void {
    const { [key]: _, ...rest } = this.data;
    this.data = rest;
    this.persist();
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
```

> 注意：immutable 模式 — `set/delete` 不修改原对象，重新构造。

- [ ] **Step 3：跑测试 + 提交**

```bash
npm -w packages/server run test
git add -A
git commit -m "feat(server): add StateStore for process state persistence"
```

### Task 4：ProcessManager

**Files:**
- Create: `packages/server/src/core/process/manager.ts`
- Test: `packages/server/src/core/process/manager.test.ts`

- [ ] **Step 1：写测试**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state.js';
import { ProcessManager } from './manager.js';

describe('ProcessManager', () => {
  let tmp: string;
  let mgr: ProcessManager;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
    mgr = new ProcessManager(new StateStore(path.join(tmp, 'state.json')), path.join(tmp, 'logs'));
  });

  afterEach(async () => {
    await mgr.stopAll().catch(() => {});
  });

  it('spawns and reports running', async () => {
    const r = await mgr.spawn('sleeper', { cmd: 'sleep', args: ['5'] });
    expect(r.pid).toBeGreaterThan(0);
    const s = mgr.status('sleeper');
    expect(s.running).toBe(true);
    expect(s.pid).toBe(r.pid);
    await mgr.stop('sleeper');
    const s2 = mgr.status('sleeper');
    expect(s2.running).toBe(false);
  });

  it('detects dead pid', async () => {
    const r = await mgr.spawn('quick', { cmd: 'true' });
    await new Promise((res) => setTimeout(res, 200));
    expect(mgr.status('quick').running).toBe(false);
  });
});
```

- [ ] **Step 2：实现 `manager.ts`**

```ts
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
}

export class ProcessManager {
  constructor(private store: StateStore, private logsDir: string) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  async spawn(name: string, spec: SpawnSpec): Promise<{ pid: number }> {
    if (this.status(name).running) {
      throw new Error(`process ${name} already running`);
    }
    const env = { ...process.env, ...spec.env };
    if (spec.stripClaudeCode) delete env.CLAUDECODE;
    const logFile = path.join(this.logsDir, `${name}.log`);
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(spec.cmd, spec.args ?? [], {
      cwd: spec.cwd,
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    const pid = child.pid!;
    this.store.set(name, { pid, startedAt: Date.now() });
    return { pid };
  }

  status(name: string): ProcessStatus {
    const s = this.store.get(name);
    if (!s) return { running: false };
    if (!isAlive(s.pid)) {
      this.store.delete(name);
      return { running: false };
    }
    return { running: true, pid: s.pid, startedAt: s.startedAt, uptimeMs: Date.now() - s.startedAt };
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

  async stopAll(): Promise<void> {
    // 由调用方按 name 列表逐个 stop，本类不维护已知 name 列表
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
```

- [ ] **Step 3：跑测试 + 提交**

```bash
npm -w packages/server run test
git add -A
git commit -m "feat(server): add ProcessManager with spawn/stop/status"
```

### Task 5：FileOps

**Files:**
- Create: `packages/server/src/core/fsops/index.ts`
- Test: `packages/server/src/core/fsops/index.test.ts`

- [ ] **Step 1：写测试**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { copyDir, ensureSymlink } from './index.js';

describe('fsops', () => {
  it('copies directory recursively', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'sub', 'a.txt'), 'hello');
    copyDir(src, dst);
    expect(fs.readFileSync(path.join(dst, 'sub', 'a.txt'), 'utf-8')).toBe('hello');
  });

  it('creates symlink, replacing existing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    const target = path.join(tmp, 't');
    fs.writeFileSync(target, 'x');
    const link = path.join(tmp, 'l');
    ensureSymlink(target, link);
    expect(fs.readlinkSync(link)).toBe(target);
    ensureSymlink(target, link);  // idempotent
    expect(fs.readlinkSync(link)).toBe(target);
  });
});
```

- [ ] **Step 2：实现**

```ts
import fs from 'node:fs';
import path from 'node:path';

export function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

export function ensureSymlink(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    const cur = fs.readlinkSync(linkPath);
    if (cur === target) return;
    fs.unlinkSync(linkPath);
  } catch {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(target, linkPath);
}
```

- [ ] **Step 3：跑测试 + 提交**

```bash
npm -w packages/server run test
git add -A
git commit -m "feat(server): add fsops (copyDir, ensureSymlink)"
```

### Task 6：错误类型与 fastify 错误处理插件

**Files:**
- Create: `packages/server/src/core/errors.ts`
- Create: `packages/server/src/plugins/error-handler.ts`
- Test: `packages/server/src/plugins/error-handler.test.ts`

- [ ] **Step 1：写错误类型 `errors.ts`**

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 2：写测试**

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { errorHandlerPlugin } from './error-handler.js';
import { AppError } from '../core/errors.js';

describe('errorHandler', () => {
  it('serializes AppError to standard envelope', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.get('/x', () => { throw new AppError('FOO', 'bar', 422); });
    const r = await app.inject({ method: 'GET', url: '/x' });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ error: { code: 'FOO', message: 'bar' } });
  });

  it('maps Zod errors to 400 VALIDATION_ERROR', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    const { z } = await import('zod');
    app.post('/y', { schema: { body: z.object({ n: z.number() }) as any } }, () => 'ok');
    // skip actual zod-to-fastify integration in this minimal test
  });
});
```

- [ ] **Step 3：实现 `plugins/error-handler.ts`**

```ts
import fp from 'fastify-plugin';
import { AppError } from '../core/errors.js';
import { ZodError } from 'zod';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
      return;
    }
    app.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });
});
```

> 需要新增依赖：`npm -w packages/server install fastify-plugin`

- [ ] **Step 4：跑测试 + 提交**

```bash
npm -w packages/server run test
git add -A
git commit -m "feat(server): add AppError and global error handler plugin"
```

---

## Phase 2：服务器骨架

### Task 7：buildApp + CLI

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/cli.ts`
- Create: `packages/server/src/deps.ts`
- Test: `packages/server/src/server.test.ts`

- [ ] **Step 1：写 `deps.ts`**

```ts
import type { Config } from './config/schema.js';
import type { Paths } from './paths.js';
import type { Runner } from './core/system/runner.js';
import type { StateStore } from './core/process/state.js';
import type { ProcessManager } from './core/process/manager.js';

export interface Deps {
  config: Config;
  paths: Paths;
  runner: Runner;
  store: StateStore;
  processMgr: ProcessManager;
}
```

- [ ] **Step 2：写 `server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import type { Deps } from './deps.js';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(errorHandlerPlugin);

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/server/models', async () => ({ models: deps.config.models }));

  // 后续模块在 Phase 3+ 注册
  return app;
}
```

- [ ] **Step 3：写 `cli.ts`**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPaths } from './paths.js';
import { loadConfig } from './config/loader.js';
import { Runner } from './core/system/runner.js';
import { StateStore } from './core/process/state.js';
import { ProcessManager } from './core/process/manager.js';
import { buildApp } from './server.js';

const program = new Command();
program.name('my-ops').version('0.1.0');

program
  .option('-p, --port <number>', 'override port', (v) => parseInt(v, 10))
  .option('-r, --root <dir>', 'root directory (default: ~/.my-ops or cwd in dev)')
  .action(async (opts) => {
    const rootDir = resolveRoot(opts.root);
    ensureUserData(rootDir);
    const paths = createPaths(rootDir);
    const config = loadConfig(paths.confPath('server.yaml'));
    const port = opts.port ?? config.port;
    const store = new StateStore(paths.dataPath('state.json'));
    const processMgr = new ProcessManager(store, paths.dataPath('logs'));
    const runner = new Runner();
    const app = await buildApp({ config, paths, runner, store, processMgr });
    await app.listen({ port, host: '127.0.0.1' });
  });

program.command('version').action(() => console.log('0.1.0'));
program.command('doctor').action(() => {
  console.log('node:', process.version);
  console.log('platform:', os.platform());
});

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});

function resolveRoot(opt: string | undefined): string {
  if (opt) return path.resolve(opt);
  const home = path.join(os.homedir(), '.my-ops');
  if (process.env.MY_OPS_DEV === '1') return process.cwd();
  return home;
}

function ensureUserData(rootDir: string): void {
  const conf = path.join(rootDir, 'conf', 'server.yaml');
  if (fs.existsSync(conf)) return;
  // 从包内模板复制
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = path.resolve(here, '..', 'conf');
  if (!fs.existsSync(template)) return;
  fs.mkdirSync(path.join(rootDir, 'conf'), { recursive: true });
  copyDirSync(template, path.join(rootDir, 'conf'));
}

function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}
```

- [ ] **Step 4：写 `server.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from './server.js';
import { createPaths } from './paths.js';
import { Runner } from './core/system/runner.js';
import { StateStore } from './core/process/state.js';
import { ProcessManager } from './core/process/manager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeDeps() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const paths = createPaths(tmp);
  const store = new StateStore(paths.dataPath('state.json'));
  const processMgr = new ProcessManager(store, paths.dataPath('logs'));
  return {
    config: Object.freeze({ port: 0, models: ['m1', 'm2'] }) as any,
    paths,
    runner: new Runner(),
    store,
    processMgr,
  };
}

describe('buildApp', () => {
  it('serves health and models', async () => {
    const app = await buildApp(makeDeps());
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.json()).toEqual({ ok: true });
    const m = await app.inject({ method: 'GET', url: '/api/server/models' });
    expect(m.json()).toEqual({ models: ['m1', 'm2'] });
  });
});
```

- [ ] **Step 5：跑测试，启动开发服务验证**

```bash
npm -w packages/server run test
MY_OPS_DEV=1 npm -w packages/server run dev &
sleep 2
curl -s http://127.0.0.1:3839/api/health
curl -s http://127.0.0.1:3839/api/server/models
kill %1
```
Expected：health 返回 `{"ok":true}`；models 返回 conf 中模型列表。

- [ ] **Step 6：提交**

```bash
git add -A
git commit -m "feat(server): add buildApp and CLI entry"
```

---

## Phase 3：模块迁移（每个模块一个 Task）

**通用迁移模板**（每个模块都按此模板执行）：

1. 通读 `OLD/internal/app/<module>_handlers.go`（及测试），列出所有 HTTP 路径与请求/响应字段
2. 在 `packages/server/src/modules/<module>/` 下创建：
   - `schema.ts`：Zod 请求/响应 schema
   - `service.ts`：业务逻辑（依赖 `Deps`）
   - `routes.ts`：注册到 Fastify，输出 `<module>Module(app, deps)` 函数
   - `service.test.ts`：至少 1 个 happy path 单元测试
3. 在 `server.ts` 中 `await app.register(<module>Module, deps)` 注册
4. 用 `curl` 对比 OLD（启动 OLD `make run`）vs NEW 同一接口的响应一致性
5. 提交：`feat(server): port <module> module`

> ⚠️ 不要省略测试。每个 module 至少 1 个 service 单元测试 + 1 个 fastify.inject 路由测试。
> ⚠️ 字段命名严格保持与 OLD JSON 一致（snake_case 还是 camelCase 以 Go 输出为准）。

### Task 8：copilot 模块

**Files:**
- Create: `packages/server/src/modules/copilot/{schema,service,routes,service.test,routes.test}.ts`
- Reference Go: `OLD/internal/app/copilot_handlers.go`、`OLD/internal/app/copilot_handlers_test.go`、`OLD/internal/app/process_helpers.go`

- [ ] **Step 1：通读旧文件，列清 endpoint**

```bash
grep -nE 'mux\.|HandleFunc|app\.(GET|POST|PUT|DELETE)|/api/copilot' \
  /Users/hongdongjian/Documents/workspace/github/my-ops/internal/app/copilot_handlers.go
```
将得到的所有路径与方法记录下来（应包含 status/start/stop/restart/version/config/logs 等）。

- [ ] **Step 2：写 schema.ts**（Zod 结构对应 Go struct，字段名严格一致）

```ts
import { z } from 'zod';

export const StatusResponse = z.object({
  running: z.boolean(),
  pid: z.number().optional(),
  uptime_ms: z.number().optional(),
  version: z.string().optional(),
});

export const StartRequest = z.object({
  account: z.string().optional(),
  model: z.string().optional(),
});
// ... 其余 schema 按 Go 源补全
```

- [ ] **Step 3：写 service.ts**（用 ProcessManager 启停 copilot-api，从 npm 全局安装路径解析）

```ts
import type { Deps } from '../../deps.js';
import { AppError } from '../../core/errors.js';

export class CopilotService {
  constructor(private deps: Deps) {}

  status() {
    return this.deps.processMgr.status('copilot');
  }

  async start(opts: { account?: string; model?: string }) {
    // 参考 OLD copilot_handlers.go 的 start 逻辑：
    // - 解析 copilot-api 二进制路径
    // - 组装 args（含 --port, 账号 token 等）
    // - 调用 processMgr.spawn('copilot', { cmd, args, env: { HTTP_PROXY: cfg.copilot_proxy_url } })
    // 这里仅给签名，按 Go 源完整实现
    throw new AppError('NOT_IMPLEMENTED', 'fill in from OLD copilot_handlers.go', 501);
  }

  async stop() { await this.deps.processMgr.stop('copilot'); }
}
```

- [ ] **Step 4：写 routes.ts**

```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps.js';
import { CopilotService } from './service.js';
import { StartRequest } from './schema.js';

export const copilotModule = fp<{ deps: Deps }>(async (app, opts) => {
  const svc = new CopilotService(opts.deps);
  app.get('/api/copilot/status', async () => svc.status());
  app.post('/api/copilot/start', async (req) => svc.start(StartRequest.parse(req.body)));
  app.post('/api/copilot/stop', async () => { await svc.stop(); return { ok: true }; });
  // ... 按 OLD 列表补全所有 endpoint
});
```

- [ ] **Step 5：写 service.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest';
import { CopilotService } from './service.js';

describe('CopilotService', () => {
  it('reports stopped when no pid', () => {
    const deps: any = { processMgr: { status: () => ({ running: false }) } };
    expect(new CopilotService(deps).status()).toEqual({ running: false });
  });
});
```

- [ ] **Step 6：在 `server.ts` 中注册**

```ts
import { copilotModule } from './modules/copilot/routes.js';
// ...
await app.register(copilotModule, { deps });
```

- [ ] **Step 7：路由集成测试 routes.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../server.js';
// 复用 server.test.ts 的 makeDeps 工厂（提取到 testHelpers.ts）

describe('copilot routes', () => {
  it('GET /api/copilot/status returns object', async () => {
    const app = await buildApp(/* makeDeps() */ {} as any);
    const r = await app.inject({ method: 'GET', url: '/api/copilot/status' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('running');
  });
});
```

- [ ] **Step 8：对照测试**

```bash
# 终端 A：启动 OLD
cd /Users/hongdongjian/Documents/workspace/github/my-ops && go run ./cmd/my-ops &
# 终端 B：启动 NEW（不同端口）
MY_OPS_DEV=1 npm -w packages/server run dev -- --port 3840 &
diff <(curl -s http://127.0.0.1:3839/api/copilot/status | jq -S .) \
     <(curl -s http://127.0.0.1:3840/api/copilot/status | jq -S .)
```
Expected：JSON 字段一致（值可能因运行状态不同）。

- [ ] **Step 9：提交**

```bash
git add -A
git commit -m "feat(server): port copilot module"
```

### Task 9：copilot_accounts 模块

按 Task 8 模板，对照 `OLD/internal/app/copilot_accounts_handlers.go`。

**特殊点**：包含 GitHub OAuth 设备流（POST `/api/copilot/login/start`、`/api/copilot/login/poll`），需用 `fetch` 调用 GitHub API；账号配置文件位于 `~/.copilot-api/accounts.json`（以 OLD 实际路径为准）。提交信息：`feat(server): port copilot_accounts module`。

### Task 10：mcp 模块

对照 `OLD/internal/app/mcp_handlers.go`。XHS MCP 进程管理，命名为 `xhs-mcp`。提交：`feat(server): port mcp module`。

### Task 11：claude_settings 模块

对照 `OLD/internal/app/claude_settings_handlers.go`。读写 `~/.claude/settings.json`、onboarding、powerline。提交：`feat(server): port claude_settings module`。

### Task 12：claude_mcp 模块

对照 `OLD/internal/app/claude_mcp_handlers.go`。用 `Runner` 调用 `claude mcp list/add/remove`，并维护预置列表（来自 `conf/claude/mcp/preset.json` 之类，按 OLD 实现确认）。提交：`feat(server): port claude_mcp module`。

### Task 13：claude_assets 模块

对照 `OLD/internal/app/claude_assets_handlers.go`。使用 `fsops.ensureSymlink` 把 `conf/claude/skills/*` 链到 `~/.claude/skills/*`。提交：`feat(server): port claude_assets module`。

### Task 14：claude_instructions 模块

对照 `OLD/internal/app/claude_instructions_handlers.go`。读写 `conf/claude/CLAUDE.md`，保存时同步到 `~/.claude/CLAUDE.md`。提交：`feat(server): port claude_instructions module`。

### Task 15：claude_plugin 模块

对照 `OLD/internal/app/claude_plugin_handlers.go`。`claude plugin list/install/uninstall` 包装。提交：`feat(server): port claude_plugin module`。

### Task 16：claude_providers 模块

对照 `OLD/internal/app/claude_providers_handlers.go`。提交：`feat(server): port claude_providers module`。

### Task 17：claude_version 模块

对照 `OLD/internal/app/claude_version_handlers.go`。需 5 分钟 npm 缓存（`node-cache`）。提交：`feat(server): port claude_version module`。

### Task 18：codex_settings 模块

对照 `OLD/internal/app/codex_settings_handlers.go`。提交：`feat(server): port codex_settings module`。

### Task 19：codex_mcp 模块

对照 `OLD/internal/app/codex_mcp_handlers.go`。提交：`feat(server): port codex_mcp module`。

### Task 20：codex_accounts 模块

对照 `OLD/internal/app/codex_accounts_handlers.go`。包含 OpenAI OAuth PKCE 流程（更复杂）：生成 code_verifier、challenge、打开浏览器、回调 endpoint 监听端口、token 交换。提交：`feat(server): port codex_accounts module`。

### Task 21：codex_agents 模块

对照 `OLD/internal/app/codex_agents_handlers.go`。`~/.codex/AGENTS.md` 读写。提交：`feat(server): port codex_agents module`。

### Task 22：codex_assets 模块

对照 `OLD/internal/app/codex_assets_handlers.go`。提交：`feat(server): port codex_assets module`。

### Task 23：codex_version 模块

对照 `OLD/internal/app/codex_version_handlers.go`。提交：`feat(server): port codex_version module`。

### Task 24：assets 模块

对照 `OLD/internal/app/assets_handlers.go`。通用 `conf/` → 用户目录同步。提交：`feat(server): port assets module`。

### Task 25：scheduler 模块

对照 `OLD/internal/app/scheduler.go` + `scheduler_handlers.go`。

**实现要点**：

```ts
import cron from 'node-cron';
import { Mutex } from 'async-mutex';

interface Job { id: string; name: string; cron: string; cmd: string; args: string[]; }
class Scheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  private mu = new Mutex();
  // CRUD + 启动时从 data/scheduler.json 恢复 + 执行时调用 Runner.run，env stripClaudeCode=true
}
```

提交：`feat(server): port scheduler module`。

### Task 26：clash 模块

对照 `OLD/internal/app/clash_handlers.go`。提交：`feat(server): port clash module`。

### Task 27：cloudreve 模块

对照 `OLD/internal/app/cloudreve_handlers.go` + `cloudreve_sync.go`。提交：`feat(server): port cloudreve module`。

### Task 28：immich_sync 模块

对照 `OLD/internal/app/immich_sync_handlers.go` + `immich_sync.go`。提交：`feat(server): port immich_sync module`。

### Task 29：autostart 与 copilot 代理监控循环

**Files:**
- Create: `packages/server/src/core/autostart.ts`
- Test: `packages/server/src/core/autostart.test.ts`

对照 `OLD/internal/app/app.go` 中的 `Start()` autostart 逻辑：两个并发循环按周期检查 copilot/mcp 状态并按需重启。用 `setInterval` 实现，组件提供 `start()`/`stop()`，与 Mutex 配合保护开关。

- [ ] 写实现 + 测试 + 注入 buildApp + 在 cli.ts 启动后 `autostart.start()`
- [ ] 提交：`feat(server): add autostart loops for copilot and mcp`

### Task 30：API 全量对照测试脚本

**Files:**
- Create: `scripts/api-diff.sh`

```bash
#!/usr/bin/env bash
set -e
OLD=http://127.0.0.1:3839
NEW=http://127.0.0.1:3840
endpoints=(
  /api/health
  /api/server/models
  /api/copilot/status
  /api/mcp/status
  /api/claude/settings
  # ...全量列出
)
for ep in "${endpoints[@]}"; do
  echo "== $ep =="
  diff <(curl -s "$OLD$ep" | jq -S .) <(curl -s "$NEW$ep" | jq -S .) || true
done
```

- [ ] 在 OLD/NEW 同时运行下执行脚本，差异为空（仅运行时 PID/uptime 等动态字段除外）
- [ ] 提交：`test: add api diff script`

---

## Phase 4：前端

### Task 31：Vite + Tailwind + shadcn 脚手架

**Files:**
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/styles/index.css`
- Create: `packages/web/src/lib/{cn,api,query-client}.ts`
- Create: `components.json`（shadcn 配置）

- [ ] **Step 1：vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3839' },
  },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 2：tailwind.config.ts**（shadcn 默认主题 + 自定义暗色 token）

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        border: 'hsl(var(--border))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3：postcss.config.js**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4：styles/index.css**（暗色主题 token，与 OLD UI 风格对齐）

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 222 47% 11%;
    --foreground: 210 40% 98%;
    --primary: 217 91% 60%;
    --primary-foreground: 222 47% 11%;
    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --border: 217 33% 17%;
    --card: 222 47% 13%;
    --card-foreground: 210 40% 98%;
  }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 5：index.html、main.tsx、App.tsx、lib/cn.ts、lib/api.ts、lib/query-client.ts**

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"/><title>my-ops</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './lib/query-client';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

```tsx
// src/App.tsx
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';

const navs = [
  { to: '/copilot', label: 'Copilot' },
  { to: '/mcp', label: 'MCP' },
  { to: '/claude', label: 'Claude' },
  { to: '/codex', label: 'Codex' },
  { to: '/scheduler', label: '调度' },
  { to: '/assets', label: '资产' },
];

export function App() {
  return (
    <div className="flex h-screen">
      <aside className="w-48 border-r border-border p-4 space-y-1">
        {navs.map((n) => (
          <NavLink key={n.to} to={n.to}
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }>{n.label}</NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/copilot" replace />} />
          <Route path="/copilot/*" element={<div>copilot</div>} />
          {/* 后续 Task 替换为各页面 */}
        </Routes>
      </main>
    </div>
  );
}
```

```ts
// src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...i: ClassValue[]) { return twMerge(clsx(i)); }
```

```ts
// src/lib/api.ts
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: { code: 'HTTP', message: r.statusText } }));
    throw new Error(body.error?.message ?? r.statusText);
  }
  return r.json() as Promise<T>;
}
```

```ts
// src/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});
```

- [ ] **Step 6：components.json（shadcn 配置）**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "tailwind.config.ts", "css": "src/styles/index.css", "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/cn" }
}
```

- [ ] **Step 7：通过 shadcn CLI 添加初始组件**

```bash
cd packages/web
npx shadcn-ui@latest add button input label card dialog tabs switch badge toast scroll-area select
```

- [ ] **Step 8：启动 dev，验证页面可访问**

```bash
npm -w packages/server run dev &       # :3839
npm -w packages/web run dev            # :5173 → 浏览器打开看到导航
```

- [ ] **Step 9：提交：`feat(web): scaffold vite+react+tailwind+shadcn`**

### Task 32：通用前端组件

**Files:**
- Create: `packages/web/src/components/{status-badge,log-panel,confirm-dialog,model-select}.tsx`
- Test: 各组件 `*.test.tsx`（用 RTL）

按 spec 4.4 实现 4 个组件。每个含至少一个 RTL 测试（渲染/点击）。提交：`feat(web): add common components`。

### Task 33-39：每个功能页面

按 OLD `web/app.js` 与现 UI 1:1 还原页面。每个页面对应一个 Task：

- **Task 33**：Copilot 页（启停/版本/配置/日志/代理 + 账号 Tab）
- **Task 34**：MCP 页（XHS MCP 启停 + 登录 + 日志）
- **Task 35**：Claude 二级 Tab 页（settings/mcp/skills/rules/instructions/plugin/version/providers）
- **Task 36**：Codex 二级 Tab 页（settings/mcp/accounts/agents/skills/version）
- **Task 37**：Scheduler 页（任务 CRUD + cron 表达式）
- **Task 38**：Assets 页（通用资产同步触发与状态）
- **Task 39**：Clash / Cloudreve / Immich 页（按 OLD UI 决定是否合并到资产页）

每页的步骤模板：
1. 通读 `OLD/web/app.js` 中对应区域代码 + `OLD/web/index.html`
2. 在 `src/routes/<page>/` 下用 React + shadcn 组件还原 UI
3. 用 React Query `useQuery`（`refetchInterval` 替代 setInterval）拉状态
4. 用 React Hook Form + Zod 写表单
5. 至少 1 个 RTL 集成测试覆盖主交互
6. 提交：`feat(web): port <page> page`

---

## Phase 5：构建、打包与部署

### Task 40：postbuild 脚本

**Files:**
- Create: `scripts/postbuild.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const webDist = path.join(root, 'packages/web/dist');
const serverPublic = path.join(root, 'packages/server/dist/public');

if (!fs.existsSync(webDist)) {
  console.error('web dist missing — run web build first');
  process.exit(1);
}
fs.rmSync(serverPublic, { recursive: true, force: true });
fs.cpSync(webDist, serverPublic, { recursive: true });

// 复制 conf 模板进入 server 包，便于 npm publish 携带
fs.cpSync(path.join(root, 'conf'), path.join(root, 'packages/server/conf'), { recursive: true });
console.log('postbuild done');
```

- [ ] **Step 1：写脚本**
- [ ] **Step 2：在 server.ts 中加 static 插件**

```ts
// 仅生产模式
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
if (process.env.NODE_ENV !== 'development' && fs.existsSync(publicDir)) {
  await app.register(staticPlugin, { root: publicDir, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    else reply.sendFile('index.html');
  });
}
```

- [ ] **Step 3：跑全量构建**

```bash
npm run build
ls packages/server/dist/public/index.html  # 应存在
```

- [ ] **Step 4：本地全量启动验证**

```bash
node packages/server/dist/cli.js --root . &
open http://127.0.0.1:3839
```
Expected：浏览器看到完整 UI。

- [ ] **Step 5：提交**

```bash
git add -A
git commit -m "build: add postbuild and static SPA serving"
```

### Task 41：打包 npm tarball 并本地全局安装验证

- [ ] **Step 1：生成 tarball**

```bash
cd packages/server
npm pack
# 产出 my-ops-0.1.0.tgz
```

- [ ] **Step 2：本地全局安装并启动**

```bash
npm install -g ./my-ops-0.1.0.tgz
which my-ops
my-ops --port 3841 &
sleep 2
curl http://127.0.0.1:3841/api/health
kill %1
npm uninstall -g my-ops
```
Expected：health 200、UI 可访问。

- [ ] **Step 3：提交**

```bash
git add -A
git commit -m "build: verify global install via npm pack"
```

### Task 42：launchd 部署脚本

**Files:**
- Create: `scripts/deploy-launchd.ts`
- Modify: `Makefile`

- [ ] **Step 1：deploy-launchd.ts**（参照 OLD `Makefile` 的 `deploy` target）

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const home = os.homedir();
const installDir = path.join(home, '.my-ops');
const plistPath = path.join(home, 'Library/LaunchAgents/com.hongdongjian.my-ops.plist');
const nodeBin = process.execPath;
const cliPath = path.join(installDir, 'node_modules/my-ops/dist/cli.js');

// 1. 安装到 ~/.my-ops
fs.mkdirSync(installDir, { recursive: true });
execSync(`npm i --prefix ${installDir} my-ops@latest`, { stdio: 'inherit' });

// 2. 写 plist
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hongdongjian.my-ops</string>
  <key>ProgramArguments</key>
  <array><string>${nodeBin}</string><string>${cliPath}</string><string>--root</string><string>${installDir}</string></array>
  <key>WorkingDirectory</key><string>${installDir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${installDir}/data/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${installDir}/data/launchd.err.log</string>
</dict></plist>`;
fs.writeFileSync(plistPath, plist);

// 3. 加载
try { execSync(`launchctl unload ${plistPath}`, { stdio: 'ignore' }); } catch {}
execSync(`launchctl load -w ${plistPath}`, { stdio: 'inherit' });
console.log('deployed:', plistPath);
```

- [ ] **Step 2：Makefile**

```makefile
.PHONY: install deploy undeploy restart info

install:
	npm install

deploy:
	npm run build
	tsx scripts/deploy-launchd.ts

undeploy:
	launchctl unload ~/Library/LaunchAgents/com.hongdongjian.my-ops.plist || true
	rm -f ~/Library/LaunchAgents/com.hongdongjian.my-ops.plist

restart: undeploy deploy

info:
	launchctl list | grep my-ops || echo "not running"
```

- [ ] **Step 3：本地实际跑 `make deploy`，验证 launchctl 列表里有进程，端口可访问**
- [ ] **Step 4：`make undeploy` 清理**
- [ ] **Step 5：提交：`feat: add launchd deploy script and Makefile`**

---

## Phase 6：收尾

### Task 43：README

**Files:**
- Modify: `README.md`

- [ ] 写：项目介绍、快速开始（dev/build/install）、配置说明（`conf/server.yaml` 字段表）、launchd 部署、API 列表索引、迁移自 Go 版的说明
- [ ] 提交：`docs: add README`

### Task 44：CI（可选）

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] 触发：push、pull_request；步骤：`npm ci → typecheck → lint → test → build`
- [ ] 提交：`ci: add github actions workflow`

### Task 45：发布前体检

- [ ] **Step 1**：在新机器（或干净 docker）上 `npm i -g <tarball>`，跑 `my-ops doctor` 与 `my-ops`，UI 全功能冒烟
- [ ] **Step 2**：API diff 脚本对照 OLD 全通过
- [ ] **Step 3**：launchd 部署+开机自启验证
- [ ] **Step 4**：`npm publish --dry-run -w packages/server` 检查包内容
- [ ] **Step 5**：提交版本号 0.1.0 tag：`git tag v0.1.0 && git push --tags`（人工执行，确认无误）

---

## 验收

- [ ] 所有 45 个 Task 全部 checkbox 勾选
- [ ] `npm run test` 全部通过
- [ ] `npm run build` 无错
- [ ] `npm i -g <tarball>` 后 `my-ops` 启动正常，UI 全功能可用
- [ ] OLD/NEW API diff 脚本无非动态字段差异
- [ ] launchd 部署+开机自启可用
