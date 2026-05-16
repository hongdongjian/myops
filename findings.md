# Findings

## 代码库结构调研

### 后端 (packages/server)
- Fastify + TypeScript + fp 插件模式
- 模块位置：`src/modules/<name>/{routes,service,schema}.ts`
- Deps 注入：`paths`、`runner`、`store`、`processMgr` 等
- 路径辅助：`paths.confPath()`、`paths.dataPath()`、`paths.rootDir`
- Clash 模块是最相近的参考：
  - 配置存于 `conf/clash/config.json`
  - 使用 `async-mutex` 防并发
  - YAML 解析用 `yaml` 包
  - api_key 用 `crypto.randomBytes(24).toString('hex')` 轮换
  - 订阅路由校验 `req.query['api-key']`
- 错误处理：抛 `AppError(code, message, statusCode)`
- 返回：`ApiEnvelope { success, data?, message?, error? }`
- Static plugin (`@fastify/static`) 已在 server.ts 中用于 public dir，可复用

### 前端 (packages/web)
- React + react-router-dom + Vite + Tailwind + shadcn/ui
- 路由位置：`src/routes/<name>/index.tsx`
- App.tsx 中 navSections 添加项 + Routes 中添加 `<Route path="/qx/*">`
- Clash 页面 753 行，包含编辑器和上游刷新等 UI，可参考交互模式

### QuantumultX.conf 实际样本结构
- INI 类格式：`[section]` 头 + 行条目
- 注释：`#` `;` `//`
- 远程资源行示例（rewrite_remote）：
  ```
  https://ddgksf2013.top/rewrite/BiliBiliAdsLite.conf, tag=哔哩广告净化Lite, img-url=https://github.com/.../bilibili.png, update-interval=86400, ...
  ```
- task_local 示例：
  ```
  event-interaction https://raw.githubusercontent.com/.../streaming-ui-check.js, tag=..., img-url=arrowtriangle.right.square.system
  ```
  注意 img-url 可能是 SF Symbol（非 URL），需判断是否 http(s)://
- http_backend 示例：
  ```
  https://raw.githubusercontent.com/chavyleung/scripts/master/chavy.box.js, host=boxjs.com, tag=BoxJS, path=^/, enabled=false
  ```

### 实际 sections 出现位置
- general:137, task_local:162, rewrite_local:173, rewrite_remote:177, server_local:207, server_remote:211, dns:218, policy:235, filter_remote:255, filter_local:271, http_backend:290, mitm:298

## Paths
- 根目录：`paths.rootDir`
- 配置目录：`paths.confPath('quantumultx', ...)` → `conf/quantumultx/`
- 数据目录：`paths.dataPath('quantumultx', ...)` → `data/quantumultx/`

## API 端口
- 服务端口 3333（从用户描述 http://127.0.0.1:3333）
