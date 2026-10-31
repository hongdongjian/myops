# myops

面向个人开发者的本地运维管控台，提供浏览器 UI 统一管理 AI 工具链（Claude Code、Codex、定时任务等）。

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
| `myops config push` | 上传本地 conf 变更到 GitHub |
| `myops config pull` | 从 GitHub 拉取最新配置 |
| `myops version` | 打印版本号 |

定时任务的执行历史和对应日志按任务保留最近 30 次执行。新执行淘汰旧记录时，
会在历史文件成功保存后删除该记录对应的日志；升级前已脱离历史索引的日志不会自动扫描或删除。
删除任务会同时删除该任务的执行历史和整个日志目录；正在执行的任务需要等待完成后再删除。

## Clash 与 Quantumult X 订阅

节点、策略组和分流规则统一在 Clash 页面维护，配置来源为
`~/.myops/conf/clash/template.yaml` 和 `~/.myops/conf/clash/custom.json`。

- Clash：`/api/clash/subscribe?api-key=<Clash密钥>`
- Quantumult X：`/api/qx/subscribe?api-key=<Clash密钥>`

两种订阅共用 Clash 密钥。Clash 页面中的「检查转换」显示已转换数量和不支持的项目。
QX 输出包含节点、策略和分流，直接复用 Clash 的规则缓存，并展开机场节点与动态分组。
策略组展示顺序与 YAML 模板一致，组间引用不改变排列。
单节点测速组转换为直接引用节点的固定选择组，多节点测速组保留自动测速。
Clash 规则集按原分类和引用顺序输出为 QX 独立规则资源，由 Myops 的 `/api/qx/rules/<id>?api-key=<Clash密钥>` 提供。
主配置通过 `filter_remote` 引用资源，保留原名称和策略偏好；`filter_local` 仅保留末尾普通规则和 FINAL。
若普通规则与规则集交错，中间普通规则按原位置分段为“YAML 规则”资源，避免改变顺序。
单独刷新资源会读取当前已保存规则及 Clash 规则缓存，不加载机场节点；缓存缺失时才按需获取规则源。
Myops 内置规则自动刷新，无需创建 Cron：启动时及每 5 分钟检查缓存，按模板中各规则集的 interval 到期更新，缺省 24 小时。
定时刷新仅处理规则资源，跳过本地自定义规则、图标和机场节点；手动“全量刷新”仍包含规则和图标。
下载或内容校验失败时保留旧缓存及上次成功时间；有效下载使用临时文件原子替换，失败后在后续检查中重试。
机场集合按其 `interval` 缓存于 `data/clash/providers/`，更新失败时使用上次有效缓存并在报告中说明。

QX 不再维护独立配置，不包含重写、脚本、HTTP 后端或 MITM。
不支持的协议、链式节点和规则会跳过并列入报告；空策略组会拒绝连接。
规则优先级、DNS 和测速机制遵循 QX 的实现，不能保证与 Clash 完全一致。

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

Claude Provider 和 Codex Provider 配置分别保存在
`~/.myops/conf/claude/providers.json` 和 `~/.myops/conf/codex/providers.json`，
包含 Provider 列表及当前选中项，可随 `conf` 目录同步。
