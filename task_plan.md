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


# 2026-10-31 移除废弃 Copilot 模块

## 目标与成功标准
- 完整移除 Copilot 页面、API、账号管理和自动启动依赖。
- 用户已明确范围：仅移除 Copilot 全模块；Codex AGENTS.md 管理及其他模块保留。
- 保留工作区已有的 Clash 与 server/package.json 改动。
- 成功标准：无已删除模块的运行时引用；默认页面可用；相关回归测试、类型检查、构建通过。

## 阶段
1. [complete] 用户确认仅移除 Copilot，全链路引用边界已确认。
2. [complete] 已删除 Copilot 与账号模块、前端页面、自启循环和接入，清理 README 与 API 检查脚本。
3. [complete] API/导航新增回归、类型检查和生产构建通过；全量测试的既有失败已完成基线核对。

## 本次错误记录
- 初次搜索部分路径不存在（config/.github/.harness/conf）；已以实际文件清单为准缩小搜索。

- 基线 npm test：服务端 254 通过、9 失败（6 个文件）；失败涉及 codex-accounts、copilot、mcp、scheduler，完整日志 /tmp/myops-removal-baseline-tests.log。根脚本因此尚未运行前端测试。
- 用户澄清仅移除 Copilot，已恢复本次删除的 Codex AGENTS.md 文件与设置页面，接入与测试同步恢复。

- 前端基线快照首次运行缺少根 tsconfig.base.json，测试未收集；已补齐根配置后重试，不涉及源码变更。

- 前端基线比较首次未过滤已移除的 Copilot 用例，比较断言失败；过滤已删除模块后保留用例失败集合完全一致，无需重复测试。

## 最终验证
- 新增接口回归与首页导航回归通过：Copilot 返回 404、Codex AGENTS.md 保持 200、默认首页为 Claude。
- npm run typecheck、npm run build、git diff --check、bash -n scripts/api-diff.sh 通过。
- 服务端 221 通过 / 7 失败；7 个失败全部在改动前基线中存在；删除的 Copilot 原有 2 个失败随模块移除。
- 前端 10 通过 / 2 失败；HEAD 快照原有 4 个失败，删除 Copilot 的 2 个后，与当前 2 个 MCP 失败完全一致。
- 生产前端与后端 bundle 中均无 Copilot 字符串。


# 2026-10-31 Provider 配置迁入 conf

## 目标与成功标准
- Claude/Codex Provider 分别存于 conf/claude/providers.json、conf/codex/providers.json，并由现有 conf 同步覆盖。
- 用户补充：代码只读写 conf，不做旧 data 路径的兼容或自动迁移。
- 将当前本机两份 data 配置一次性搬到对应 conf 路径，校验原文一致，保留全部字段和当前选中项。
- 保留现有 Claude 数组格式兼容与增删改、Apply、ccenv 行为。

## 阶段
1. [complete] 确认两套服务、路径、同步机制及本机旧数据存在。
2. [complete] 已调整两处路径；数据来源与读写回归通过，README 已补充新位置。
3. [complete] 45 个相关测试、类型检查和服务端构建通过；本机文件已搬迁，服务重启及接口核验通过。

## 本次错误记录
- 暂无。

- 回归先在旧实现复现 5 个预期失败，改为 conf 路径后 45/45 相关测试全部通过。

## Provider 迁移最终验证
- 生产代码仅修改 Claude/Codex 两处 storePath，均指向 conf/<tool>/providers.json，无 data 路径兼容。
- 本机一次性搬迁完成：Claude 11 个 Provider、Codex 4 个 Provider；新文件 SHA-256 与搬迁前相同，旧文件已移除。
- 在线 API 返回内容及当前选中项与搬迁文件完全一致，健康检查正常。
- 新文件均未被 conf Git 仓库忽略，可随现有同步流程同步；未执行远端推送。
- git diff --check 通过。


# 2026-10-31 移除独立 MCP 模块

## 目标与成功标准
- 按用户截图移除独立 MCP / Xiaohongshu 模块的页面、API、自动启动及运行时接入。
- 保持 Claude/Codex 各自的 MCP 配置功能及工作区已有改动。
- 验收：导航无独立 MCP、旧 API 返回 404、保留的 MCP 接口和页面正常、相关测试与类型检查和生产构建通过。

## 阶段
1. [complete] 已定位 myops，确认模块引用和已有未提交改动；已保存本次修改前快照。
2. [complete] 已删除独立模块并清理入口、自动启动及 API 检查脚本，补充 12 个旧接口和导航回归。
3. [complete] 42 项相关测试、类型检查和生产构建通过，源码和构建产物无独立 MCP 引用；已重启本机服务并核验接口及导航。

## 本次错误记录
- 初始 hdj/test 目录无对应源码，已通过项目清单与截图文字定位到 myops。

## 独立 MCP 清理最终验证
- 服务端 39 项、前端 3 项相关测试通过，覆盖全部 12 个旧接口返回 404 和保留 MCP 路由。
- npm run typecheck、npm run build、git diff --check、bash -n scripts/api-diff.sh 通过。
- 运行时源码和前后端构建产物均无 Xiaohongshu / XHSService / 独立 MCP 接入残留。
- 本地 myops 已重启，健康接口正常；5 个旧 GET 接口返回 404，Claude/Codex MCP 列表接口均返回 200。
- agent-browser 核验首页进入 Claude，侧栏仅有 Claude、Codex、Cron、Clash、QuantumultX，无独立 MCP 导航。
- 已与修改前快照比较，本次范围外的已有 tracked diff 完全一致。


# 2026-10-31 Cron 日志保留上限调整为 30

## 目标与验证
- 每个任务保留最近 30 次执行记录及对应日志，沿用现有清理机制。
- 验证成功、失败执行均限制 30 条；旧 500 条历史在后续执行时正确收缩；写入失败保护和孤立日志规则不变。

## 阶段
1. [complete] 确认现有 MAX_EXECUTIONS=500、清理逻辑、保留测试和 README 位置。
2. [complete] 保留常量及 README 已改为 30，回归覆盖新边界和旧 500 条记录收缩。
3. [complete] 12 项相关测试、服务端构建通过，现有超额历史已裁剪并重启服务。

## 本次错误记录
- 暂无。

## Cron 保留调整最终验证
- 新增断言在旧实现下复现 6 个预期失败；修改上限后保留测试 9 项、应用集成测试 3 项全部通过。
- 服务端构建（含 tsc --noEmit）通过，git diff --check 通过。
- 本机无任务运行时停服，复用已有清理逻辑将 2 份超额历史裁至 30 条，淘汰 170 条记录并核验对应日志均已移除。
- 没有扫描历史之外的孤立日志，清理行为与原有机制一致；已重启 launchd 服务。


# 2026-10-31 删除 Cron 任务时清理历史和日志

## 目标与成功标准
- 删除任务时同时移除 history/<id>.json、对应 .tmp 和整个 logs/<id>/ 目录。
- 文件缺失可重复删除，其他任务文件保持不变；非法路径不得进入递归删除。
- 运行中的任务返回 TASK_BUSY，删除与任务启动互斥，防止删除后写回文件。
- 先保存任务删除结果再清理文件，保存失败保持任务和历史；清理失败可重试。
- 更新现有删除确认文案与说明，测试、构建和本机验证通过。

## 阶段
1. [complete] 已检查删除、运行、历史持久化、界面和既有测试。
2. [complete] 已实现历史/.tmp/整个日志目录清理、运行保护与保存失败回滚；更新确认文案和文档。
3. [complete] 19 项相关测试、生产构建通过，已重启并用禁用临时任务完成实际 API 和资源核验。

## 本次错误记录
- 首次 AGENTS 搜索无匹配使同一命令后续读取未执行，已单独读取相关材料。

- 新删除回归在旧实现下有 6 个预期失败、1 个通过；实现后删除 7 项、保留 9 项、应用集成 3 项全部通过。

## Cron 删除清理最终验证
- 7 项删除测试、9 项日志保留测试、3 项应用集成测试通过；前后端生产构建及类型检查通过。
- 实际 API 验证：创建禁用临时任务并构造其历史/.tmp/嵌套旧日志，删除后均不存在，原有 2 个任务保留。
- 已确认当前服务返回的前端资源含更新后的删除确认文案；服务重启后健康检查正常。
- git diff --check 通过；未删除已有用户任务或进行全局历史清扫。


# 2026-10-31 Clash 单一配置生成 Quantumult X 订阅可行性

## 范围与验证目标
- 用户当前请求为调研和解释：查看现有两套实现与配置，比较规则、策略等差异，评估单一 Clash 源生成 QX 订阅。
- 仅做只读检查与建议，不改模块、配置或运行服务；不输出订阅令牌、节点密码等凭据。
- 以现有代码和本机配置功能清单为证据，使用官方文档核对协议与策略兼容边界。

## 阶段
1. [complete] 已检查两套构建逻辑、本机配置功能和 29 个实际引用的缓存规则集。
2. [complete] 已核对官方规则、策略、节点格式和 App Store 更新记录，确认 VLESS Reality Vision / IP-ASN 示例及 Hysteria2 待支持边界。
3. [complete] 建议 Clash 统一维护节点/规则/策略，生成 QX 输出；QX 脚本/重写/MITM/DNS 保留精简附加段，转换需报告不兼容项。

## 本次错误记录
- 首轮代码搜索输出较多，已缩小到具体构建函数及脱敏统计。

## 评估结论与限制
- 可实现单一 Clash 主配置、双格式订阅；现有 QX 发布逻辑尚无转换能力，需要新增格式适配器。
- 当前 select/url-test 组具备 static/url-latency-benchmark 映射基础，但动态节点过滤、组引用及测试机制需适配。
- 官方当前 sample.conf 明确包含 vless-flow=xtls-rprx-vision、Reality、ip-asn；Hysteria2 未找到官方格式支持，官方仓库 #235 支持请求仍开放。
- 当前规则集含 33 条 PROCESS-NAME、1 条 DST-PORT；不能作为普通域名/IP 规则默默转换或丢弃。
- 远程机场节点未请求展开，QX 实机版本及导入效果未测试；本次仅可行性分析，未改模块、配置或服务。


# 2026-10-31 Clash 单一来源生成 QX 订阅

## 用户决定与成功标准
- 用户明确不要 QX 重写/脚本/MITM 等专属功能，只维护 Clash，尽可能转换当前配置。
- Clash 页提供两条共用密钥的订阅与 QX 转换报告；移除独立 QX 管理模块和界面。
- 节点、动态筛选/嵌套策略、普通域名/IP/ASN、规则集及自定义规则转换；不支持项显式报告。
- Clash 默认订阅行为不变；QX 输出所有引用有效，无旧 QX 专属内容。
- 回归、类型检查、构建通过，使用当前本机配置生成并核验订阅，重启后验证实际页面与 API。

## 阶段
1. [complete] 复核代码、现有改动、真实配置特征与官方格式。
2. [complete] 转换器、节点缓存、规则缓存复用、双格式订阅及报告完成，42 项服务端相关测试通过。
3. [complete] Clash 页面提供双订阅和报告，移除独立 QX 前后端模块，导航与页面 2 项回归通过，文档已更新。
4. [complete] 生产构建、相关回归和在线 API/浏览器验证通过，当前配置生成 172 节点/26 策略/25906 规则。

## 本次错误记录
- 大范围初次读取输出较多，已改为具体方法和脱敏元数据。

- 首个补丁脚本因模板字符串中的未转义反引号解析失败，未产生文件变更；已拆分补丁并修正引用后成功执行。

- 第二个混合补丁脚本同样因旧代码反引号导致解析失败，未执行任何调用；现改为独立补丁和精确 Python 替换，避免在原始模板字符串中嵌入旧模板代码。

## Clash→QX 最终验证
- 相关回归：服务端 42 项、前端 2 项通过；前端全量 11 项通过。
- 服务端全量 221 通过 / 6 既有失败（Codex 账号 1、Scheduler 5），失败集合与已有基线相比无新增。
- 生产构建（含前后端类型检查）、git diff --check 通过。
- 已重启实际 launchd 服务；健康检查、原 Clash YAML、QX 文本订阅、统一密钥鉴权和原 QX 订阅别名均通过。
- 对实际生成结果校验所有节点/策略/规则引用有效；旧 QX 管理 API 返回 404，输出无脚本/重写/MITM 专属段。
- agent-browser 验证旧 QX 页面跳转 Clash、无独立导航、两条订阅共用密钥、实际转换统计和不支持原因可见。
- 浏览器 URL 等待命令未正常返回，已终止自建等待进程并运行 doctor（9 pass）；改为直接读取/点击/DOM 校验后完成，无功能阻塞。
- QX 客户端实机导入未测试；本机已有 Clash/QX 用户文件未删除，生成器不再读取旧 QX 配置。

5. [complete] 按用户指定将 QX 展示和文档地址统一为 /api/qx/subscribe；4 项回归、构建、重启和在线检查通过。


# 2026-10-31 修复 QX 实机订阅导入报错

## 目标与成功标准
- 已在当前 QX 客户端复现 server_check_url 使用 HTTPS 导致整份配置被拒绝。
- 转换器保留有效 HTTP 测速地址；不兼容的 Clash 测速地址使用默认 HTTP 地址并报告。
- 补充相关回归、构建并重启服务，验证实际订阅使用 HTTP。
- 在 Quantumult X 重新加载订阅，确认无语法错误且节点/策略/规则生效，保留当前 VPN 开关状态。

## 阶段
1. [complete] 检查截图与原生 QX 错误提示，核对官方 sample.conf 测速示例。
2. [complete] 原实现复现 5 个回归失败；修复后 22 项相关测试及服务端生产构建通过。
3. [complete] 已部署，实际订阅 HTTP 测速地址/172 节点/26 策略/25906 规则核验通过；QX 原生客户端重新关联后提示“成功”，节点 172、旧重写清空。

## 本次错误记录
- 服务重启命令完成后首次立即健康请求早于启动监听，已使用有界重试确认健康及实际订阅。
- 客户端继续发现单节点显式 benchmark 策略被拒绝，已改为锚定且转义的精确 server-tag-regex；特殊节点名称回归通过。
- 客户端要求 server_remote 等标准模块，即使没有远程内容；已补齐 7 个空模块，不启用重写/脚本/MITM。
- 旧关联“立即更新”返回 401，重新使用页面当前有效订阅建立关联后可下载；未轮换密钥。

## 最终验证
- 转换器 17 项、订阅适配器 3 项、应用集成 3 项（共 23 项）通过。
- 服务端类型检查和生产构建通过，launchd 已重启，健康检查与真实订阅校验通过。
- Quantumult X 已实际完整加载配置并显示成功；节点 172，未操作 VPN 开关。


# 2026-10-31 修复 QX 自建单节点组为空

## 目标与成功标准
- 已在原生 QX 复现自建组不能展开，编辑页正则匹配“结果”为空。
- 单节点测速组改为直接引用节点的固定选择组，避免正则筛选 server_local；多节点测速组保持自动测速。
- 相关回归与服务端构建通过，部署后更新 QX 订阅。
- 在 QX 实际展开德国、日本自建节点组，分别看到对应节点；不操作 VPN 开关。

## 阶段
1. [complete] 检查现有转换分支、单节点回归与 QX 空匹配结果。
2. [complete] 旧逻辑复现 3 项回归失败；修复后 24 项相关测试和服务端构建通过，实际订阅已直接引用节点。
3. [complete] 已重启服务并更新 QX；德国、日本两组分别实际展开，均显示并选中对应节点，VPN 保持关闭。

## 最终验证
- 旧逻辑复现 3 项单节点回归失败；修复后转换器 18 项、适配器 3 项、应用集成 3 项（共 24 项）通过。
- 类型检查和生产构建通过，真实订阅的两个单节点组为 static + 对应节点名，12 个多节点组保留自动测速。
- QX 提示导入成功，主界面两组均出现对应节点副标题，点击展开后分别出现选中的德国自建节点、日本自建节点。


# 2026-10-31 QX 策略组顺序与 YAML 一致

## 目标与成功标准
- QX 的策略组严格按 Myops YAML 中 proxy-groups 的顺序输出，业务分流在前、地区及自建组在后。
- 保留组引用解析、循环保护和嵌套展开功能，不让递归处理顺序影响展示。
- 回归、构建和真实订阅逐项顺序比较通过。
- 更新 QX 后检查顶部业务分组、底部地区与自建分组，VPN 保持原状态。

## 阶段
1. [complete] 确认递归编译依赖先写入输出，导致地区组提前。
2. [complete] 原实现复现两项顺序回归失败；修复后 24 项相关测试与构建通过，实际订阅 26 组与 YAML 顺序逐项一致。
3. [complete] 已重启服务并在 QX 立即更新；顶部为手动切换/国外网站/国际媒体等业务分组，底部为地区组与两个自建组，实际顺序已确认。

## 最终验证
- 转换器与订阅接口的两项顺序回归在原实现下失败，修复后 24 项相关测试、类型检查和构建通过。
- 实际订阅的 26 个策略组与 Myops YAML 数组逐项一致：前 12 个为业务分流，后 14 个为地区及自建分组。
- QX 实际更新后已查看底部地区/自建组并回到顶部业务分组，组间前向引用被客户端接受；单节点组仍显示所选节点。
- VPN 保持关闭；原生菜单 ID 曾失效，刷新界面后完成更新。


# 2026-10-31 新增德国直连 SS 节点

## 用户最新决定与验证目标
- 用户取消链式中转适配，按其提供参数新增“德国自建SS”直连节点。
- 只更新 Myops Clash 自定义节点，保留其他配置，不写入中转设置。
- 读取保存结果并验证 Clash/QX 订阅均包含该节点，QX 更新后实际可见；不额外启动 VPN。

## 阶段
1. [complete] 已保存直连 SS，回读参数一致，Clash/QX 订阅均包含，其他节点、规则、密钥保持一致。
2. [complete] QX 立即更新后节点数 173；实际展开德国自建节点组，截图确认 VLESS 与德国自建SS 均可见，VPN 保持关闭。

## 最终验证
- Myops 保存回读参数与用户提供一致，Clash 与 QX 实际订阅均包含新 SS。
- QX 客户端更新成功并实际显示德国自建SS；本次只验证配置导入，未进行连通性测试。
- 没有进行代码修改或服务重启，保存配置后订阅立即生效。


# 2026-10-31 QX 按 Clash 规则集分类

## 目标与成功标准
- 每个 Clash RULE-SET 生成独立 QX 规则资源，保留分类名称、引用顺序及策略偏好。
- 主订阅通过 filter_remote 引用 Myops 转换接口，使用同一订阅密钥；filter_local 仅保留末尾普通规则与 FINAL。
- YAML 普通规则与规则集交错时，将中间普通规则段转换为有序资源，避免跨区块后顺序改变。
- 规则资源可独立读取最新已保存规则及缓存，不读取机场节点；保留转换统计和不支持项报告。
- 回归、构建、资源鉴权及真实输出校验通过；更新 QX 并实际检查分类、顺序和加载数量。

## 阶段
1. [complete] 检查现有转换、缓存、接口及客户端规则资源机制。
2. [complete] 已实现分类资源、稳定摘要 ID、同密钥鉴权和独立按需读取；54 项相关测试、类型检查和构建通过。
3. [complete] 已部署并更新 QX；29 个分类名称及顺序逐项一致，实际客户端完整显示，汇总规则从置顶自定义规则开始。

## 本次错误记录
- 首次集成回归仍断言规则正文出现在主配置中，已改为核验独立资源接口；新结构下主配置不再包含这些正文。
- QX 主视图按钮无响应，菜单 Escape 未关闭且菜单状态下截图不可用；已用菜单 Cancel 清理并通过原生菜单退出/重开，客户端恢复。
- 退出后读取界面返回 App quit 属预期，重新获取应用后继续完成验证。

## 最终验证
- 54 项相关回归、服务端类型检查及构建通过；无前端代码变更。
- 实际 29 个资源均返回 200，名称及顺序与当前 Clash 规则引用一致，正文共 26033 条；本地仅 GEOIP/FINAL 两条，总数 26035。
- 缺失密钥 401、未知资源 404；回归覆盖规则更新、删除、密钥轮换、重复引用和交错顺序，资源请求不拉机场节点。
- QX 已实际更新订阅、逐页核对全部 29 个分类及排列；汇总视图验证首条为 subapi 并保留日本自建节点组偏好，后续分类规则也保留对应策略。
- 当前 QX 留在“规则资源”列表顶部；未启动 VPN。


# 2026-10-31 内置规则自动刷新与失败保留缓存

## 目标与成功标准
- 规则自动刷新内置于 Myops 生命周期，不依赖用户 Cron；替代当前两个资源刷新任务。
- 启动时及每 5 分钟检查规则缓存，按 rule-provider interval 到期更新，缺省 24 小时；自动只处理规则，不自动刷新图标或机场节点。
- HTTP/网络失败、空响应、无效规则及写入失败均保留旧文件和成功更新时间；成功内容通过临时文件原子替换。
- 自动与手动刷新互斥，关闭服务时停止定时检查并取消在途自动下载。
- 相关回归、构建、重启及实际自动刷新/原配置核验通过；页面和文档说明范围与周期。

## 阶段
1. [complete] 已核对现有刷新包括规则/图标，机场节点缓存为另一条按需流程。
2. [complete] 已内置启动/每 5 分钟到期检查、刷新互斥和原子替换；14 项新增回归及全部 68 项相关后端测试通过。
3. [complete] 两条旧 Cron 已备份移除，生产构建并重启；实测启动自动刷新 Direct.list，QX 29 个资源正常，页面说明已生效。

## 本次错误记录
- 一次补丁字符串中的模板插值触发 ReferenceError，调用未执行、文件未变；改为分块补丁及 Python 精确替换后成功。

## 最终验证
- 后端相关 68 项、Clash 页面 1 项通过，完整生产构建及 git diff --check 通过。
- 实际将 Direct.list 标记为到期并重启，启动后台自动下载成功，成功时间更新，无需调用刷新 API 或 Cron。
- 原两条刷新 Cron 的配置、历史和日志已备份至 data/backups/resource-refresh-cron-2026-10-31T13-36-34-818Z 后移除，当前 Cron 任务为 0。
- 对比哈希确认模板、自定义节点/规则、密钥、机场缓存未变；24 个图标及 7 个本地规则文件未变。
- QX 主订阅仍引用 29 个资源，Direct 规则资源返回 200；服务实际前端包含新的内置自动刷新说明。

# 2026-11-03 修复 conf 同步后的自定义规则 404

## 目标与成功标准
- conf 同步后，无需在页面重新保存，首次启动、规则同步及订阅生成时即可生成自定义 .list 文件。
- 已安装客户端直接请求自定义规则时，按当前 conf 补齐缺失文件并更新内容，保持鉴权与未知资源 404。
- 文件内容不变时不重复写入；内容变更采用临时文件原子替换，失败保留已有文件。
- 用临时目录复现仅同步 conf 的场景，覆盖新增、修改、删除、文件丢失及并发读取；相关回归和生产构建通过后 commit、push。
- 保留当前用户 conf、本地密钥和所有现有 Clash/QX 功能，不恢复已取消的小火箭支持。

## 阶段
1. [complete] 已确认远程 claude 404 和本地复现：规则定义会进入订阅，自动及手动刷新均不会生成对应文件。
2. [complete] 7 项新增回归在旧实现失败、修复后通过；已实现同步生成、订阅准备及自定义资源请求时的补齐，原子替换与内容不变跳过写入。
3. [complete] 76 项相关回归、完整生产构建和临时部署复现核验通过，最终差异已审查，提交内容已准备。

## 本次错误记录
- 初次查询 config-sync/routes.ts 路径不存在；已确认同步入口在 CLI，采用 Clash 自身的同步及请求流程兼容直接 git pull。
- 新增 7 项回归在原实现全部失败，复现同步、订阅发布、启动、既有客户端请求、删除与写入失败的缺口。
- 完整相关回归发现 QX 测试删除缓存时启动后台刷新尚未完成，造成额外请求；已让测试 fixture 等待真实启动刷新结束后再修改缓存，不使用固定延时或放宽断言。

## 最终验证与交付
- 76 项 Clash/QX 相关测试通过，完整 npm run build 通过（含前后端类型检查），git diff --check 通过。
- 临时环境仅写入 conf、未调用配置保存接口，首次订阅和自定义资源均返回 200；删除文件后原地址请求可自动修复，直接更新 conf 后原地址返回最新规则。
- 手动刷新可生成自定义资源，远程规则和用户 conf 保持不变；原子替换失败保留旧文件，真实写入错误返回 500 而非伪装成 404。
- 本次交付为代码提交和推送；远程生产服务需拉取新代码、构建并重启后生效，未操作远程服务配置。
