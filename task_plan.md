# QuantumultX 配置管理模块

## 目标
在 myops 中新增 QuantumultX 配置管理模块（参考 Clash 模块结构），支持：
1. 文本编辑器查看/编辑 .conf 原始内容（保留注释和格式）
2. 保存后自动解析 [task_local] / [rewrite_remote] / [http_backend] 下的远程资源 URL，以及行内 img-url= 的图片，列出并下载到本地
3. 4 个独立资源目录：`task_local/`、`rewrite_remote/`、`http_backend/`、`images/`
4. 每组资源支持「全量刷新」和「单项刷新/新增」
5. 全量刷新时本地多余文件被清理（保留手动新增的）
6. 通过 `http://127.0.0.1:3333/api/qx/static/<group>/<filename>` 暴露
7. 订阅地址 `/api/qx/subscribe?api-key=xxx`：返回经过 URL 替换后的 .conf 文本（远程 URL 替换为本地 static URL）

## 关键决策（已与用户确认）
- 编辑方式：**原文本编辑**（保留注释/格式，不解析为 YAML 结构）
- 配置来源：**本地编辑保存**，无上游订阅 URL
- 解析 sections：`task_local`、`rewrite_remote`、`http_backend`，以及行内 `img-url=` 图片
- 订阅地址：**需要 api-key**（类似 Clash），支持轮换

## 目录布局
```
conf/quantumultx/
  config.json              # { api_key }
  QuantumultX.conf         # 用户编辑的主配置
data/quantumultx/
  task_local/              # 下载的 js 文件
  rewrite_remote/          # 下载的 conf/js 文件
  http_backend/            # 下载的 js 文件
  images/                  # 下载的 png/jpg 等图片
  manifest.json            # { task_local: [{url, filename, source: 'remote'|'manual', sha256, updatedAt}], ... }
```

## URL 替换规则
- 远程 URL → `http://<host>:<port>/api/qx/static/<group>/<filename>`
- 文件名生成：基于 URL 路径取 basename；冲突时用 sha1(url)[:8] 前缀
- manifest 维护「URL ↔ 本地文件名」映射，订阅生成时按映射替换

## 阶段计划

### Phase 1: 后端骨架 (server)
- [ ] 创建 `packages/server/src/modules/quantumultx/`
  - `schema.ts` — 类型定义（QxConfig、QxResource、QxManifest、ApiEnvelope 复用）
  - `parser.ts` — 解析 .conf 提取 sections 下的 URL + img-url
  - `service.ts` — loadConfig/saveConfig/loadConf/saveConf、下载、刷新、清理、构建订阅
  - `routes.ts` — Fastify 路由
- [ ] 在 `server.ts` 注册 `quantumultxModule`

### Phase 2: API 设计
- [ ] `GET  /api/qx/conf` → 返回原始 .conf 文本
- [ ] `PUT  /api/qx/conf` → 保存 .conf，自动触发解析（不下载）
- [ ] `GET  /api/qx/resources` → 返回 manifest（4 个分组）
- [ ] `POST /api/qx/resources/refresh` → body `{ group?: string, url?: string }`：全量或单项刷新
- [ ] `POST /api/qx/resources/add` → body `{ group, url }`：手动新增
- [ ] `DELETE /api/qx/resources` → body `{ group, filename }`：手动删除
- [ ] `GET  /api/qx/static/:group/:filename` → 文件流（使用 @fastify/static 或手动 stream）
- [ ] `GET  /api/qx/subscribe?api-key=xxx` → 返回 URL 已替换的 .conf
- [ ] `GET  /api/qx/config` / `PUT /api/qx/config` → 管理 api_key
- [ ] `POST /api/qx/subscribe/rotate-key`

### Phase 3: 解析器实现
- [ ] 按行扫描 .conf，识别 `[section]` 头
- [ ] 对目标 section（task_local/rewrite_remote/http_backend）内每行：
  - 跳过空行/注释（`#`、`;`、`//`）
  - 提取 http(s):// URL（行首或参数中的 url）
  - 提取行内 `img-url=https://...` 作为 image 资源
- [ ] 返回 `{ task_local: string[], rewrite_remote: string[], http_backend: string[], images: string[] }`

### Phase 4: 下载与清理
- [ ] `downloadOne(url, group)`：fetch + 写入 data/quantumultx/<group>/<filename>
- [ ] manifest 持久化
- [ ] `refreshGroup(group, urls)`：下载所有 remote URL，清理本地不在 (remote URL ∪ manual) 集合中的文件
- [ ] 并发控制（p-limit 类似或简易 Promise.all 分批）

### Phase 5: 订阅构建
- [ ] `buildSubscribe()`：读取 .conf 原文 + manifest，按映射全文替换 URL（含 img-url）
- [ ] 返回 `text/plain; charset=utf-8`，Content-Disposition: attachment

### Phase 6: 前端页面
- [ ] `packages/web/src/routes/quantumultx/index.tsx`
- [ ] `quantumultx.tsx`：
  - 左侧：CodeMirror/Monaco 文本编辑器（已用 Tailwind/shadcn，用 textarea + 简单语法高亮即可，或参考 clash 是否有现成编辑器）
  - 右侧：4 个分组卡片，列出资源、单项/全量刷新按钮、新增/删除
  - 顶部：保存配置、订阅地址展示（含 api-key 显示/复制/轮换）
- [ ] 在 `App.tsx` 添加导航项 `qx` / `/quantumultx`

### Phase 7: 测试
- [ ] `parser.test.ts` — 解析 fixture .conf
- [ ] `service.test.ts` — mock fetch 测试刷新与清理
- [ ] `routes.test.ts` — 端到端

### Phase 8: 集成验证
- [ ] 本地启动 server，用 sample .conf 验证全流程
- [ ] 订阅地址在浏览器/curl 中可下载，URL 已替换

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|

## 决策记录
- 资源文件名：URL basename，冲突时 sha1(url)[:8] + '-' + basename
- 图片识别：仅取 sections 中的 img-url=；策略组里的 img-url 也可一并提取（后续按需）
- 多余文件清理：以 manifest 为权威，本地实际文件与 manifest 中 source!='deleted' 的项做差集
