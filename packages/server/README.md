# my-ops

面向个人开发者的本地运维管控台。基于 Fastify + React 重写自原 Go 版本，提供浏览器 UI 统一管理 AI 工具链（copilot-api、XHS MCP、Claude Code、Codex、定时任务调度等）。

## 项目结构

```
myops/
├── packages/
│   ├── server/    # Fastify 后端，发布为 npm 包 my-ops
│   └── web/       # React 前端，由 server 静态托管
├── conf/          # 默认配置（server.yaml、claude/codex/copilot 等）
├── scripts/       # 构建与部署脚本
└── Makefile       # 常用任务封装
```

## 快速开始

### 开发

```bash
make install        # 等价于 npm install
make dev            # 同时启动 server (3839) 和 web vite (5173)
```

或分开启动：

```bash
npm run dev:server
npm run dev:web
```

### 构建

```bash
make build          # = npm run build
                    #   web build → server tsc → postbuild 拷贝静态资源与 conf/
```

构建产物：

- `packages/server/dist/cli.js`：CLI 入口
- `packages/server/dist/public/`：前端静态文件
- `packages/server/conf/`：默认配置（从根目录 `conf/` 复制）

### 安装运行

```bash
make pack                                       # 打包到 dist-pack/
npm i -g dist-pack/my-ops-*.tgz                 # 全局安装
my-ops --port 3839 --root ~/.my-ops             # 启动服务
```

或直接 `node packages/server/dist/cli.js -p 3839 -r .` 本地运行。

## 配置

`conf/server.yaml` 字段：

| 字段 | 说明 |
|------|------|
| `port` | HTTP 监听端口（默认 3839） |
| `copilot_proxy_url` | copilot-api 上游代理 |
| `models` | 前端模型下拉列表（与 `/api/server/models` 同源） |

启动参数：

```
my-ops --port <port> --root <workdir>
```

`--root` 决定 `data/`（运行期状态）和 `conf/`（配置）的查找位置。

## API

健康检查：`GET /api/health` → `{ ok: true }`

模型列表：`GET /api/server/models`

完整路由按领域分组（copilot、claude-*、codex-*、mcp、scheduler、clash、cloudreve、immich-sync、assets 等），详见 `packages/server/src/modules/*/routes.ts` 与 `docs/` 中的迁移规格。

## 部署 (macOS launchd)

```bash
make deploy          # = make pack && tsx scripts/deploy-launchd.ts
make info            # 查看 launchctl 状态
make undeploy        # 卸载
make restart         # 重新部署
```

`scripts/deploy-launchd.ts` 行为：

1. 安装最新 tarball 到 `~/.my-ops/node_modules/my-ops`
2. 写入 `~/Library/LaunchAgents/com.hongdongjian.my-ops.plist`
3. 通过 `launchctl load -w` 注册并启动
4. 日志位于 `~/.my-ops/data/launchd.{out,err}.log`

## 测试 / 类型检查

```bash
make test            # vitest 在 server + web 全量
make typecheck       # tsc --noEmit
```

## 从 Go 版本迁移

旧版仓库 `my-ops`（Go + 原生 JS）已被本仓库（TS monorepo）取代。差异：

- 后端 `net/http` → Fastify，按模块 (`packages/server/src/modules/*`) 组织
- 前端 vanilla JS → React + Vite + Tailwind + shadcn/ui
- 部署：`make deploy` 现在通过 npm 全局安装而非编译二进制
- 配置文件 `conf/server.yaml` 字段保持兼容
- `data/state.json` 存储格式保持兼容（PID 持久化、调度器任务等）

迁移时复制旧仓库的 `data/` 与 `conf/` 到新工作目录即可。
