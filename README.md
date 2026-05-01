# myops

面向个人开发者的本地运维管控台，提供浏览器 UI 统一管理 AI 工具链（Claude Code、Codex、copilot-api、定时任务等）。

## 快速开始

```bash
npm install       # 安装依赖
```

**开发**

```bash
npm run dev       # 同时启动 server (3333) 和 web vite (5173)
```

**安装（二选一）**

```bash
npm run build && npm run link      # 开发用，symlink 方式，改动立即生效
npm run build && npm run install   # 生产用，全局安装到系统
```

**卸载**

```bash
npm run unlink      # 对应 link 安装
npm run uninstall   # 对应 install 安装
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `myops start` | 启动服务（默认端口 3333），`--port` 指定端口，`--github-token` 覆盖 GITHUB_API_TOKEN |
| `myops install` | (macOS) 交互式配置 GITHUB_API_TOKEN / HTTP_PROXY / https_proxy，生成 plist 并注册 launchd 开机自启，安装后输出 plist 路径 |
| `myops uninstall` | (macOS) 停止并删除 launchd plist |
| `myops restart` | (macOS) 重启 launchd 服务 |
| `myops doctor` | 输出诊断信息；macOS 下额外显示 plist 路径及服务运行状态 |
| `myops ccenv [name]` | 列出或切换 Claude provider，用指定 provider 环境变量启动 claude CLI |
| `myops config init <url>` | 初始化 conf 目录与 GitHub 双向同步（`--pull` 从远端克隆） |
| `myops config upload` | 上传本地 conf 变更到 GitHub |
| `myops config update` | 从 GitHub 拉取最新配置 |
| `myops version` | 打印版本号 |

## 发布到 npm

```bash
# 登录 npm（首次）
npm login

# 构建并打包到 dist-pack/（不发布）
npm run pack

# 构建并直接发布到 npm registry
npm run publish
```

安装后用户可通过以下方式安装：

```bash
npm install -g myops
myops install   # 配置 launchd 开机自启
```



```
~/.myops/
├── conf/    # 用户配置，可跨机同步
└── data/    # 本机运行状态，不跨机同步
```
