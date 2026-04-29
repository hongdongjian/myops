# my-ops TypeScript 重写设计文档

**日期**：2026-04-29
**目标项目目录**：`/Users/hongdongjian/Documents/workspace/github/myops`
**对照源**：`/Users/hongdongjian/Documents/workspace/github/my-ops`（Go 实现）

## 1. 目标与范围

将现有 `my-ops`（Go 标准库 HTTP + 原生 JS 前端）1:1 重写为：

- **后端**：Node.js + TypeScript + Fastify
- **前端**：React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **发布形态**：单一 npm 包 `my-ops`，支持 `npm i -g my-ops` 全局安装，命令 `my-ops` 启动本地服务（默认 :3839）
- **功能完备性**：所有现有 handler、UI 面板、API 路径、调度器、autostart、launchd 部署 1:1 迁移

**非目标**：

- 不引入新功能、不调整 UX、不删除现有面板
- 不做跨平台扩展（仍以 macOS 为主）
- 首版不提供 SSR、不接入数据库

## 2. 总体架构

单仓 monorepo（npm workspaces），最终发布产物为一个 npm 包。

```
myops/
├── package.json                    # 根 package：workspaces，提供 dev/build 脚本
├── tsconfig.base.json
├── packages/
│   ├── server/                     # 发布的核心 npm 包：my-ops
│   │   ├── package.json            # name: "my-ops", bin: { my-ops: dist/cli.js }
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── cli.ts              # #!/usr/bin/env node 入口
│   │       ├── server.ts           # buildApp(config): FastifyInstance
│   │       ├── paths.ts            # rootDir / homeDir / dataPath / claudePath
│   │       ├── config/
│   │       │   ├── loader.ts       # 读 conf/server.yaml + Zod 校验
│   │       │   └── schema.ts
│   │       ├── core/
│   │       │   ├── process/
│   │       │   │   ├── manager.ts  # spawn/stop/status，管理子进程
│   │       │   │   └── state.ts    # data/state.json 持久化
│   │       │   ├── system/
│   │       │   │   └── runner.ts   # execFile/spawn 同步与后台封装
│   │       │   └── fsops/
│   │       │       └── index.ts    # 复制目录、创建软链
│   │       ├── modules/            # 一个目录 = 一个领域 = routes + service + schema
│   │       │   ├── copilot/
│   │       │   ├── copilot-accounts/
│   │       │   ├── mcp/
│   │       │   ├── claude-settings/
│   │       │   ├── claude-mcp/
│   │       │   ├── claude-assets/
│   │       │   ├── claude-instructions/
│   │       │   ├── claude-plugin/
│   │       │   ├── claude-version/
│   │       │   ├── codex-settings/
│   │       │   ├── codex-mcp/
│   │       │   ├── codex-accounts/
│   │       │   ├── codex-agents/
│   │       │   ├── codex-assets/
│   │       │   ├── codex-version/
│   │       │   ├── assets/
│   │       │   ├── scheduler/
│   │       │   └── server/
│   │       └── plugins/            # fastify 插件
│   │           ├── error-handler.ts
│   │           ├── static.ts       # @fastify/static 托管 SPA
│   │           └── method-guard.ts
│   └── web/                        # 前端 SPA
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── routes/             # 各功能页面
│           │   ├── copilot/
│           │   ├── mcp/
│           │   ├── claude/
│           │   ├── codex/
│           │   └── scheduler/
│           ├── components/
│           │   ├── ui/             # shadcn/ui 生成
│           │   ├── status-badge.tsx
│           │   ├── log-panel.tsx
│           │   ├── confirm-dialog.tsx
│           │   └── model-select.tsx
│           ├── lib/
│           │   ├── api.ts          # fetch 封装 + 错误统一
│           │   ├── use-status-polling.ts
│           │   ├── query-client.ts # React Query 客户端
│           │   └── cn.ts
│           └── styles/
│               └── index.css
├── conf/                           # 配置模板（随 npm 包发布）
│   ├── server.yaml
│   └── claude/                     # 现有 conf/claude/* 全部沿用
├── data/                           # 运行时（gitignore）
├── scripts/
│   ├── postbuild.ts                # 把 web/dist 拷到 server/dist/public
│   └── deploy-launchd.ts           # macOS launchd 安装脚本
└── docs/
    └── superpowers/
        ├── specs/
        └── plans/
```

## 3. 后端设计

### 3.1 启动流程

`cli.ts` 用 `commander` 解析参数：

```
my-ops                # 默认启动服务（:3839）
my-ops --port 9090    # 指定端口
my-ops --root <dir>   # 指定数据根目录（默认全局安装时为 ~/.my-ops/）
my-ops doctor         # 自检环境（node 版本、claude CLI 路径等）
my-ops version        # 版本号
```

启动流程：

1. 解析参数 → 确定 `rootDir`（开发：cwd；全局安装：`~/.my-ops/`）
2. 首次启动检测 `rootDir/conf/server.yaml`，缺失则从包内 `conf/` 复制模板
3. `loadConfig(rootDir)` 读 yaml → Zod 校验 → 冻结对象
4. 实例化 `Runner`、`StateStore`、`FileOps`、`ProcessManager`、`Scheduler`
5. `buildApp(deps)` 注册插件与所有 modules → 监听端口
6. 启动调度器与 autostart 监控循环

### 3.2 模块结构（每个 module 共用约定）

```ts
// modules/copilot/index.ts
export async function copilotModule(app: FastifyInstance, deps: Deps) {
  app.get('/api/copilot/status', { schema: ... }, handler);
  app.post('/api/copilot/start', { schema: ... }, handler);
  // ...
}
```

每个 module 包含：

- `routes.ts`：注册路由，定义 Zod schema（请求/响应）
- `service.ts`：业务逻辑，依赖 `deps`（注入 runner/store/fileOps/processMgr）
- `schema.ts`：Zod schema
- `service.test.ts`：单元测试

### 3.3 进程管理

`core/process/manager.ts`：

```ts
class ProcessManager {
  spawn(name: string, opts: SpawnOpts): Promise<{ pid: number }>;
  stop(name: string, timeoutMs?: number): Promise<void>;
  status(name: string): ProcessStatus;  // { running, pid, uptime }
}
```

- `spawn` 使用 `child_process.spawn(cmd, args, { detached: true, stdio: ['ignore', logFd, logFd] })`，调用 `unref()`，PID 写入 `data/state.json`。
- `status` 用 `process.kill(pid, 0)` 探活；写入失败/进程消失时清理 state。
- `stop` 先 `SIGTERM`，等待 timeoutMs（默认 3s）后 `SIGKILL`。
- 启动 `claude` CLI 时 env 中删除 `CLAUDECODE`（与 Go 版一致）。

### 3.4 配置加载

`config/loader.ts`：用 `yaml` 解析 → Zod schema 校验 → 返回 `Readonly<Config>`。Schema 含：`port`、`models`、`copilot.{path,port,...}`、`claude.{...}`、`scheduler.{...}` 等，与现 `conf/server.yaml` 字段一一对应。

### 3.5 错误处理

- 所有 service 抛 `AppError`（含 `code`、`statusCode`、`message`）。
- `plugins/error-handler.ts` 统一返回 `{ error: { code, message } }`，5xx 写日志。
- Zod 校验失败转为 400 `VALIDATION_ERROR`。

### 3.6 并发安全

- `async-mutex` 锁 autostart 开关、调度器任务列表、copilot 代理开关。
- npm 缓存：`node-cache` 5 分钟 TTL。

### 3.7 调度器

`modules/scheduler`：

- 用 `node-cron` 注册任务，任务定义持久化到 `data/scheduler.json`。
- 启动时恢复任务；`scheduler/routes.ts` 提供 CRUD API。
- 执行任务时调用 `Runner.spawn(claudeCli, args, { env: { ...process.env, CLAUDECODE: undefined } })`。

### 3.8 静态资源托管

`plugins/static.ts`：

- 生产模式：`@fastify/static` 服务 `dist/public/`，未匹配的非 `/api/*` 路径回退到 `index.html`（SPA 路由）。
- 开发模式：跳过 static，由 Vite dev server 处理。

### 3.9 API 兼容性

所有 API 路径与请求/响应 JSON 结构与现有 Go 实现 1:1 一致（前端逐步迁移过程中可指向旧 Go 服务做对照测试）。

## 4. 前端设计

### 4.1 技术栈

- React 18 + React Router v6
- TanStack React Query：服务端状态、轮询、mutation
- React Hook Form + Zod：表单
- Tailwind CSS v3 + shadcn/ui：UI 体系
- Vite 5：构建

### 4.2 路由布局

顶层 `App.tsx` = 左侧导航 + 内容区：

- `/copilot` Copilot 控制台（进程、版本、配置、日志、代理、账号）
- `/mcp` XHS MCP
- `/claude` Claude（设置/MCP/Skills/Rules/Instructions/插件/版本）— 二级 Tab
- `/codex` Codex（设置/MCP/账号/AGENTS.md/Skills/版本）— 二级 Tab
- `/scheduler` 定时任务
- `/assets` 通用资产同步

### 4.3 状态管理

- 服务端状态全部走 React Query：`useQuery(['copilot', 'status'], ...)` + `refetchInterval`。
- 用户级 UI 状态（当前 Tab、对话框开关）用 `useState`。
- 不引入 Redux / Zustand。

### 4.4 通用组件

- `<StatusBadge running={boolean} />`：进程状态徽章（绿/灰/红）
- `<LogPanel src="/api/copilot/logs" />`：日志面板，支持滚动跟随 + 清空
- `<ConfirmDialog>`：危险操作二次确认
- `<ModelSelect>`：从 `/api/server/models` 取数据的下拉

### 4.5 主题

沿用现有暗色风格，CSS 变量定义在 `styles/index.css` 中（`--background`、`--foreground` 等），shadcn 的 tokens 与之绑定。

## 5. 构建与发布

### 5.1 dev

根目录 `npm run dev`：用 `concurrently` 同时启动：

- `tsx watch packages/server/src/cli.ts --root .`（监听 :3839）
- `vite`（在 `packages/web`，监听 :5173，proxy `/api` → :3839）

### 5.2 build

```
npm run build
  └─ vite build (web)
  └─ tsc -p packages/server
  └─ tsx scripts/postbuild.ts   # 拷贝 web/dist → server/dist/public，复制 conf/ 模板
```

### 5.3 发布

`packages/server/package.json` 关键字段：

```json
{
  "name": "my-ops",
  "version": "0.1.0",
  "bin": { "my-ops": "dist/cli.js" },
  "files": ["dist", "conf"],
  "engines": { "node": ">=20" }
}
```

发布命令：`npm publish -w packages/server`。

### 5.4 launchd 部署（保留）

`scripts/deploy-launchd.ts` 重写 `make deploy`：

- 生成 plist：`ProgramArguments = ["node", "<install_path>/dist/cli.js"]`
- `WorkingDirectory = ~/.my-ops`
- `EnvironmentVariables` 注入（可选）`HTTP_PROXY`
- 安装到 `~/Library/LaunchAgents/com.hongdongjian.my-ops.plist`
- `launchctl load -w` 加载

## 6. 测试策略

- **后端**：Vitest + `fastify.inject()`；所有文件系统操作用 `tmp` 目录隔离。
- **前端**：Vitest + React Testing Library，覆盖关键交互（启停按钮、表单提交、轮询）。
- **覆盖率目标**：核心 service 覆盖 80%+；UI 组件不强制。
- **E2E**：首版不做，留接口。

## 7. 迁移与对照

新项目独立目录 `/Users/hongdongjian/Documents/workspace/github/myops`，与原 `my-ops` 并行存在便于对比。每个 module 实现完成后跑 API 对照：相同输入下旧 Go 服务 vs 新 TS 服务的 JSON 响应应一致（用脚本批量 `curl + diff`）。

## 8. 风险

| 风险 | 缓解 |
|------|------|
| Node `spawn` 与 Go `os/exec` 在 PATH/shell 行为差异 | `Runner` 显式接受 `cwd/env/shell` 参数；针对 `claude` CLI 写专门测试 |
| launchd 启动 Node 的 TCC 权限路径变化（参考 commit 8b41385） | 部署脚本中提示用户重授权 Full Disk Access |
| node-cron 与 Go `time.Ticker` 调度精度差异 | 任务最小粒度 1 分钟，差异不影响业务 |
| 1:1 迁移工作量大 | 计划阶段把每个 handler 契约固化为分任务，逐个迁移并对照测试 |

## 9. 验收

- 全局安装 `npm i -g my-ops` 成功
- 执行 `my-ops` 启动服务，`http://localhost:3839` 打开 React UI
- 现有 Go 版的所有 API 路径在新版可用，响应结构一致
- copilot-api / XHS MCP / 调度器 启停正常
- `make deploy`（或 `my-ops deploy`）安装到 launchd 后开机自启
- 全部 Vitest 通过

## 10. 不变量

- 用户运行时数据写入 `data/`（开发时 = 项目根，全局安装时 = `~/.my-ops/data/`）
- `conf/` 是配置模板，发布到 npm 包内
- 所有 API 路径不变，前端轮询语义不变
