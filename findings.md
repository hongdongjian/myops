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


## 2026-10-31 Copilot / Agents 清理
- Copilot 前端位于 packages/web/src/routes/copilot，后端为 copilot 与 copilot-accounts。
- Copilot 接入点包括 App.tsx 默认跳转、server.ts、cli.ts、deps.ts、core/autostart.ts、scripts/api-diff.sh 和 README。
- Codex 的 AGENTS.md 管理仍被 settings.tsx 调用，另有未接入的 agents.tsx；后端为 codex-agents。
- 初始脏文件：packages/server/package.json、modules/clash/service.ts、modules/clash/service.test.ts。
- 旧规划文件记录 QuantumultX 工作，保留历史内容并追加本次任务。

- 共享依赖 node-cache、async-mutex 仍被其他模块使用，无需删除包依赖。
- Codex config.toml 与 AGENTS.md 管理共享设置页面，需要仅移除后者，保留模板同步与编辑快捷键。
- 基线服务端测试已有 9 个失败，将与改动后的结果比较，避免混入无关修复。

- 用户最终确认：仅移除 Copilot 全模块，保留 Codex AGENTS.md 管理；已恢复这部分原始代码。
- 基线失败准确分布：Copilot 2、Codex 账号 1、MCP 1、Scheduler 5；删除 Copilot 后预计剩余 7 个既有失败。

- 最终仅 Copilot 被移除，Codex AGENTS.md 相关源码无 diff。
- 服务端剩余 7 个、前端 2 个失败均经基线核对为原有失败；前后端分别移除了 Copilot 的 2 个原有失败，全量测试没有新增失败。
- 构建后的服务端 cli.js 与前端 JS 均不含 Copilot，验证清理覆盖打包产物。


## 2026-10-31 Provider 配置迁移
- 两个服务原先分别通过 dataPath 保存 claude-providers.json、codex-providers.json；配置中包含 activeProvider 和 providers。
- Claude 兼容旧数组格式；Codex 无专用 Provider 测试。
- conf 同步以 paths.confPath() 为 Git 工作目录，无需修改同步器。
- 本机两个旧 data 文件均存在，两个新 conf 路径均不存在；核验只输出元数据，不展示凭据。
- 新路径沿用各工具子目录结构；迁移使用独占写入，目标已存在时优先读取目标，成功后再移除旧文件。

- 用户最新要求覆盖先前迁移方案：不做 data 路径兼容；仅当前本机数据一次性搬迁到 conf。尚未编写任何兼容代码。
- 本机迁移前统计：Claude 11 个 Provider、Codex 4 个 Provider；仅将哈希与数量存于 /tmp/myops-provider-relocation-before.json。

- 最终实现仅两处存储路径调整，无旧 data 回退或自动迁移分支。
- 本机两份原始 JSON 已在停服期间重命名至 conf，SHA-256 核验一致，API 列表及 activeProvider 完整保留；旧 data 文件均已移除。
- conf Git 仓库未忽略新增 providers.json 文件，无需修改同步器。


## 2026-10-31 独立 MCP 模块清理
- 截图对应 packages/web/src/routes/mcp 的 Xiaohongshu 页面。
- 后端独立模块为 packages/server/src/modules/mcp，由 server.ts 注册，由 core/autostart.ts 每 30 秒检查启动。
- 独立模块共 8 个源文件及测试；scripts/api-diff.sh 还有 3 个相关接口。
- Claude/Codex MCP 配置各有独立模块，属于保留范围；node-cache、undici 等共享依赖仍有其他使用方。
- 工作区已有 Copilot 移除、Provider 路径调整及 Clash 等未提交改动，本次仅叠加独立 MCP 清理。
- 已完成 8 个模块文件删除、6 个集成/回归文件调整；没有新增运行时依赖。
- 源码及构建产物中已无独立 MCP 实现，旧接口名称仅保留在退役回归用例中。
- 启动服务由 launchd 指向当前项目的 packages/server/dist/cli.js；生产构建后已重启，在线接口验证通过。
- 浏览器实际侧栏仅包含 Claude、Codex、Cron、Clash、QuantumultX；Claude 页面继续提供自身的 MCP 标签。


## 2026-10-31 Cron 保留上限
- scheduler/service.ts 的 MAX_EXECUTIONS 控制历史和对应日志清理。
- 新执行写入后淘汰最旧记录，并在历史原子保存成功后删除对应日志；不扫描孤立日志。
- 本次只改为 30，保留工作区已有 Provider、Copilot、独立 MCP 等改动。

- 最终 MAX_EXECUTIONS=30，常量同时控制执行历史与对应日志上限。
- 本机 2 份超额历史已通过现有 appendExecution 清理逻辑收缩到 30，保留最新内容，未触发任何 Cron 命令。


## 2026-10-31 Cron 删除清理
- deleteTask 目前只过滤内存任务并持久化，未删除任何历史或日志。
- runTask 使用 mu 标记启动和结束，需让删除与启动互斥；运行中不取消任意用户命令，返回 TASK_BUSY。
- 任务 ID 来自接口字符串，新增递归删除必须限制为单一目录名；既有删除保持幂等，便于清理失败重试。
- 本次不清扫已删除任务的全局遗留数据，线上验证仅操作本次创建的禁用临时任务。

- 已完成 deleteTask 的目录内清理及并发保护；同 ID 重试可清理残余文件，非法路径会在写入前拒绝。
- 实际禁用临时任务的删除请求成功移除历史、临时历史和整个日志目录，已有两个用户任务均保留。


## 2026-10-31 Clash → Quantumult X 评估
- Clash 当前由模板 + custom_proxies/custom_rules 生成 YAML；自定义规则作为 rule-providers 注入并将 RULE-SET 前置。
- QX 当前读取独立 QuantumultX.conf，仅将远程资源 URL 替换成本地镜像；尚无 Clash→QX 转换器。
- 两者各自维护 manifest 和订阅 API/key，远程 proxy-providers 在 Clash 镜像逻辑中被刻意排除，上游仍由客户端直接拉取。
- 需核对完整配置转换与仅节点订阅转换的区别，并检查现有 QX 脚本、重写和 MITM 能力是否能从 Clash 推导。

- 本机 Clash：26 个策略组（12 select / 14 url-test），24 个 classical/text 远程规则集，5 个启用的自定义规则集；4 个自定义节点分别为 VLESS、VMess、SS、Hysteria2，另有 1 个远程节点 provider。
- 本机 QX：14 个策略（7 static / 7 url-latency-benchmark）、11 个远程分流资源、11 个启用的远程重写资源、2 个 task_local、1 个 http_backend，以及 DNS 和 MITM 专属配置。
- Clash 当前策略包含 include-all、filter 和组嵌套，转换需考虑动态节点成员与正则语法。

- 已读取 Clash 本地缓存规则资源（不请求上游私有订阅），发现除域名/IP 外还含 PROCESS-NAME、IP-ASN、DST-PORT、AND；需进一步按模板实际引用过滤，避免把未使用缓存当成当前规则。
- 自定义节点中 VLESS 使用 Reality，VMess 使用 WS+TLS；订阅转换不能改变底层节点协议，需按 QX 支持能力筛选。
- 官方 QX sample.conf 文档描述 static、available、round-robin、dest-hash、url-latency-benchmark 等类型，与 Mihomo 的 group 参数并非完全同构。

- 按当前 Clash 模板与启用自定义规则过滤后共读取 29 个缓存规则集：DOMAIN 426、DOMAIN-SUFFIX 24403、DOMAIN-KEYWORD 47、IP-CIDR 718、IP-CIDR6 303，另有 PROCESS-NAME 33、IP-ASN 7、DST-PORT 1；先前未引用缓存中的 AND 不属于当前使用规则。
- 官方 App Store 更新记录已确认 QX 1.5.0 增加 VLESS、1.5.5 增加 Reality，不能沿用旧版本不支持的判断。官方当前资料未确认 Hysteria2，需作为未验证协议单独处理。
- Mihomo 文档明确规则自上而下匹配；QX 官方 README 指出 User-Agent 规则优先级低于 Host，说明不能假定两端优先级完全一致。

- 最新官方 sample.conf 已明确给出 VLESS + Reality + Vision 组合和 IP-ASN 规则，相关能力可以建立映射；不能把支持 Reality 与 Vision 脱节地按旧资料否定。
- 官方仓库 crossutility/Quantumult-X #235（Hysteria2 Protocol）仍为开放支持请求，当前样例和官方更新记录未确认 HY2，应列为兼容性缺口。
- 现有 QX 有 7 个策略引用其他策略组，组嵌套已存在；Clash 中动态 include-all、filter 仍需目标端适配。
- 建议复用 Clash 的资源缓存和最终配置拼装结果，只新增 QX 输出；旧 QX 专属段一次性提取保存，日常不再维护第二套节点/分流/策略。
- 官方证据：https://github.com/crossutility/Quantumult-X/blob/master/sample.conf；https://github.com/crossutility/Quantumult-X/blob/master/README.md；https://apps.apple.com/us/app/quantumult-x/id1443988620；https://wiki.metacubex.one/config/rules/；https://wiki.metacubex.one/config/proxy-groups/；https://github.com/crossutility/Quantumult-X/issues/235。


## 2026-10-31 Clash → QX 实施
- 用户已放弃 QX 专属功能，不保留附加配置或独立编辑器。
- 采用 Clash format=quantumultx 输出，转换报告只返回统计和问题；以 Clash 密钥鉴权订阅。
- 复用 Clash 配置拼装与规则缓存；HTTP 节点 provider 需在服务端读取并缓存，以展开 include-all/filter。
- QX 输出用 filter_local 展开规则集，避免重复维护规则资源；不兼容节点、规则和参数聚合报告。
- 策略为空时使用 reject 并明确报告，避免意外直连；保留组名称和可用组引用，校验循环引用。

- 实际转换结果：172 个兼容节点、26 个策略组、25906 条规则；跳过 2 个节点（Hysteria2、dialer-proxy 链式 SS）及 34 条规则（PROCESS-NAME 33 / DST-PORT 1）。
- 所有 29 个当前规则集已读取，机场节点源成功读取并缓存；输出仅有 general/dns/policy/server_local/filter_local 五个节。
- 当前源中的 client-fingerprint 和 no-resolve 以 QX 实现替代，DNS fake-ip 等选项明确在报告中说明。

- 在线输出约 1.10 MB，共 172 节点、26 策略、25906 规则；全部节点、组和规则目标引用校验有效，所有旧 QX 专属段均不存在。
- 两条订阅使用同一 Clash 密钥，原 /api/qx/subscribe 是同源别名；原 QX 配置/资源管理接口已移除。
- 实际浏览器已验证旧页面重定向、统一地址和转换报告，用户可在 Clash 页面直接复制新 QX 订阅。

## 2026-10-31 Quantumult X 原生客户端导入验证
- 实机拒绝 HTTPS server_check_url，默认改为 HTTP；保留合法 HTTP 自定义地址，不兼容地址回退并报告。
- 实机拒绝单节点显式列表的 url-latency-benchmark；改为精确匹配该节点 tag 的正则，保留自动策略行为并转义特殊字符。
- 实机要求标准空模块存在：server_remote/filter_remote/rewrite_remote/rewrite_local/task_local/http_backend/mitm。此前仅生成五个节的判断不适用于客户端导入。
- 新输出补齐上述空模块，均无配置内容，不引入重写、脚本或 MITM 功能。
- 已在原生 Quantumult X 重新关联当前 /api/qx/subscribe 订阅，客户端提示“成功”，节点从旧配置 171 更新为 172，原 210 条重写内容清空；未操作 VPN 开关。

## 2026-10-31 QX 单节点组实际成员修复
- 前次“正则解决单节点组”的方案只能通过语法加载，QX 编辑页的匹配结果为空，主界面无法展开；server_local 中的节点不会通过该资源正则纳入组内。
- 单节点 url-test 改为 static 并直接引用该节点，移除无用正则分支和测速参数；两组各只有一个候选，无须自动择优。
- 多节点 url-test 保持 url-latency-benchmark 与显式候选及测速参数，实际 12 个多节点组保持不变。
- 24 项回归、类型检查和构建通过；服务重启并更新 QX 后，已分别点击展开德国、日本两组，均显示选中的对应节点。

## 2026-10-31 QX 策略顺序修复
- 原递归解析组依赖时直接追加 policyLines，导致被引用的地区组排到业务组前。
- 按名称缓存编译后的策略，仍递归处理引用、循环和展开；最终按 YAML 中原始组顺序输出。
- 实际 26 组顺序与 Myops YAML 逐项一致，12 个业务组在前，14 个地区/自建组在后。
- 已重启服务并通过 QX“立即更新”获取新订阅，客户端显示顶部手动切换/国外网站/国际媒体等，底部地区和自建组；无需手工拖拽排序。

## 2026-10-31 用户改为新增直连 SS
- 用户取消链式中转适配，提供“德国自建SS”参数，要求保存到 Myops。
- 已通过配置 API 新增 SS，不带 dialer-proxy；自定义节点总数 5，Clash/QX 输出均核对参数一致。
- QX 更新后总节点数 173，德国自建节点组变为包含 VLESS 与直连 SS 的双节点测速组；实际截图确认两节点均显示。
- VPN 保持关闭，未验证服务器连通性；未实施此前讨论的链式适配。

## 2026-10-31 QX 分类规则资源设计
- 当前 main rules 中规则集全部在 GEOIP/FINAL 之前；按引用顺序生成 filter_remote，启用 inserted-resource，以便资源排在本地尾部规则前。
- 保留 provider 名作为资源标签，引用时明确 force-policy；资源正文使用默认策略并由引用覆盖，允许同一来源分别应用不同策略。
- 对交错的普通规则按连续相同策略分段，作为辅助资源插入相同位置，避免所有 filter_local 规则自动前置。
- 官方仓库问题 #251 有 inserted-resource 解决远程资源被本地规则优先匹配的实测，支持本次顺序验证重点；仍需在客户端实际核验。
- 资源 URL 使用稳定摘要 ID 与 Clash 订阅密钥，服务端查找当前配置中的资源定义，不接受任意源 URL 或文件路径。

- 实际服务已输出 29 个资源，与当前 Clash 自定义+模板规则引用顺序逐项一致；资源正文共 26033 条，filter_local 仅 GEOIP/FINAL 两条，统计总数 26035。
- 全部 29 个真实资源接口返回 200，缺失密钥 401，未知摘要 ID 404；173 节点与 26 个策略的原配置保持。
- QX 主视图按钮一度无响应，原生菜单可用；已通过原生菜单退出并重开，设置恢复响应，正在客户端加载资源。

- QX 已实际加载并逐页显示全部 29 个分类，顺序为置顶自定义规则、Direct/Reject/AI 等模板规则，末尾 AppleCN/AppleProxy/Lan，与服务端逐项一致。
- 汇总规则视图第一条为 subapi 并使用日本自建节点组，下一条日本服务使用日本节点，之后直连服务使用 DIRECT，证明 force-policy 与插入资源生效。
- 本次新增 quantumultx-rules.ts 专门处理资源布局与规则正文，服务接口只读取指定规则源及嵌套依赖；未恢复独立 QX 配置维护。

## 2026-10-31 内置规则刷新
- 原手动全量刷新包含规则与图标；机场节点缓存不在 manifest.list 内，由 QX 构建按需读取维护。
- 新增服务生命周期内的自动检查，启动立即检查，此后每 5 分钟检查，按各 rule-provider interval 到期刷新，缺省 24 小时；仅刷新远程规则，跳过 source=local 和所有图标。
- 自动/手动刷新通过独立互斥锁串行；关闭时取消自动下载并清理定时器。
- 下载完成后先验证非空、非 HTML 及对应 text/YAML 格式，再写入临时文件并 rename；失败保留旧文件、大小和成功更新时间，记录错误供后续重试。
- 实际启动已自动刷新 Direct.list；模板/自定义配置/密钥/机场缓存/图标/本地规则的前后哈希一致。
- 原两条 Cron 已备份并移除；QX 客户端资源仍按自身周期拉取 Myops，服务端刷新不向客户端推送。

## 2026-11-03 自定义规则派生文件缺失
- 远程 claude 规则接口实际返回 Myops 的 resource not found；Proxy/Reject 当前 HTTP/1.1、HTTP/2 均下载完整，是另一个暂未复现的传输问题。
- writeCustomRuleFiles 仅由配置 PUT 调用；syncManifest 只登记 local 资源，refreshDueRules/refreshResources 跳过 local，因此同步 conf 或重启不能补齐缺失文件。
- ConfigSyncService 由 CLI 使用，直接 git pull 也可更新 conf，因此修复应放在 Clash 自身的同步和读取流程，避免只覆盖某一种同步入口。
- 修复后自定义文件在清单同步时生成、订阅生成前同步、静态资源请求时校准；保持原有密钥校验及未知/已删除资源 404。
- 原有 QX 资源失败测试存在启动异步刷新未结束就删除文件的竞态，已通过等待实际启动刷新 Promise 消除，未放宽请求次数断言。
- 76 项相关测试及完整构建通过，临时部署逐步复现的原 404 均已变为 200；conf 仍是唯一自定义规则来源，data 内文件为自动派生产物。
