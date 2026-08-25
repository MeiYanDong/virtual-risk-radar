# 工程质量基线与收尾审查

审查日期：2026-08-24
适用范围：v0.3 最小双源只读系统，即 TechFlow 免费公开快讯、Binance Spot 四资产流、Sell/Rebuy 状态机、TechFlow 逐条新闻审计、Shadow 证据日志、只读 API 与进度驾驶舱。v0.2 RPC/DEX/链能力仅作为不可达的历史研究代码保留。

## 开工前审查结论

| 检查项 | 开工前结论 | 证据与影响 |
|---|---|---|
| 关键路径和高风险边界测试 | `PARTIAL` | v0.2 已有测试，但没有 v0.3 TechFlow 页面漂移、Binance 八流、四条件 Sell/Rebuy、两源 runtime 和新驾驶舱断言；不能把旧 140 项测试当作新需求证据。 |
| lint、格式、类型、测试门禁 | `PRESENT_BUT_V02` | `pnpm run ci` 和 GitHub Actions 定义已存在，但检查的是旧 schema 与旧能力，必须迁移后重新执行。 |
| CI/CD 与部署后验证 | `CI_REPOSITORY_RECORD_ONLY` | `.github/workflows/ci.yml` 存在；仓库无 commit、无 remote、无 Actions run。CD 未配置，部署后 readback 未运行。 |
| 变更文档、tech specs、ADR、提交信息 | `PARTIAL` | v0.2 文档较完整，但与“免费双源、无 RPC”新方向冲突；Git 无提交历史，不能虚构清晰提交信息。 |
| 工具统一代码风格 | `PRESENT` | TypeScript/React/JSON/Markdown 使用 Biome，Python 使用 Ruff；需要在新文件上重新验证。 |
| 简单、清晰、避免无用抽象 | `GAP_P0` | v0.2 活跃入口仍包含链、DEX quote、衍生品和多源概念，违背最少必要链路；需要收敛 composition root，而不是删除全部历史代码。 |
| 小型故事卡与验收标准 | `PLANNED` | `docs/todo.md` 已有稳定 v0.3 ID，但当时尚无实现证据，不能勾选。 |

## 本次真正需要的最小改进计划

1. 冻结 v0.3 活跃配置、source registry、状态机和 API：外部输入必须恰好为 TechFlow 与 Binance，其他能力显式 `UNSUPPORTED`。
2. 实现并测试 TechFlow 公共页面 adapter、Binance Spot 八流 adapter、四条件 Sell/Rebuy 引擎和 append-only Shadow journal。
3. 用一个 composition root 串起两源，不迁移、不重写 v0.2 研究代码；旧命令统一加 `legacy:v0.2:*` 前缀并退出默认启动路径。
4. 建立 2026-08-22 v0.3 received-time-only 回放，并保留旧报告；结果只能是 `CEX_REFERENCE`。
5. 重做最小驾驶舱，补组件、API、runtime、回放测试和真实桌面/移动浏览器检查。
6. 重新运行唯一门禁 `pnpm run ci`，再做当前进程 readback；60 分钟 soak、30 事件和 14 天 Shadow 只能随真实时间积累，不提前勾选。

## 当前已满足的质量基线

| 基线 | 当前结论 | 可复核证据 |
|---|---|---|
| 关键路径与高风险边界测试 | `PASS_LOCAL` | 31 个测试文件、230 项 TypeScript/React 测试和 8 项 Python 契约测试通过。断言覆盖新闻不能单独卖出、四项全通过、三种逐条新闻判断、120 分钟边界、revision 不可覆盖、180 天清理、30 秒 stale、卡死超时、分页/筛选/正文边界、卖出上下文、买回重置、单资产 stale、ID gap、高频窗口、两源 API、append-only journal 和只读能力。 |
| 覆盖率门禁 | `PASS_LOCAL` | statements 89.98%、branches 81.43%、functions 92.13%、lines 93.15%；均高于仓库阈值并由总门禁执行。 |
| lint/格式/类型/Schema/测试自动化 | `PASS_LOCAL` | `pnpm run ci` 统一执行 Biome、只读/秘密扫描、TypeScript strict、30 份 schema freshness、历史 fixture 校验、Vitest coverage、Ruff、Mypy、Pytest、依赖审计、许可证和生产构建。 |
| CI 合并前定义 | `PASS_REMOTE_PRIOR_COMMIT / NOT_RUN_CURRENT_CHANGE` | 公开仓库的 `.github/workflows/ci.yml` 使用冻结 lockfile 和 Node 22/Python 3.12 后执行 `pnpm run ci`；首次远端 push run [32646971643](https://github.com/MeiYanDong/virtual-risk-radar/actions/runs/32646971643) 成功，但当前新闻审计变更尚未提交和推送，不能用该旧 run 证明本次变更。 |
| CD 与部署后运行验证 | `NOT_CONFIGURED` | 本地 `127.0.0.1:8787` 已做当前进程读回；没有部署目标、CD 或部署后 receipt，不能声称已发布。 |
| 变更文档、tech specs 与 ADR | `PASS_REPOSITORY_RECORD` | README、v0.3 runbook、known limitations、change log、source registry/storage/field/test specs、生成 schema、ADR-0012/0013、质量审查和实施日志均已更新。 |
| 工具统一代码风格 | `PASS_LOCAL` | Biome 检查 126 个文件无诊断；Python 文件通过 Ruff 格式和 lint。生成 schema 由 `schema:check` 字节级校验。 |
| 简单清晰的结构 | `REVIEWED_LOCAL` | 活跃 runtime 只有 TechFlow adapter、Binance adapter、确定性决策/新闻 gate、Shadow journal 和新闻审计 journal；没有 RPC、钱包、DEX、LLM、第二新闻源或消息中间件进入热路径。 |
| 小型可验收故事卡 | `PASS_ACTIVE_SCOPE` | v0.3 任务按 A–H 拆分；实现项有测试/读回后才勾选，60 分钟、30 事件和 14 天任务继续未勾选。 |
| 浏览器可用性 | `PASS_LOCAL_BROWSER_QA` | 首页入口、`/news` 直达/刷新/返回、筛选、搜索、详情展开和官网外链均在真实桌面与 390×844 视口复核；手机无横向溢出，键盘 `Tab + Enter` 可展开，读者界面原生字段扫描为空，控制台 0 error / 0 warning。截图保存在 `output/playwright/v3-news-audit-*.png`。 |

## 门禁中发现并修复的真实问题

1. v0.2 生成 schema 原本仍占用无前缀文件名，容易被误认为活跃契约。现在 v0.3 使用无前缀活跃 schema，旧契约统一加 `legacy-v0.2-*`，检查器会拒绝残留文件。
2. Python 契约测试仍引用已经归档的 `decision-snapshot` 与 `news-observation` 文件名，导致总门禁失败。测试现同时验证 v0.3 和显式 legacy ID，8 项测试通过。
3. 未补齐的 Binance aggregate trade gap 原本会永久阻塞后续条件。现在 gap 只影响与之重叠的 60 秒决策窗口，历史 gap 计数与完整率仍永久保留。
4. VIRTUAL stale 状态曾可能污染只依赖 BTC/ETH/SOL 的跨资产条件。依赖已隔离；每个条件只因自身输入失效。
5. 冷启动时重新看到旧 TechFlow 标题曾可能重新武装风险。现在同时检查来源发生时间与接收年龄，过期标题不重新触发。
6. 初次覆盖率运行中，旧重放脚本在 instrumentation 下超过默认超时。保留业务断言，增加确定性缓存并为重型历史测试设置明确 30 秒上限；总门禁最终通过。
7. 真实浏览器在服务重启间隙记录过 4 个 502。服务恢复后重新加载并复验，当前浏览器收据为 0 error / 0 warning；旧错误没有被冒充成最终结果。
8. 首轮 live soak 的 `aggTrade` 延迟随时间升至分钟级。独立新连接证明 Binance 与本机时钟正常，根因是高频 `bookTicker` 每条都同步执行整套决策/schema，加上数组头部逐条 `shift`。现在行情快速入窗、决策每秒批量评估，窗口使用游标分段压缩；v0.3.1 当前会话四资产 aggTrade p95 为 71–98 ms、p99 最高 101 ms，并加入 10,000 条高频窗口回归测试。
9. 原页面只能看到进入主决策链的消息，无法证明被过滤快讯是否真的被采集和判断。现在每个成功解析的 TechFlow 独立 ID 都先写入不可变新闻审计 journal，再由 `/news` 展示采纳、过滤或复核原因；重复 hash 幂等，内容变化保留 revision。
10. TechFlow 最后一次成功状态原本不会仅因后续静默而动态过期，且只依赖 `AbortSignal` 不能防住忽略 abort 的 fetch/body。现在 30 秒门禁按当前时钟重新计算，并以显式 deadline race 保证卡住的单轮不会永久停止后续轮询。

## 仍未闭环的问题

| 优先级 | 缺口 | 影响与停止边界 |
|---|---|---|
| P0 | TechFlow 与 Binance 当前 60 分钟 soak 仍为 `IN_PROGRESS` | 已开始记录真实指标，但未满 60 分钟前，`V3-B030/V3-C030/GATE-B/GATE-C` 不勾选，不能声称实时稳定。 |
| P0 | 历史验证仍为 1/30；连续 Shadow 未达到 14 天 | 不能校准极端市场备用阈值，不能给出稳定经济结论；保持 `NOT_CALIBRATED/POSITIVE_EV_NOT_PROVEN`。 |
| P0 | 没有 DEX 成交、钱包或执行收据 | 所有价格与信号仅为 `CEX_REFERENCE`；用户必须在 DEX 钱包检查即时 quote。 |
| P1 | TechFlow 是单一公共网页且无已核实 API/RSS/SLA/再分发许可 | 页面漂移、403/429 或服务中断会进入 `DATA_UNAVAILABLE`；按产品决定不启用隐蔽接口或第二来源兜底。 |
| P1 | 新闻判断是冻结的确定性规则，不是事实真值 | 含蓄措辞、新政策类型或分类器词表外表达可能被误判；`/news` 提供逐条人工核对，但在 30 个跨类型事件完成前不能声称低漏报或低误报。 |
| P1 | CD 未配置，部署后 readback 未运行 | GitHub Actions 已通过，但这只证明代码门禁；没有部署目标或部署后 receipt，不能声称线上服务已发布。 |
| P2 | 公开仓库暂未添加开源许可证 | 代码可公开查看，但未向第三方授予明确复用许可；选择许可证需要用户单独决定。 |
| P2 | 当前 Node 运行时对 `node:sqlite` 输出 ExperimentalWarning | 不影响本地测试结果，但选择长期部署运行时前需要重新评审 driver 稳定性。 |

## 可复现命令与当前结果

```sh
pnpm run ci
# PASS: 31 files / 230 tests; Python 8 tests
# Coverage: statements 89.98 / branches 81.43 / functions 92.13 / lines 93.15
# Biome 126 files; SCHEMA_CURRENT count=30; READ_ONLY_BOUNDARY_OK scanned=212
# Node/Python dependencies: no known vulnerabilities
# LICENSE_GATE_OK; Vite production build PASS

pnpm fixture:analyze:v3:2026-08-22
# SELL_READY 2026-08-22T05:07:35.999Z
# REBUY_READY 2026-08-22T05:24:47.999Z
# CEX_REFERENCE; execution/Dex realizability UNKNOWN; POSITIVE_EV_NOT_PROVEN

PORT=8787 pnpm start
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/status
curl --fail http://127.0.0.1:8787/api/config
curl --fail 'http://127.0.0.1:8787/api/news/audit?limit=50'
# VERIFIED_CURRENT local process; activeSources exactly TechFlow + Binance
# 9 observed TechFlow items at 2026-08-23T16:11:59Z; all had a persisted judgment
# RPC / DEX quote / wallet read / write capabilities = UNSUPPORTED

pnpm shadow:report:v3
# IN_PROGRESS; see output/reports/v3-shadow-status.json
```

远程 GitHub Actions：旧提交 `PASS`（[run 32646971643](https://github.com/MeiYanDong/virtual-risk-radar/actions/runs/32646971643)）；当前新闻审计变更 `NOT_RUN`
CD：`NOT_CONFIGURED`  
部署后 runtime readback：`NOT_RUN`  
本地实时进程：`VERIFIED_CURRENT`，但 source soak 尚未完成 60 分钟  
经济结论：`POSITIVE_EV_NOT_PROVEN`
