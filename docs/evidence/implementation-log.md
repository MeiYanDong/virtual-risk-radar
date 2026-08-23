# 实施证据日志

## 2026-08-22 / Batch 0 / 工程启动

状态：`COMPLETE_LOCAL`

- 初始化本地 Git `main`；未创建 commit 或 remote。
- 创建 TypeScript/Python workspace、README、贡献规则、安全策略、ADR、specs 与 GitHub Actions CI 定义。
- 统一本地门禁命令为 `pnpm run ci`；`pnpm ci` 仅为 pnpm 安装别名，不能作为项目门禁收据。

## 2026-08-22 / Batch 1 / 读取、存储与能力边界

状态：`COMPLETE_LOCAL`

- 实现 `Knowledge<T>`、`DecimalString`、核心 schemas、18 份生成 JSON Schema 和 Python 共享校验。
- 实现内存/JSONL/SQLite append-only ledger，SQLite update/delete trigger 阻止改写历史。
- 实现 Parquet 临时文件 + fsync + atomic rename + checksum manifest，DuckDB 只读视图和 retention dry-run。
- 实现严格 JSON-RPC 读允许列表；签名、授权、广播、私钥参数和交易 HTTP 路由不存在。

## 2026-08-22 / Batch 2 / 新闻、特征、决策与回放

状态：`COMPLETE_LOCAL_FIXTURE`

- 保存 10 份 Binance 公开历史数据文件，119,037 条规范化记录，绑定 checksum/manifest。
- 新闻 fixture 将加拿大传播链聚为一个事件，伊朗消息保持独立；TechFlow 只提高 attention。
- 回放只按 `received_at` 可见，支持 pause/resume/speed/seek/step；同一输入连续三次字节一致。
- 已证伪旧 `13:05:01`/`13:07:13` 边界；更正为 13:05:06.999/13:07:16.999（Asia/Shanghai）。
- risk-arm 前 OI baseline 为 24,008,321.6 contracts；最大冲洗 -4.715481%，未达 -5%。
- Base/Robinhood 历史 DEX quote 均为 `UNKNOWN:not_recorded`；无 sell fact，Rebuy 保持 inactive，不创建 Shadow fill 或收益。

## 2026-08-22 / Batch 3 / API、驾驶舱与 Base 读回

状态：`COMPLETE_LOCAL_READ_ONLY`

- 只读 Fastify API 覆盖 status/config/capabilities/decision/conditions/quotes/news/timeline/health/wallet/models/replay manifest/OpenAPI。
- React 驾驶舱显示 Sell 3/4、Rebuy 3/5、独立 hard gates、Base/Robinhood 状态、精确 OI 缺口，并固定显示“进度 ≠ 概率”与 `POSITIVE_EV_NOT_PROVEN`。
- `pnpm chain:verify:base` 在 2026-08-22T09:31:30.636Z 读回 chainId 8453、block 50300871、合约 code、18 decimals、symbol VIRTUAL、name Virtual Protocol。这只证明 ERC-20 身份，不证明结算资产、路由、流动性、报价或钱包可执行。
- 本地服务在 `127.0.0.1:8791` 返回 health/status/conditions readback 后已停止；不是部署收据。

## 2026-08-22 / Batch 4 / 完整本地质量门禁

状态：`PASS_LOCAL`

执行：`pnpm run ci`

- Biome format/lint：PASS（无诊断）；只读边界扫描 `READ_ONLY_BOUNDARY_OK scanned=146`。
- TypeScript strict：PASS。
- JSON Schema：`SCHEMA_CURRENT count=18`。
- 历史 fixture：`FIXTURE_VERIFIED files=10`。
- Vitest：16 files / 114 tests PASS。
- Coverage：statements 90.64%，branches 82.17%，functions 95.77%，lines 94.13%；阈值 PASS。
- Python：Ruff/Mypy PASS，Pytest 8 PASS。
- 依赖漏洞：Node 与项目 Python 运行依赖均无已知漏洞。
- 生产许可证：BSD-3-Clause/ISC/MIT，PASS。
- Vite production build：PASS，JS 190.26 kB（gzip 60.20 kB）。

## 2026-08-22 / Batch 5 / Base 固定数量双源报价研究

状态：`COMPLETE_LOCAL_READ_ONLY`

- 按用户确认固定 `1,000 / 5,000 / 10,000 VIRTUAL`，不收集、不读取、不公开 Base 钱包地址。
- 结算资产绑定 Base 原生 USDC；主源为 Velora `/prices` SELL，独立校验为 canonical Uniswap V3 VIRTUAL/USDC 直接池 QuoterV2。
- 实现链 ID、VIRTUAL/USDC decimals/symbol/code、pool token0/token1/fee/factory 和 Quoter 的硬身份校验；错身份阻断整个快照。
- 实现 5 秒 TTL、2 块最大滞后、100 bps 双源偏差研究边界和 50 bps 研究 minimum-out buffer；数据源失败保留 `ERROR/PARTIAL/STALE/UNKNOWN`。
- 只读 RPC 仅允许查询方法，实现小批量串行、有界重试和 endpoint credential redaction；不存在 calldata、simulation、approval、sign、broadcast 或 fill 路径。
- 当前完整读回中三档均通过：Velora 为 `687.702722 / 3438.547061 / 6876.889276 USDC`，Uniswap 直接池为 `683.891613 / 3416.413505 / 6825.230839 USDC`，偏差 `55.7268 / 64.7859 / 75.6875 bps`。这是 2026-08-22T12:20:42Z–12:20:44Z 的当时快照，不是当前价承诺。
- 首次长时间运行发现 Velora 可选 `poolAddresses` 中存在 provider-specific 非地址标识；旧解析器的 115 条快照作为中止证据保留。修复后只过滤未受信可选元数据并记录哈希，不放松核心报价字段；2026-08-22T13:17:31Z 的当前读回真实命中该过滤分支且三档仍 PASS。
- 实现独立 4 秒报价轮询、三档条件进度条、下一缺口、明确成本/EV/模拟/执行 gates，以及 `0600` append-only JSONL 证据日志与成功/延迟统计。
- 真实桌面与 390px 移动端浏览器 QA 通过，390px 下 `scrollWidth=clientWidth=390`；这不等于自动可访问性或全浏览器矩阵通过。
- 最终版 quote soak 运行 3,600.001 秒，`minimumSixtyMinutesSatisfied=true`；308 attempts / 304 successes（98.70%），301 PASS / 3 PARTIAL / 0 BLOCKED 快照，909/912 档位双源 PASS（99.67%）。
- 浸泡延迟 p50/p95/p99 为 1.385/2.217/3.640 秒；4 次公共 RPC 整快照失败，3 个 Velora 档位降级（2 `fetch failed` + 1 timeout），Uniswap 直接池 912/912 KNOWN，无 STALE/BLOCKED/偏差 FAIL。
- 30 个快照真实命中非地址路由标签过滤分支；双源偏差观测范围为 0.5054–79.9759 bps，未超 100 bps 研究边界。
- 报告与 304 条 JSONL 原始记录已逐项重算一致，两个文件均为 `0600`。这份收据只证明报价可用性与自洽性，不证明交易收益。

### Batch 5 本地门禁收据

- `pnpm run ci`：PASS。
- Biome format/lint：PASS；只读边界扫描 `READ_ONLY_BOUNDARY_OK scanned=162`。
- TypeScript strict：PASS；JSON Schema `SCHEMA_CURRENT count=21`；fixture `FIXTURE_VERIFIED files=10`。
- Vitest：18 files / 140 tests PASS。
- Coverage：statements 90.43%，branches 80.32%，functions 96.28%，lines 93.80%；阈值 PASS。
- Python：Ruff/Mypy PASS，Pytest 8 PASS。
- Node/Python 运行依赖无已知漏洞；生产依赖许可证门禁 PASS；Vite production build PASS。

## 2026-08-23 / Batch 6 / v0.3 最小双源系统

状态：`COMPLETE_LOCAL_IMPLEMENTATION / SHADOW_IN_PROGRESS`

- 活跃配置、source registry、状态机、API 和 UI 已收敛为恰好两条外部输入：TechFlow 免费公开 7×24h 页面与 Binance Spot；RPC、链、DEX quote、钱包、衍生品、第二新闻源、第二交易所和付费源均退出 v0.3 runtime。
- v0.2 代码和证据未做不可逆删除；旧命令统一为 `legacy:v0.2:*`，旧 schema 统一为 `legacy-v0.2-*`。活跃 schema 无旧能力命名，当前生成文件共 30 份。
- TechFlow adapter 仅解析公开快讯列表；实现稳定 ID/hash/revision、10 秒保守轮询、ETag/Last-Modified、0600 cursor、重启恢复、coverage gap 与 403/429/5xx/login/schema/empty/time fail-visible。当前公开列表与详情 fixture 含取得时间、URL 和 SHA-256。
- Binance adapter 只订阅 BTC/ETH/SOL/VIRTUAL 的 `aggTrade + bookTicker` 共八流；实现 taker side、名义金额、滚动 60 秒回报、相对收益、主动买卖比、去重、乱序、重连、freshness、gap 和逐流延迟/完整率指标。
- Sell 与 Rebuy 均固定为 4/4 确定性条件。新闻单独只能 `NEWS_ARMED`，普通 Binance-only 压力只能 `MARKET_ARMED`；极端市场备用路径在校准前保持 `NOT_CALIBRATED`。Rebuy 必须具有用户卖出事实或 Shadow 参考卖出上下文。
- 2026-08-22 v0.3 received-time-only 回放只使用 TechFlow item 133044 和 Binance Spot 数据；发现并保留 20 个 aggregate-ID gap，只阻断重叠的 60 秒窗口。第一处 `SELL_READY=2026-08-22T05:07:35.999Z`，第一处 `REBUY_READY=2026-08-22T05:24:47.999Z`。
- 回放没有 DEX quote、钱包、RPC、期货、OI、funding、第二媒体或第二交易所输入；结论为 `V3_SHADOW_SIGNAL_REPRODUCED_WITH_SPOT_ONLY_INPUTS`，但执行收据和 DEX 可实现性仍为 `UNKNOWN`，经济证据仍为 `POSITIVE_EV_NOT_PROVEN`。
- 当前 append-only `data/runtime/v3-shadow-v0.3.1.jsonl` 和 TechFlow cursor 为 `0600`；journal 具 sequence/payload hash 校验、fsync、并发串行和重启续写。报告仅累计相邻不超过 30 秒的真实样本，休眠和停机不计时，经过 60 分钟也不会自动通过质量评审。
- 首轮 live 指标发现 combined stream 因逐消息执行整套决策/schema 且滚动数组逐项 `shift` 而积压，aggTrade 延迟升至分钟级。独立 Binance 新连接证实本机与服务器时钟只差约 381 ms、原始延迟约 -16–24 ms；修复为快速入窗 + 每秒批量评估 + 游标压缩后，新会话四资产 aggTrade p95 为 60–71 ms、p99 最高 134 ms、最大 208 ms。
- 因上述性能问题会污染实时性结论，配置版本升为 `0.3.1` 并切换到新的 journal。旧 `data/runtime/v3-shadow.jsonl` 原样保留为诊断证据，但其中的观察时间不再计入当前 60 分钟/14 天验证。
- 最小驾驶舱只显示两源健康、四资产 Spot、Sell 4 条、Rebuy 4 条、当前/阈值/差距/持续时间/年龄/证据，并固定显示 CEX/DEX 边界；不显示链、钱包、quote、衍生品或伪概率。
- 真实桌面和 390×844 移动视口 QA 通过；键盘 `Tab + Enter` 可展开证据，最终刷新后浏览器控制台 0 error / 0 warning。收据：`output/playwright/v3-desktop-live.png`、`output/playwright/v3-mobile-live.png`。

### Batch 6 本地总门禁收据

执行：`pnpm run ci`

- Biome format/lint：118 files PASS；只读与秘密扫描 `READ_ONLY_BOUNDARY_OK scanned=203`。
- TypeScript strict：PASS；JSON Schema `SCHEMA_CURRENT count=30`；历史 fixture `FIXTURE_VERIFIED files=10`。
- Vitest coverage：27 files / 212 tests PASS。
- Coverage：statements 89.97%，branches 82.03%，functions 92.28%，lines 93.25%；阈值 PASS。
- Python：Ruff/Mypy PASS，Pytest 8 PASS；活跃 v0.3 与显式 legacy schema ID 均受跨语言契约测试。
- Node/Python 项目依赖均无已知漏洞；生产许可证 Apache-2.0/BSD-3-Clause/ISC/MIT，PASS。
- Vite production build：PASS，JS 191.91 kB（gzip 60.90 kB），CSS 9.84 kB（gzip 2.76 kB）。

### Batch 6 当前进程 readback

- `PORT=8787 pnpm start`：本地 v0.3 两源 runtime 正在运行。
- `/api/health`：`externalInputCount=2`，active sources 恰好为 TechFlow 与 Binance；write/RPC/DEX quote/wallet read 均为 `UNSUPPORTED`。
- `/api/status`：`source=LIVE_TWO_SOURCE_RUNTIME`、`evidenceLevel=VERIFIED_CURRENT`、`outputBasis=CEX_REFERENCE`。Binance 某个必要流超过 5 秒 freshness 时会真实显示 `STALE/DATA_UNAVAILABLE`，不会补 0。
- `/api/conditions/current?model=SELL&chain=base`：HTTP 400，返回 `chain is outside v0.3`。
- `/api/openapi.json`：15 个只读 GET 路径；无 wallet/quote/chain/RPC/sign/broadcast/execute/approve 路径。
- `pnpm shadow:report:v3`：`IN_PROGRESS`；当前报告见 `output/reports/v3-shadow-status.json`，未满 60 分钟和 14 天，不记为通过。
- v0.3.1 当前 epoch 收据（2026-08-23T11:43:58Z）：最新会话 159,023 ms（60 分钟进度 4.42%），连续有效 Shadow 151,156 ms（14 天进度 0.0125%）；39 条 journal 记录 sequence/hash 校验通过。
- 同一时点 TechFlow 16/16 polls 成功、0 gap、无错误码；Binance 0 reconnect、0 gap，四资产 aggTrade p95 为 71–98 ms、p99 为 98–101 ms。VIRTUAL 因超过 5 秒没有新成交在读回时为 `STALE`，系统正确进入 `DATA_UNAVAILABLE`，没有伪造 0。

## 2026-08-23 / Batch 7 / 前端读者语言收敛

状态：`COMPLETE_LOCAL_UI`

- 用户确认默认前端不应暴露大量后台原生字段；首页现按“当前结论 → 价格与宏观背景 → 减仓/回补条件”的阅读顺序组织。
- 两源卡片收敛为新闻/行情健康摘要；移除 transport、capability、消息计数、stage/output、evidence tape、证据 ID 和来源年龄表格。
- 条件仍保留 8 条独立进度条，但只显示中文状态、“现在怎样”和“还差什么”；后台 API、journal、schema 和证据链未删改。
- 桌面与 390×844 移动端真实浏览器复核完成；页面标题为“VIRTUAL 风险雷达”，控制台 0 error / 0 warning。
- 组件防回归测试断言读者界面不出现 `CEX_REFERENCE/SHADOW_CANDIDATE/NEWS_ARMED/VERIFIED_CURRENT/PUBLIC_WEBPAGE/STALE` 或 evidence tape。
- 最终 `pnpm run ci`：PASS；format/lint、只读边界、TypeScript、30 schemas、10 fixtures、27 files / 212 tests、覆盖率门槛、Python 8 tests、Node/Python 漏洞审计、许可证和生产构建全部通过。桌面/移动收据：`output/playwright/v3-human-readable-desktop.png`、`output/playwright/v3-human-readable-mobile.png`。

## 外部状态

- GitHub Actions 远程 run：`NOT_RUN`（仓库无 commit/remote）。
- CD：`NOT_CONFIGURED`。
- 部署后 runtime readback：`NOT_RUN`。
- 60 分钟 TechFlow/Binance soak：`IN_PROGRESS`。
- 30 事件经济验证：`NOT_COMPLETE (1/30)`。
- 14 天 Shadow：`IN_PROGRESS`，未达到时间和风险窗口要求。
- 极端市场备用阈值：`NOT_CALIBRATED`。
- 签名/授权/广播：`UNSUPPORTED`。
- 经济结论：`POSITIVE_EV_NOT_PROVEN`。
