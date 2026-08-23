# VIRTUAL 风险规避与回补决策系统——可执行开发任务清单

> 文档版本：v0.3（最小双源活跃清单；保留 v0.2 历史证据）  
> 编制日期：2026-08-22；范围修订：2026-08-23（Asia/Shanghai）  
> 需求基线：[plan.md](./plan.md)  
> 当前工程状态：v0.2 本地只读垂直切片与 Base quote 研究证据保留，但已退出活跃产品；v0.3 仅实施 TechFlow 免费快讯 + Binance Spot + Sell/Rebuy 进度驾驶舱  
> 当前经济证据：`POSITIVE_EV_NOT_PROVEN`  
> 当前权限边界：`REPLAY + SHADOW + LIVE_READ_ONLY`；禁止签名、授权与广播。

> v0.2 历史收据：`pnpm run ci` 本地通过（140 TypeScript + 8 Python tests）；旧口径为 382/824，现已因范围重置而失效，不能继续作为 v0.3 进度。Base quote soak 等结果只作为历史研究证据。GitHub Actions `NOT_RUN`，CD `NOT_CONFIGURED`，Shadow `0/14 days`，历史事件 `1/30`。证据索引见 `docs/evidence/implementation-log.md`。

---

## 0. 使用规则

### 0.1 勾选规则

- `[ ]`：尚未完成，或只有部分实现、没有完成证据。
- `[x]`：任务及其完成标准全部满足，并且已有可复核证据。
- `[x] ... [SUPERSEDED]`：用户已决定该能力退出产品范围；表示范围处置完成，不表示功能曾被实现。
- `BLOCKED: USER_INPUT`：需要用户提供信息；保持未勾选，但不一定阻塞其他阶段。
- `BLOCKED: EXTERNAL`：依赖第三方数据、许可、网络或服务状态。
- `GATED: AUTHORIZATION`：当前明确禁止实施，只有用户另行授权后才能开始。
- `OPTIONAL`：不影响当前主路径，可在核心门槛通过后实施。

勾选任务时，必须在任务下方或对应 PR/提交中留下至少一种完成证据：

- 测试命令与通过结果；
- fixture/replay 报告；
- schema/API 快照；
- 当前运行 readback；
- 数据覆盖与延迟报告；
- 历史 receipt 或真实链上证据；
- 用户决策记录。

不得因为以下情况勾选完成：

- 代码文件存在但没有测试；
- 配置写入但运行时没有读取；
- API 返回 200 但数据语义错误；
- TechFlow 页面返回 HTTP 200 但快讯解析、时间或语义无效；
- Binance WebSocket 曾连接成功但当前数据已过期或存在未声明 gap；
- Shadow 只有 CEX 参考结果却被写成 DEX 可实现收益；
- 单次事件表现正向但未完成验证；
- `UNKNOWN` 被临时填成 0、PASS 或 FAIL。

### 0.1A v0.3 权威清单规则

从 2026-08-23 起，只有下方“v0.3 活跃任务”计入产品进度。后续 `Phase 0–12` 保留为 v0.2 需求、实现和测试证据索引；其中未迁移到 v0.3 活跃清单的任务一律视为 `SUPERSEDED/OUT_OF_SCOPE`，不得继续实施，也不得为了数字好看批量勾选。

v0.3 固定边界：

```text
新闻：TechFlow 免费公开 7×24h 快讯，唯一来源
市场：Binance Spot，唯一来源
资产：BTC / ETH / SOL / VIRTUAL
行动：Sell/Rebuy 只读参考信号 + 进度条
执行：用户在 DEX 钱包手动检查 quote 与执行
禁止：RPC、链上监听、DEX quote、钱包读取、衍生品、第二交易所、第二新闻源、付费源、签名、广播
```

---

## v0.3 活跃任务：最小双源系统

### A. 产品范围重置

- [x] **V3-A001** 用户确认新闻源必须免费，TechFlow 是 v0.3 唯一 live 新闻源。
- [x] **V3-A002** 用户确认 RPC、链上监听、DEX quote 和钱包读取退出监测与决策系统。
- [x] **V3-A003** 用户确认不按加拿大或任何国家建设专用链路，改用全球宏观事件类型。
- [x] **V3-A004** 接受 Binance Spot 为唯一市场源；第二交易所和衍生品退出活跃范围。
- [x] **V3-A005** 确认正常路径为“TechFlow 宏观武装 + Binance 市场确认”，新闻不能单独卖出。
- [x] **V3-A006** 确认 TechFlow 缺失时保留更严格的 `EXTREME_MARKET_BREAKDOWN` 备用路径；阈值未回放前保持 `UNKNOWN`。
- [x] **V3-A007** 确认系统只输出 `CEX_REFERENCE`，实际价格由用户在 DEX 钱包即时 quote 决定。
- [x] **V3-A008** 更新 `docs/plan.md`，建立 v0.3 权威覆盖并标记 v0.2 冲突要求失效。
- [x] **V3-A009** 更新 `docs/todo.md`，停止使用旧 382/824 进度口径。

### B. TechFlow 免费快讯采集

- [x] **V3-B001** 将 TechFlow `https://www.techflowpost.com/newsletter` 登记为 `PUBLIC_WEBPAGE/FREE`；`official_api/rss/SLA/redistribution_license` 保持 `NOT_VERIFIED`。
- [x] **V3-B002** 保存一组当前公开列表页与详情页 fixtures，包含页面取得时间、URL、内容 hash 和最小必要 HTML；不得保存登录态或私有接口数据。
- [x] **V3-B003** 实现一个 TechFlow adapter，只读取最新快讯列表，不抓取文章、研究、活动或全站 sitemap。
- [x] **V3-B004** 解析快讯标题、页面发布时间、详情 URL、原始链接、必要正文、来源归因和分类标签；缺失字段保持 `UNKNOWN`。
- [x] **V3-B005** 生成稳定 `source_item_id` 和 `raw_text_hash`，列表自动刷新、重复出现或详情 revision 不得重复触发。
- [x] **V3-B006** 使用可配置的保守轮询；初始研究值 10 秒，若服务端支持 ETag/Last-Modified 则使用条件请求。
- [x] **V3-B007** 对 HTTP 403/429/5xx、登录墙、页面结构漂移、时间解析失败和空列表显式输出 source health，不改用隐蔽接口。
- [x] **V3-B008** 只保存内部决策所需内容，不提供 TechFlow 正文再分发 API 或批量导出。
- [x] **V3-B009** 实现 cursor/last-seen 恢复；重启后不重复摄入，同时对无法确认的漏页区间写 coverage gap。
- [x] **V3-B010** adapter capability readback 必须准确显示 `PLANNED/TESTED/VERIFIED_CURRENT/UNSUPPORTED`，HTTP 200 不自动等于语义可用。
- [x] **V3-B020** 测试正常列表、置顶、同秒多条、跨日、空列表、重复、修改、删除、中文时间、详情缺失和原始链接缺失。
- [x] **V3-B021** 测试页面 schema 漂移时 fail-visible，不能返回旧数据冒充新鲜。
- [x] **V3-B022** 测试 TechFlow 快讯单独只能进入 `NEWS_ARMED`，不能产生 `SELL_READY`。
- [ ] **V3-B030** 运行至少 60 分钟采集 soak，报告成功率、重复率、空窗、接收延迟、429/5xx 和数据年龄；未运行不得声称实时稳定。`IN_PROGRESS`，证据见 `output/reports/v3-shadow-status.json`。

完成证据：`packages/news-adapters/src/techflow.ts`、`tests/fixtures/techflow/2026-08-23/`、`tests/unit/techflow-adapter.test.ts`、`tests/unit/v3-decision-engine.test.ts`、`docs/evidence/implementation-log.md` Batch 6。

### C. Binance 唯一市场流

- [x] **V3-C001** 实现/收敛通用 `MarketSourceAdapter`，live 配置只允许 Binance Spot。
- [x] **V3-C002** 接入 `BTCUSDT/ETHUSDT/SOLUSDT/VIRTUALUSDT` 的 `aggTrade` 与 `bookTicker`。
- [x] **V3-C003** 正确映射 taker side，并计算成交名义金额、主动卖压和滚动覆盖率。
- [x] **V3-C004** 实现心跳、断线重连、重复去除、乱序处理和无法补齐的 coverage gap。
- [x] **V3-C005** 任一必要交易对超过 freshness 阈值时，仅隔离依赖条件并显示明确缺口；不得启用第二交易所或旧数据兜底。
- [x] **V3-C006** 删除 live 配置中的第二交易所、衍生品、OI、清算和 funding 依赖；历史 fixture 可继续读取但不得进入 v0.3 runtime。
- [x] **V3-C020** 测试四交易对正常、重复、乱序、断线、单资产 stale、跨午夜和 maker/taker 边界。
- [ ] **V3-C030** 运行至少 60 分钟 live soak，保存每对消息率、完整率、gap、重连、p50/p95/p99 接收延迟和 freshness。`IN_PROGRESS`，逐流指标见 `/api/soak/current` 与 `output/reports/v3-shadow-status.json`。

完成证据：`packages/market-adapters/src/binance.ts`、`packages/market-adapters/src/window.ts`、`tests/unit/binance-spot-adapter.test.ts`、当前进程 readback 与 `docs/evidence/implementation-log.md` Batch 6。

### D. 全球宏观规范化

- [x] **V3-D001** 实现统一事件类型：`MONETARY_MACRO/TRADE_SANCTIONS/GEOPOLITICS/FINANCIAL_STABILITY/ENERGY_SUPPLY/CRYPTO_POLICY/OTHER/UNKNOWN`。
- [x] **V3-D002** 把国家、地区、机构和人物建模为事件实体数组；禁止用国家选择 adapter 或硬编码加拿大路径。
- [x] **V3-D003** 输出 `direction/severity/scheduled_state`；无法判断时保持 `UNKNOWN`，不为了凑条件强行负面化。
- [x] **V3-D004** 以规则优先完成关键词、实体和归因规范化；LLM 不进入 live 热路径。
- [x] **V3-D005** 同一 TechFlow 快讯的列表项、详情页和 revision 归并为一个事件及追加 revision。
- [x] **V3-D020** 建立跨地区 fixtures，至少覆盖美洲、欧洲、亚洲、中东及全球事件，并包含有新闻无价格反应的负样本。
- [x] **V3-D021** 验证加拿大关税 fixture 只是一条 `TRADE_SANCTIONS` 实例，删除所有加拿大专用条件。

完成证据：`tests/fixtures/news-v3/global-macro-cases.json`、`tests/unit/v3-news-normalization.test.ts` 与 `packages/news-adapters/src/techflow.ts` 的确定性分类器。

### E. 最小 Sell/Rebuy 模型

- [x] **V3-E001** 卖出进度固定四项：宏观冲击、跨资产下跌、VIRTUAL 相对弱势、VIRTUAL 主动卖压。
- [x] **V3-E002** 正常卖出路径必须四项全通过；TechFlow 单独、Binance 单独的普通波动均不得确认。
- [x] **V3-E003** 建立 `EXTREME_MARKET_BREAKDOWN` 备用路径；仅使用 Binance，并在历史校准前返回 `UNKNOWN/NOT_CALIBRATED`。
- [x] **V3-E004** 买回进度固定四项：无新宏观升级、跨资产无新低、VIRTUAL 相对恢复、主动卖压归一。
- [x] **V3-E005** 没有用户标记的卖出事实或明确 Shadow 参考卖出时，只展示恢复程度，不建议增加仓位。
- [x] **V3-E006** 新宏观升级、再创新低或卖压重新恶化时，买回进度重置并保存原因。
- [x] **V3-E007** 所有状态只允许 `NO_ACTION/NEWS_ARMED/MARKET_ARMED/SELL_READY/REBUY_WAIT/REBUY_READY/DATA_UNAVAILABLE/UNKNOWN` 等只读语义，不输出链级 actionable。
- [x] **V3-E020** 覆盖新闻单独、普通市场单独、正常双确认、极端市场、V 型反转、再恶化、单源断线和重启 warm-up 测试。
- [x] **V3-E021** 2026-08-22 fixture 按 v0.3 模型重新回放；保留旧结论但生成新模型版本，不覆盖 v0.2 快照。

完成证据：`packages/decision-core/src/v3-engine.ts`、`config/state-machines.json`、`tests/unit/v3-decision-engine.test.ts`、`tests/replay/event-2026-08-22-v3.test.ts` 和 `tests/fixtures/2026-08-22/v3-analysis.json`。

### F. 最小驾驶舱

- [x] **V3-F001** 首页只保留自然中文的当前结论、两源健康摘要、VIRTUAL/大盘参考价、宏观消息、Sell/Rebuy 进度和下一缺口。
- [x] **V3-F002** 删除或隐藏链、RPC、DEX quote、钱包、衍生品、多新闻层级、传播热度和第二交易所卡片。
- [x] **V3-F003** 每个条件只用中文展示“已满足/未满足/等待数据/数据过期”、完成进度、现在怎样和还差什么；原生状态、阈值、来源、年龄和证据 ID 留在后台。
- [x] **V3-F004** 固定用自然语言展示只读边界：“页面不会连接钱包或自动交易；实际买卖前，请在 DEX 钱包确认即时成交价格。”
- [x] **V3-F005** 条件完成度不得表示概率、盈利率或 DEX 可成交性。
- [x] **V3-F006** 从默认前端移除 `SHADOW/CEX_REFERENCE/STAGE/OUTPUT/PASS/FAIL/UNKNOWN/STALE`、transport、capability 和 evidence tape 等工程字段，并增加防回归断言。
- [x] **V3-F020** 完成桌面/390×844 移动端组件测试、可访问语义和关键页面 E2E；控制台保持 0 error / 0 warning。

完成证据：`apps/web/src/App.tsx`、`apps/web/src/styles.css`、`tests/unit/dashboard.test.tsx`、Playwright 桌面/390×844 截图；键盘 `Tab + Enter` 通过，最终控制台 0 error / 0 warning。

### G. 历史验证与 Shadow

- [ ] **V3-G001** 建立至少 30 个跨国家、跨类型事件，包含宏观冲击、地缘冲突、监管、无新闻暴跌、有新闻无下跌和 V 型反转。
- [ ] **V3-G002** 每个事件只使用当时已收到的 TechFlow 数据和 Binance 数据，禁止事后补入其他新闻源作为实时输入。
- [ ] **V3-G003** 计算 TechFlow 相对 Binance 市场启动的提前/滞后、覆盖率、漏报率和误警戒率。
- [ ] **V3-G004** 比较正常双确认、极端市场备用路径与 `NO_ACTION`，预先冻结阈值和留出集。
- [x] **V3-G005** 所有收益只报告 `CEX_REFERENCE`；没有用户真实成交记录时不得报告 DEX 可实现收益。
- [ ] **V3-G006** 运行至少 14 天 Shadow；不足够风险窗口则延长，不自动通过。`IN_PROGRESS`；只累计相邻不超过 30 秒的 journal 样本，见 `output/reports/v3-shadow-status.json`。
- [ ] **V3-G007** 生成 `SUPPORTED/REFUTED/INCONCLUSIVE` 结论；未证明前保持 `POSITIVE_EV_NOT_PROVEN`。

### H. 旧能力退出与发布门禁

- [x] **V3-H001** 从 runtime composition root、环境 schema 和默认配置中移除 RPC、链、DEX quote、钱包、衍生品、第二交易所和其他新闻 adapter。
- [x] **V3-H002** 暂时保留 v0.2 代码与证据文件，但保证它们不可从 v0.3 启动路径到达；不得把“保留代码”误报为启用能力。
- [x] **V3-H003** 更新 capability manifest、source registry、API 和 UI readback，使当前运行只声明 TechFlow 与 Binance。
- [x] **V3-H004** 更新单元、集成、回放和 E2E 测试；删除已失效断言，不降低关键路径断言质量。
- [x] **V3-H005** `lint/format/typecheck/unit/integration/e2e/build/secret-scan` 全部通过并留下命令与结果。
- [x] **V3-H006** 更新 README、运行手册、已知限制和变更记录，明确 TechFlow 无 SLA、页面入口可能变化。
- [x] **V3-H007** 本地运行 readback 证明仅两条外部输入处于 active；GitHub Actions/CD 未运行时继续准确报告 `NOT_RUN/NOT_CONFIGURED`。
- [x] **V3-H008** v0.3 连续 Shadow 稳定后，再单独评审是否删除 v0.2 RPC/DEX 代码；未评审前不做不可逆删除。`CONTROL_ACTIVE`：尚未达到稳定门槛，本轮未删除 v0.2 代码。

完成证据：`apps/server/src/index.ts`、`apps/server/src/v3-runtime.ts`、`apps/server/src/app.ts`、`config/default.json`、`config/source-registry.json`、`docs/evidence/implementation-log.md` Batch 6；`pnpm run ci` 本地通过，远程仍为 `NOT_RUN/NOT_CONFIGURED`。

### v0.3 阶段门槛

- [x] **V3-GATE-A** 产品范围和两条输入链已由用户确认并写入文档。
- [ ] **V3-GATE-B** TechFlow adapter、测试和 60 分钟 soak 完成。
- [ ] **V3-GATE-C** Binance 四资产流、测试和 60 分钟 soak 完成。
- [x] **V3-GATE-D** 全球事件规范化与跨地区 fixtures 完成。
- [x] **V3-GATE-E** Sell/Rebuy 状态机与回放测试完成。
- [x] **V3-GATE-F** 最小驾驶舱和 E2E 完成。
- [ ] **V3-GATE-G** 30 事件与 14 天 Shadow 完成并形成证据结论。
- [x] **V3-GATE-H** 旧能力不可达、全部本地门禁通过、runtime readback 与文档一致。

---

## v0.2 历史清单（不再计入活跃进度）

### 0.2 当前已完成的规划工作

- [x] **BASELINE-001** 创建完整需求与设计基线 `docs/plan.md`。
- [x] **BASELINE-002** 明确第一版为只读系统，不读取私钥、不签名、不广播。
- [x] **BASELINE-003** 明确排除 `Virtuals Whale Radar`，不读取、不依赖、不迁移该项目。
- [x] **BASELINE-004** 将卖出判断与买回判断拆成两个独立模型。
- [x] **BASELINE-005** 按 `plan.md` 推荐默认记录：新闻辅助 + market-only 强阈值双路径。
- [x] **BASELINE-006** 按 `plan.md` 推荐默认记录：阶段 + 必要条件计数 + 组件进度，不显示伪概率。
- [x] **BASELINE-007** 按 `plan.md` 推荐默认记录：BTC/ETH/SOL/VIRTUAL，固定下限 + 波动率归一化。
- [x] **BASELINE-008** 按 `plan.md` 推荐默认记录：至少 30 个事件 + 至少 14 天实时 Shadow。
- [x] **BASELINE-009** 按 `plan.md` 推荐默认记录：TypeScript 实时核心、React UI、Python/DuckDB 离线研究。
- [x] **BASELINE-010** 创建本可执行任务清单 `docs/todo.md`。

### 0.3 总体阶段依赖

```text
Phase 0 需求冻结与工程契约
  → Phase 1 工程骨架、共享类型与存储
  → Phase 2 市场/衍生品数据采集
  → Phase 3 确定性回放与 2026-08-22 fixture
  → Phase 4 新闻采集、聚类与风险上下文
  → Phase 5 实时特征与数据健康
  → Phase 6 卖出/买回决策核心与经济门槛
  → Phase 7 Base/Robinhood DEX 只读适配
  → Phase 8 API、驾驶舱与通知
  → Phase 9 历史样本验证
  → Phase 10 实时 Shadow
  → Phase 11 LIVE_READ_ONLY 发布评审
  → Phase 12 可选交易准备/执行（当前禁止）
```

可并行关系：

- Phase 4 新闻能力可在 Phase 2 市场采集稳定后与 Phase 3 后半段并行；
- Phase 7 的 Base 资产验证可在 Phase 6 后半段开始，但不得让链协议字段进入决策核心；
- Phase 8 可先使用 fixtures 开发 UI，但实时行动状态必须等 Phase 6/7 的真实接口；
- Robinhood Chain 输入缺失不阻塞 Base、回放、模型和 UI 的 `UNKNOWN` 路径。

### 0.4 阶段级进度总览

只有对应阶段全部必需退出门槛通过后，才勾选阶段总项。

- [x] **PHASE-00** 需求冻结、边界与工程契约完成。
- [ ] **PHASE-01** 工程骨架、共享类型、存储与质量门禁完成。
- [ ] **PHASE-02** 市场与衍生品数据采集完成。
- [x] **PHASE-03** 确定性回放与 2026-08-22 fixture 完成。
- [ ] **PHASE-04** 新闻采集、聚类与风险上下文完成。
- [ ] **PHASE-05** 实时特征与数据健康完成。
- [ ] **PHASE-06** 卖出/买回模型与经济门槛框架完成。
- [ ] **PHASE-07** DEX 只读适配完成到已具备输入的链能力边界。
- [ ] **PHASE-08** 只读 API、驾驶舱与通知完成。
- [ ] **PHASE-09** 至少 30 个历史事件验证完成。
- [ ] **PHASE-10** 至少 14 天且覆盖足够风险窗口的 Shadow 完成。
- [ ] **PHASE-11** `LIVE_READ_ONLY` 发布评审与交付完成，或正式决定继续 Shadow/停止。
- [ ] **PHASE-12 [GATED: AUTHORIZATION]** 可选交易准备/执行另行获批并完成。

### 0.5 与 `plan.md` 路线图的对应关系

| `plan.md` 阶段 | 本清单阶段 | 说明 |
|---|---|---|
| Plan Phase 0 | Todo Phase 0–1 | 把需求、契约和工程基础拆开验收 |
| Plan Phase 1 | Todo Phase 2–3、5 | 数据记录、回放、特征和健康 |
| Plan Phase 2 | Todo Phase 4 | 新闻源、聚类和传播时间线 |
| Plan Phase 3 | Todo Phase 6 | Sell/Rebuy 决策核心 |
| Plan Phase 4 | Todo Phase 7 | Base/Robinhood DEX 只读适配 |
| Plan Phase 5 | Todo Phase 8 | 驾驶舱、API、回放 UI 和通知 |
| Plan Phase 6 | Todo Phase 9 | 历史事件、留出评估和经济性 |
| Plan Phase 7 | Todo Phase 10–11 | 实时 Shadow 与只读发布 |
| Plan Phase 8 | Todo Phase 12 | 当前未授权的交易准备/执行 |

---

## Phase 0：需求冻结、边界与工程契约

目标：把 `plan.md` 的产品方向转换为不会在编码过程中漂移的决策记录、字段字典、状态机契约和能力边界。

### P0.1 冻结重大默认决策

- [x] **P0-001** 创建 `docs/decisions/` 目录与决策记录模板，字段至少包括：背景、方案、选择、理由、风险、可逆性、生效版本、确认人、确认时间。
- [x] **P0-002** 记录 ADR：第一版只提供 `REPLAY / SHADOW / LIVE_READ_ONLY`。
- [x] **P0-003** 记录 ADR：`PREPARE_ONLY / AUTO_EXECUTE` 为 `GATED: AUTHORIZATION`，任何代码、路由或依赖不得隐式开启。
- [x] **P0-004** 记录 ADR：新闻辅助、market-only 强阈值可独立警戒，新闻不能单独触发卖出。
- [x] **P0-005** 记录 ADR：卖出与买回使用两个状态机，不创建一个混合总分。
- [x] **P0-006** 记录 ADR：进度表示条件完成度，不表示价格方向概率、盈利概率或仓位概率。
- [x] **P0-007** 记录 ADR：关键数据、资产身份、DEX 报价、永久损伤和经济证据使用 hard gate，不进入加权平均。
- [x] **P0-008** 记录 ADR：本地优先；在连续 Shadow 前重新评审本地、云端或混合部署。
- [x] **P0-009** 记录 ADR：公开新闻源优先，只有量化证明增量价值后才接入付费源。
- [x] **P0-010** 记录 ADR：原始成交与报价默认保留 180 天，聚合特征、决策快照和模型版本长期保留。
- [x] **P0-011** 记录 ADR：技术栈采用 TypeScript/Node.js + React + SQLite/Parquet + Python/DuckDB，并声明跨语言公式一致性要求。
- [x] **P0-012** 记录当前战术仓位为 `UNSET`，研究阶段仅跑 10%/20%/40% 三组情景。

### P0.2 定义产品权限和禁止能力

- [x] **P0-020** 创建第一版 capability baseline，逐项声明 `transport/discovery/identity/quote/simulation/calldata/sign/broadcast/reconcile/exit/replay`。
- [x] **P0-021** 将 `sign`、`broadcast`、`approve-token`、`execute-trade` 明确标为 `UNSUPPORTED`。
- [x] **P0-022** 定义检查规则，保证第一版 API 路由表中不存在 `/sign`、`/broadcast`、`/approve-token`、`/execute-trade`。
- [x] **P0-023** 定义依赖审计规则，禁止引入会在启动时读取浏览器钱包、keystore 或私钥的默认行为。
- [x] **P0-024** 定义代码与文档扫描规则，保证仓库不引用 `Virtuals Whale Radar` 的目录、包、接口或数据。
- [x] **P0-025** 定义 LLM 边界：只允许异步新闻结构化/解释，不允许进入实时决策函数、DEX 报价、钱包或执行路径。
- [x] **P0-026** 定义秘密边界：凭证保存在仓库外部；`.gitignore` 不是唯一秘密保护措施。

### P0.3 完成字段字典

- [x] **P0-030** 为 `NewsObservation` 建立字段字典，逐字段填写 definition/source/unit/decision_use/missing_rule。
- [x] **P0-031** 为 `NewsEventCluster` 建立字段字典，并分离 `fact_confidence`、`market_severity`、`attention_state`。
- [x] **P0-032** 为 `MarketObservation` 建立字段字典，明确 event time、receive time、sequence 与 taker side。
- [x] **P0-033** 为 `DerivativeObservation` 建立字段字典，区分 OI contracts、OI USD、持仓比、主动买卖比、强平和资金费率。
- [x] **P0-034** 为 `FeatureSnapshot` 建立字段字典，逐项声明窗口、基线、覆盖率、freshness 和 evidence。
- [x] **P0-035** 为 `ChainProfile`、`WalletProfile` 和 `ChainQuote` 建立字段字典。
- [x] **P0-036** 为 `ConditionEvaluation` 和 `DecisionSnapshot` 建立字段字典。
- [x] **P0-037** 为 `Knowledge<T>` 定义 `KNOWN/UNKNOWN/UNSUPPORTED/ERROR` 的互斥语义。
- [x] **P0-038** 为所有金额和数量定义 `DecimalString` 规范，禁止使用 JS/Python float 做资金换算。
- [x] **P0-039** 删除或修订不满足“必要、无歧义、可获取、可复核”四项测试的字段。

### P0.4 冻结时间、版本和证据语义

- [x] **P0-040** 定义内部 UTC 与 UI Asia/Shanghai 的转换契约。
- [x] **P0-041** 定义 `source_occurred_at/received_at/normalized_at/decided_at/observed_at/expires_at` 的精确含义。
- [x] **P0-042** 定义稳定 ID 和哈希生成规范，确保同一输入可重复生成相同 `decision_id` 与去重键。
- [x] **P0-043** 定义模型、配置、adapter 和 schema 的版本字段。
- [x] **P0-044** 定义事件 revision 规则：新证据追加 revision，不覆盖旧事实。
- [x] **P0-045** 定义 append-only evidence event 的公共 envelope：event ID、parent ID、source、版本、event time、observed time、payload hash。
- [x] **P0-046** 定义证据等级：`PLANNED/REPOSITORY_RECORD/TESTED/HISTORICAL_REFERENCE/HISTORICAL_RECEIPT/VERIFIED_CURRENT/UNKNOWN`。
- [x] **P0-047** 定义“代码存在、配置启用、测试通过、历史证据、当前运行”不得互相推导的规则。

### P0.5 冻结状态机和条件契约

- [x] **P0-050** 将 Sell Model 所有状态、合法转换、进入条件、退出条件、降级条件和 freshness 写成机器可读表。
- [x] **P0-051** 将 Rebuy Model 所有状态、合法转换、进入条件、退出条件、重置条件和 veto 写成机器可读表。
- [x] **P0-052** 固定卖出完成度分母为四项：风险上下文、跨资产冲击、VIRTUAL 主动卖盘、当前链 DEX 可执行性。
- [x] **P0-053** 固定买回完成度分母为五项：无新低、OI 冲洗、订单流恢复、主流资产稳定、当前链 DEX 可执行性。
- [x] **P0-054** 定义 hard gates 列表，并明确不计入条件完成率。
- [x] **P0-055** 定义每条链互斥行动状态：`SIGNAL_NOT_READY/QUOTE_PENDING/ACTIONABLE_WITH_EVIDENCE/SHADOW_CANDIDATE/BLOCKED_DATA/BLOCKED_IDENTITY/BLOCKED_COST/BLOCKED_LIQUIDITY/UNSUPPORTED/UNKNOWN`。
- [x] **P0-056** 定义 `NO_ACTION` 为正式输出，不作为异常或空值。
- [x] **P0-057** 定义验证期最大输出为 `SHADOW_CANDIDATE`，经济门槛未证明时禁止 `ACTIONABLE_WITH_EVIDENCE`。

### P0.6 形成测试矩阵和 fixture 规范

- [x] **P0-060** 把 `plan.md` 第 21.2 节所有必测模型场景转换为测试用例清单和稳定 ID。
- [x] **P0-061** 为每个阈值生成“刚低于/等于/刚高于”三个边界用例。
- [x] **P0-062** 为每个关键字段生成 `KNOWN(0)/UNKNOWN/UNSUPPORTED/ERROR/STALE` 用例。
- [x] **P0-063** 定义时间模型用例：稳定、快速恶化、快速改善、V 型反转、再创新低。
- [x] **P0-064** 定义跨链隔离用例：Base 可执行/Robinhood 不可执行及其反向情形。
- [x] **P0-065** 定义 2026-08-22 fixture 文件结构、原始证据清单、预期状态时间线和 DEX `UNKNOWN` 断言。
- [x] **P0-066** 定义回放禁止未来函数的测试策略和审计方法。
- [x] **P0-067** 定义测试失败分类：field/definition/function/mapping/gate/data/implementation。

### Phase 0 退出门槛

- [x] **P0-GATE-01** 十项重大决策均已记录为用户选择或推荐默认。
- [x] **P0-GATE-02** 字段字典覆盖所有进入决策、报价、进度和证据账本的字段。
- [x] **P0-GATE-03** 卖出/买回状态表不存在未定义转换。
- [x] **P0-GATE-04** 权限基线明确证明第一版没有签名和广播能力。
- [x] **P0-GATE-05** 2026-08-22 fixture 规范能够由未参与设计的人复现。

---

## Phase 1：工程骨架、共享类型、存储与质量门禁

目标：建立可测试、可版本化、不会在实时/回放/Python 之间漂移的工程基础。

### 1.1 初始化仓库与工作区

- [x] **P1-001** 确认或初始化 Git 仓库，保留现有 `docs/plan.md` 与 `docs/todo.md`。
- [x] **P1-002** 创建 TypeScript workspace，记录 Node.js 与包管理器版本。
- [x] **P1-003** 建立目录：`apps/server`、`apps/web`、`packages/domain`、`packages/config`、`packages/storage`、`packages/market-adapters`、`packages/news-adapters`、`packages/chain-adapters`、`packages/feature-engine`、`packages/decision-core`、`packages/replay`、`python/analysis`、`tests/fixtures`。
- [x] **P1-004** 配置统一 TypeScript strict mode、格式化、lint、测试和构建脚本。
- [x] **P1-005** 配置 Python 锁定环境、格式化、类型检查和测试命令。
- [x] **P1-006** 创建根级开发命令，分别支持 lint/typecheck/unit/integration/replay/build。
- [x] **P1-007** 创建最小 CI，本地与 CI 使用相同命令；没有远程仓库时先保证本地 CI 脚本可运行。
- [x] **P1-008** 创建项目 README，明确启动方式、当前能力等级、安全边界和 `POSITIVE_EV_NOT_PROVEN`。

### 1.2 共享领域类型

- [x] **P1-020** 实现 `Knowledge<T>` 判别联合类型及 schema 校验。
- [x] **P1-021** 实现 `DecimalString` 解析、规范化、比较和算术包装。
- [ ] **P1-022** 实现 UTC timestamp、duration、hash、network scope、account key、target key 类型。
- [x] **P1-023** 实现 `EvidenceRef` 与证据等级类型。
- [x] **P1-024** 实现 `NewsObservation/NewsEventCluster/MarketObservation/DerivativeObservation` schema。
- [x] **P1-025** 实现 `FeatureSnapshot/ChainQuote/ConditionEvaluation/DecisionSnapshot` schema。
- [x] **P1-026** 实现 `ChainProfile/WalletProfile/CapabilityManifest` schema。
- [ ] **P1-027** 为所有 enum 建立 exhaustive switch 检查，新增状态时编译失败直到所有分支处理。
- [x] **P1-028** 为 TypeScript schema 生成稳定 JSON Schema，供 fixture、API 和 Python 使用。
- [x] **P1-029** 在 Python 侧加载同一 JSON Schema，不手写含义不同的重复模型。

### 1.3 配置系统

- [ ] **P1-040** 实现分层配置：global/news/market/chain/wallet/sell/rebuy/execution-limit/notification。
- [x] **P1-041** 为配置加入 schema 版本、策略版本、生效时间和配置哈希。
- [x] **P1-042** 实现启动时完整校验，未知字段或非法单位 fail-fast。
- [ ] **P1-043** 实现安全的仓库外凭证引用，错误信息不得输出秘密值。
- [x] **P1-044** 创建无秘密的示例配置，仅包含占位符和说明。
- [x] **P1-045** 实现配置运行时 readback API 模型，能够证明进程实际加载的版本。
- [ ] **P1-046** 实现配置变更事件，禁止无审计热改当前事件的模型版本。
- [x] **P1-047** 保持 `tactical_sleeve_pct=UNSET` 时只允许比例情景，不输出绝对数量。

### 1.4 Append-only 存储

- [x] **P1-060** 设计 SQLite migration：配置版本、adapter 状态、证据索引、决策快照、状态转换、用户确认、Shadow 头寸。
- [x] **P1-061** 创建 append-only ledger 表，禁止普通更新覆盖历史事件。
- [x] **P1-062** 为 correction/revision 创建显式追加事件，而不是修改旧记录。
- [x] **P1-063** 设计原始高频数据的 Parquet schema 和目录分区规则。
- [ ] **P1-064** 实现原始文件写入的临时文件、校验、原子提交和崩溃恢复。
- [x] **P1-065** 保存 source、日期、小时、schema version、ingestion run ID 和校验和。
- [ ] **P1-066** 创建 DuckDB 只读视图，能够联合查询 Parquet 与导出的决策快照。
- [x] **P1-067** 实现 180 天原始数据保留策略的 dry-run 报告；默认不立即删除数据。
- [ ] **P1-068** 实现存储失败 hard gate：无法保存证据时停止产生新的可行动建议。

### 1.5 本地事件流与时钟

- [x] **P1-080** 实现进程内类型化事件总线，不引入 Kafka 等远程基础设施。
- [x] **P1-081** 为每个事件分配 ingestion sequence，解决相同时间戳的稳定排序。
- [ ] **P1-082** 实现系统时钟监测和 drift 状态。
- [x] **P1-083** 将 wall clock 与 monotonic clock 用途分开。
- [x] **P1-084** 实现 `source_occurred → received → normalized → decided` 延迟埋点。
- [x] **P1-085** 实现进程重启后恢复最后持久化 offset/sequence 的基础接口。

### 1.6 质量与安全门禁

- [x] **P1-100** 添加秘密扫描，覆盖源码、配置、fixtures、日志样本和构建产物。
- [x] **P1-101** 添加依赖漏洞与许可证检查。
- [x] **P1-102** 添加禁止路径/符号扫描，确保没有 sign/broadcast/approve/execute API 实现。
- [x] **P1-103** 添加 `Virtuals Whale Radar` 依赖与路径扫描。
- [x] **P1-104** 添加 DecimalString 禁止转 float 的静态检查或代码审查规则。
- [ ] **P1-105** 添加 schema 兼容性测试，阻止破坏性变更静默上线。
- [x] **P1-106** 添加跨语言 fixture 校验，保证 TypeScript 与 Python 读取同一字段含义。

### Phase 1 退出门槛

- [ ] **P1-GATE-01** 全部 lint/typecheck/unit/build 命令在干净环境通过。
- [x] **P1-GATE-02** `Knowledge<T>`、DecimalString 和关键 schema 的正常/缺失/错误测试通过。
- [x] **P1-GATE-03** Append-only ledger 能证明旧记录不会被覆盖。
- [x] **P1-GATE-04** 配置 readback 能返回进程实际加载版本和哈希。
- [x] **P1-GATE-05** 秘密、禁用能力和 Whale Radar 扫描通过。

---

## Phase 2：市场与衍生品数据采集

目标：连续、可补洞、可回放地记录 BTC/ETH/SOL/VIRTUAL 的参考市场与 VIRTUAL 衍生品数据。

### 2.1 数据源接入前验证

- [x] **P2-001** 复核 Binance 当前官方 Spot/Futures API 与 WebSocket 文档，记录 endpoint、字段、限流、序号、重连和历史保留限制。
- [x] **P2-002** 记录 `aggTrade` maker 标记到 taker side 的精确映射，并创建官方文档证据引用。
- [ ] **P2-003** 评估第二参考市场源，记录可用性、交易对、延迟和成本；第一版可保持 `PLANNED`。
- [x] **P2-004** 为每个数据源创建 capability manifest 和 failure semantics。
- [x] **P2-005** 定义每个流的去重键、排序规则、断线恢复 offset 和 gap 语义。

### 2.2 Spot/参考市场流

- [ ] **P2-020** 实现通用 `MarketSourceAdapter` 接口，输出规范化观察而非供应商对象。
- [ ] **P2-021** 接入 BTCUSDT 聚合成交流。
- [ ] **P2-022** 接入 ETHUSDT 聚合成交流。
- [ ] **P2-023** 接入 SOLUSDT 聚合成交流。
- [ ] **P2-024** 接入 VIRTUALUSDT 聚合成交流。
- [ ] **P2-025** 接入四个交易对的最优买卖价；若接入深度，单独声明能力和覆盖档位。
- [ ] **P2-026** 保存原始 payload hash、source event time、received time、sequence 和 ingestion sequence。
- [x] **P2-027** 将价格、数量与名义金额转换为 DecimalString。
- [x] **P2-028** 对 VIRTUAL 成交按 `price × quantity` 计算 quote notional。
- [ ] **P2-029** 实现流级去重，重连后重复消息不会重复计入窗口。

### 2.3 断线、补洞与数据质量

- [ ] **P2-040** 实现 WebSocket 心跳、超时检测和指数退避重连。
- [ ] **P2-041** 检测 sequence/time gap 并写 `source_gap_detected`。
- [ ] **P2-042** 在数据源支持时，使用 REST 历史接口补齐明确范围。
- [ ] **P2-043** 补洞数据保留原始 event time，并使用实际补收时间作为 received/ingested evidence。
- [ ] **P2-044** 无法补齐的范围显式保存 coverage gap，不做插值冒充成交。
- [ ] **P2-045** 计算每个交易对的消息率、重复率、乱序率、gap 时长和数据年龄。
- [ ] **P2-046** 数据年龄超过 3 秒时标记 `STALE`，但保留最后已知值与时间。
- [ ] **P2-047** 单一资产数据过期时，只隔离依赖该资产的条件，不伪造全局正常。

### 2.4 衍生品数据

- [ ] **P2-060** 实现通用 `DerivativeSourceAdapter`。
- [ ] **P2-061** 采集 VIRTUAL OI contracts，并保留原始单位。
- [ ] **P2-062** 采集/计算 VIRTUAL OI USD，明确其受价格变化影响，仅作辅助。
- [ ] **P2-063** 采集 VIRTUAL taker long/short ratio，并与成交级订单流字段区分命名。
- [ ] **P2-064** 采集 VIRTUAL top trader position ratio，标记为辅助/soft 数据。
- [ ] **P2-065** 在可靠接口可得时接入强平流，并记录方向、名义金额和数据覆盖。
- [ ] **P2-066** 接入资金费率与基差，明确不进入秒级卖出 hard gate。
- [ ] **P2-067** 实现 OI 6 分钟 freshness；过期后输出 `STALE/UNKNOWN`。
- [ ] **P2-068** 保证卖出模型数据管线不等待下一根 OI 快照。

### 2.5 数据采集测试

- [ ] **P2-080** 为正常消息、重复消息、乱序消息、字段缺失、非法 decimal 建立 fixtures。
- [ ] **P2-081** 测试重连前后不会双计成交。
- [ ] **P2-082** 测试补洞失败会保留明确 gap。
- [x] **P2-083** 测试 `KNOWN(0)` 与 `UNKNOWN` 不混淆。
- [x] **P2-084** 测试 taker side 映射与人工构造样本一致。
- [x] **P2-085** 测试跨午夜、UTC/北京时间转换和夏令时不影响内部 UTC。
- [ ] **P2-086** 运行至少 60 分钟本地采集 soak test，保存完整率和延迟报告。

### Phase 2 退出门槛

- [ ] **P2-GATE-01** 四个交易对都能连续记录并在断线后恢复。
- [ ] **P2-GATE-02** VIRTUAL 订单流与 OI 数据具有明确单位、freshness 和 coverage。
- [ ] **P2-GATE-03** 未补齐 gap 可被查询、展示并阻止依赖条件。
- [ ] **P2-GATE-04** 60 分钟 soak test 无重复计数和静默数据缺口。
- [x] **P2-GATE-05** 所有数据仍仅为参考市场读操作，不存在 CEX 下单或余额能力。

---

## Phase 3：确定性回放与 2026-08-22 基准 fixture

目标：在任何实时模型上线前，先证明相同历史输入能得到相同输出，且绝不读取未来数据。

### 3.1 虚拟时钟与事件排序

- [x] **P3-001** 实现 `ReplayClock`，支持 start/pause/resume/seek/step/speed。
- [x] **P3-002** 明确回放主排序使用 `received_at`，相同时使用 source sequence 与 ingestion sequence 稳定排序。
- [x] **P3-003** 区分 source event time 与系统可用时间，新闻和市场数据只在 `received_at` 后可见。
- [x] **P3-004** 实现回放窗口边界，任何查询只能访问虚拟时钟当前值之前的数据。
- [x] **P3-005** 实现运行中最低价与 OI 基线的在线算法，禁止读取全局未来最低/最高值。
- [x] **P3-006** 实现 replay run ID、输入数据 hash、配置 hash 和模型版本记录。
- [x] **P3-007** 实现逐事件与批量推进两条执行路径，用于一致性对照。

### 3.2 2026-08-22 数据 fixture

- [x] **P3-020** 下载并保存本次事件所需 BTC/ETH/SOL/VIRTUAL 历史市场数据，记录来源、请求参数、下载时间和 checksum。
- [x] **P3-021** 保存本次 VIRTUAL OI、taker ratio 和 top position ratio 历史数据及 checksum。
- [x] **P3-022** 构造新闻原始观察：AP、金十、Carney、WatcherGuru、TechFlow、Axios、Unusual Whales、伊朗军事言论。
- [x] **P3-023** 为每条新闻记录原始发布时间、系统假定 received time、来源 tier 与 URL evidence。
- [x] **P3-024** 明确本 fixture 没有 Base/Robinhood 历史 DEX 报价，生成 `ChainQuote=UNKNOWN(reason=not_recorded)`。
- [x] **P3-025** 建立并验证更正后时间线：11:43:45 警戒、12:02:19 去重、13:05:06.999 预触发、13:07:16.999 确认、13:11:13.949 低点、13:12:25.999 广泛稳定、13:16:09.999 订单流恢复、13:16:13.949 无新低；旧买回两档假设被证伪。
- [x] **P3-026** 保存 Binance 参考市场样本与反事实口径；旧买回时间被证伪后显式记为“完整循环 NOT_COMPUTED”，不写“真实成交收益”。
- [x] **P3-027** 对所有 fixture 数据做 schema、时区、decimal 和 checksum 校验。

### 3.3 回放断言

- [x] **P3-040** 断言 11:43 只进入 `NEWS_ARMED`，不进入卖出确认。
- [x] **P3-041** 断言 TechFlow 转述与前序消息聚为同一事件，不重复提高事实置信。
- [x] **P3-042** 断言 13:05:01 尚不得预触发，13:05:06.999 才首次进入 `SELL_PRETRIGGER`。
- [x] **P3-043** 断言 13:07:13 尚不得确认，13:07:16.999 跨资产与 VIRTUAL 连续卖压首次同时满足后进入 `SELL_CONFIRMED`。
- [x] **P3-044** 断言 13:11:13.949 不产生追卖或抄底动作。
- [x] **P3-045** 断言 OI 基线只使用 risk-arm 前已知快照。
- [x] **P3-046** 断言 running low 每次创新低时重置无新低计时。
- [x] **P3-047** 断言本次全程都不得进入第一档买回：无 DEX-backed sell fact，有效 OI baseline 的最大降幅未达 5%，且两链历史 quote 均缺失。
- [x] **P3-048** 断言历史 DEX 报价缺失时，Base/Robinhood 始终为 `UNKNOWN`。
- [x] **P3-049** 断言经济状态始终为 `POSITIVE_EV_NOT_PROVEN`，最大输出为 `SHADOW_CANDIDATE`。

### 3.4 回放可靠性测试

- [x] **P3-060** 同一输入连续运行至少三次，逐字节比较决策快照输出。
- [ ] **P3-061** 对比逐事件推进与批量推进，状态转换完全一致。
- [ ] **P3-062** 在随机暂停/恢复/seek 后重新运行，最终结果不漂移。
- [ ] **P3-063** 注入乱序和重复事件，验证规范化后的确定性。
- [ ] **P3-064** 删除关键数据段，验证状态变为 `UNKNOWN/STALE` 而非 0。
- [x] **P3-065** 注入未来低点读取探针，测试应失败并指出越界查询。
- [x] **P3-066** 生成 replay manifest 与人类可读报告。

### Phase 3 退出门槛

- [x] **P3-GATE-01** 本次 fixture 的全部预期时间线断言通过。
- [x] **P3-GATE-02** 相同输入、相同配置、相同版本输出完全一致。
- [x] **P3-GATE-03** 没有任何未来数据读取。
- [x] **P3-GATE-04** 缺少 DEX 报价时没有虚构 Shadow 成交或收益。
- [x] **P3-GATE-05** 回放报告可追溯到原始数据 hash 和模型版本。

---

## Phase 4：新闻采集、事件聚类与风险上下文

目标：覆盖一般加密新闻分布，形成可追溯的事实聚类与传播时间线，但不让新闻直接触发交易动作。

### 4.1 新闻源登记与许可

- [x] **P4-001** 创建 news source registry，字段包含 tier、类型、访问方式、许可、费用、限流、时区、首发能力和 failure semantics。
- [ ] **P4-002** 选择首批 T0 官方源，并验证 RSS/API/网页入口的稳定性与使用边界。
- [ ] **P4-003** 选择首批 T1 综合/财经快讯源；不具备合法稳定接入方式的源保持 `UNSUPPORTED/PLANNED`。
- [ ] **P4-004** 选择首批 T2 加密专业媒体源。
- [ ] **P4-005** 选择首批 T3 官方 X/记者/高传播账号；记录是否需要登录、API 或付费权限。
- [x] **P4-006** 将 Telegram/Discord/匿名社区默认设为 T4 soft source，不进入事实确认 hard gate。
- [x] **P4-007** 记录每个源的付费升级条件：必须证明领先性增量大于成本。

### 4.2 Source adapters

- [ ] **P4-020** 实现通用 `NewsSourceAdapter`，声明去重键、排序、offset、重连、缓存和 schema 漂移语义。
- [ ] **P4-021** 实现至少一个 T0 官方源 adapter。
- [ ] **P4-022** 实现至少一个 T1 快讯/综合源 adapter。
- [ ] **P4-023** 实现至少一个 T2 加密媒体源 adapter。
- [x] **P4-024** 实现至少一个 T3 社交传播源 adapter；不可用时使用 fixture 并保持 live capability 为 `UNSUPPORTED`。
- [x] **P4-025** 保存 raw text hash、原始 URL、source item ID、source time 和 received time。
- [ ] **P4-026** 实现重连/轮询 offset，防止重复摄入与静默漏页。
- [ ] **P4-027** 对撤稿、修改和来源删除保存新 revision，不覆盖原观察。

### 4.3 规范化、分类与聚类

- [ ] **P4-040** 实现语言检测、文本规范化和原文 hash；不得因翻译覆盖原文证据。
- [ ] **P4-041** 实现实体抽取：国家、政府、监管、交易所、链、协议、VIRTUAL、稳定币等。
- [ ] **P4-042** 实现事件类型分类：macro/geopolitics/regulation/infrastructure/security/token/liquidity/rumor/other。
- [x] **P4-043** 实现 claim fingerprint，包含关键实体、规范化主张、时间窗和事件类型。
- [x] **P4-044** 实现同源重复、跨源转述和独立来源的区分。
- [x] **P4-045** 实现 event cluster，保存首发、首次接收、官方确认、独立来源数和传播节点。
- [x] **P4-046** 分别实现 `fact_confidence`、`market_severity`、`attention_state`，禁止合成单一新闻分数。
- [x] **P4-047** 允许重复传播提高 attention，但禁止自动提高 fact confidence。
- [ ] **P4-048** 对分类/实体/聚类 `UNKNOWN` 保留原因和原始 evidence。

### 4.4 LLM 异步辅助边界

- [ ] **P4-060** 将 LLM 新闻结构化放在异步 worker，不进入实时 condition evaluator。
- [ ] **P4-061** 要求 LLM 输出引用原始 observation IDs，不能生成无来源事实。
- [ ] **P4-062** LLM 超时、报错或不可用时，market-only 路径继续工作。
- [ ] **P4-063** LLM 只能提出永久损伤候选，不能直接写 `PERMANENT_IMPAIRMENT=FAIL`。
- [ ] **P4-064** 对 LLM 输出保存模型版本、prompt version、输入 hash 和置信边界。
- [ ] **P4-065** 创建规则/人工与 LLM 输出冲突的处理逻辑，默认保留 `UNKNOWN_REVIEW_REQUIRED`。

### 4.5 新闻权限和永久损伤候选

- [x] **P4-080** 实现 `NEWS_ARMED` 资格规则：事实置信、市场范围、freshness 与 120 分钟窗口。
- [x] **P4-081** 证明新闻事件单独不能产生 `SELL_PRETRIGGER/SELL_CONFIRMED`。
- [ ] **P4-082** 实现新闻窗口到期和撤销逻辑，保存降级原因。
- [ ] **P4-083** 建立 VIRTUAL 永久损伤候选规则库：合约权限、桥兑付、流动性、下架、法律、供应异常。
- [x] **P4-084** 区分 `PASS/FAIL/UNKNOWN/UNKNOWN_REVIEW_REQUIRED`。
- [ ] **P4-085** 要求 `FAIL` 必须绑定预定义规则、强来源或人工确认 evidence。

### 4.6 新闻测试与指标

- [x] **P4-100** 使用加拿大关税传播链验证 AP/金十/Carney/WatcherGuru/TechFlow/Axios/Unusual Whales 聚类。
- [x] **P4-101** 验证 TechFlow 二次转述不会变成第二个独立风险事件。
- [ ] **P4-102** 验证低可信传闻只能进入 soft/unknown 状态。
- [x] **P4-103** 验证官方确认与市场没有反应时只警戒、不卖出。
- [ ] **P4-104** 测试来源时间冲突、修改、撤稿、语言差异和 URL 变化。
- [ ] **P4-105** 计算 source-to-receive 延迟、首发覆盖、重复率、误报/撤稿率和相对市场领先时间。
- [ ] **P4-106** 生成新闻源成本/增量价值报告模板。

### Phase 4 退出门槛

- [x] **P4-GATE-01** 首批 T0–T3 能力均有真实 capability level，未接入的源不冒充可用。
- [x] **P4-GATE-02** 加拿大新闻多次转述正确聚成一个事件与传播链。
- [x] **P4-GATE-03** fact/severity/attention 三个状态完全分离。
- [x] **P4-GATE-04** 新闻不能单独越权触发卖出或买回。
- [ ] **P4-GATE-05** LLM 故障不影响实时市场路径。

---

## Phase 5：实时特征引擎与数据健康

目标：把原始市场/衍生品/新闻数据转换成可审计、可回放、带覆盖率和 freshness 的统一特征快照。

### 5.1 滚动窗口引擎

- [x] **P5-001** 实现按 event time 更新、按 received time 可见的滚动窗口容器。
- [ ] **P5-002** 支持 1 秒、5 秒、15 秒、30 秒、60 秒和 5 分钟窗口。
- [x] **P5-003** 定义窗口 warm-up：样本不足时输出 `UNKNOWN` 和覆盖率，不提前输出 0。
- [ ] **P5-004** 定义迟到数据策略：是否修正历史快照、生成 revision 或只进入冷路径统计。
- [ ] **P5-005** 为窗口状态实现序列化与重启恢复，避免重启后把空窗口当市场稳定。
- [ ] **P5-006** 为每个窗口记录 earliest/latest event time、sample count、expected coverage 和 gap count。

### 5.2 价格与跨资产特征

- [ ] **P5-020** 计算 BTC/ETH/SOL/VIRTUAL 各窗口收益。
- [ ] **P5-021** 计算各窗口运行中高点、低点、最大回撤和反弹幅度。
- [ ] **P5-022** 计算价格变化加速度，字段先标 `EXPERIMENTAL`。
- [x] **P5-023** 计算跨资产同步下跌 breadth，不包含 VIRTUAL 的 market-arm breadth 与包含 VIRTUAL 的 sell confirmation 条件分开。
- [x] **P5-024** 计算 broad market volume anomaly，并明确历史基线和 warm-up。
- [x] **P5-025** 实现 robust volatility scale，优先使用 MAD 等稳健方法。
- [x] **P5-026** 计算固定下限与波动率归一化阈值的最终 required drawdown。
- [x] **P5-027** 计算 VIRTUAL 相对弱势/超额回撤，保持 `SOFT/EXPERIMENTAL`，不进入第一版 hard gate。
- [x] **P5-028** 为每个特征保存公式版本、参数版本和输入 evidence IDs。

### 5.3 VIRTUAL 订单流特征

- [x] **P5-040** 计算各窗口 taker buy quote notional。
- [x] **P5-041** 计算各窗口 taker sell quote notional。
- [x] **P5-042** 计算 `taker_buy_sell_ratio`，定义 sell=0、buy=0、双方均 0 的行为。
- [x] **P5-043** 计算净主动流和成交量覆盖率。
- [x] **P5-044** 计算与历史时段基线比较的订单流 z-score；样本不足保持 `UNKNOWN`。
- [x] **P5-045** 实现条件持续计时器，只有连续满足才累积；数据中断、过期或反向时按契约重置。
- [ ] **P5-046** 测试 60 秒窗口滑动边界，避免旧成交多保留/少保留一秒。

### 5.4 OI 与去杠杆特征

- [x] **P5-060** 在 `risk_armed_at` 冻结当时最后一个新鲜 OI contracts 快照为 baseline。
- [x] **P5-061** 没有 risk-arm 前新鲜快照时输出 `oi_flush=UNKNOWN`。
- [ ] **P5-062** 计算 OI contracts 5/10/20 分钟变化。
- [ ] **P5-063** 单独计算 OI USD 变化，并明确不替代 contracts 变化。
- [x] **P5-064** 计算 OI flush progress，目标初始为 5%。
- [ ] **P5-065** 风险事件 revision 改变时，不静默改写已冻结 baseline。
- [x] **P5-066** 测试不能使用 risk-arm 后的未来 OI 高点作为 baseline。

### 5.5 新闻与永久损伤特征

- [ ] **P5-080** 将有效新闻 cluster 映射为 `NEWS_ARMED` 输入，保留 cluster ID、置信、范围和过期时间。
- [x] **P5-081** 将 market-only breadth 映射为 `MARKET_ARMED` 输入，不依赖新闻服务存活。
- [x] **P5-082** 输出永久损伤候选和审核状态，不在 feature engine 内越权确认 FAIL。
- [ ] **P5-083** 同一新闻 cluster 重复传播只更新 attention，不重复开始风险窗口。
- [ ] **P5-084** 新闻窗口过期时输出明确 transition evidence。

### 5.6 `FeatureSnapshot` 生成

- [ ] **P5-100** 每秒生成一个包含全部已知/未知字段的 `FeatureSnapshot`。
- [x] **P5-101** 快照包含 source coverage、freshness、gap、模型/公式版本和 evidence IDs。
- [x] **P5-102** 使用稳定 hash 生成 snapshot ID。
- [ ] **P5-103** 把快照写入 append-only store；写入失败触发数据 hard gate。
- [ ] **P5-104** 确保实时与 replay 调用同一个特征计算核心。
- [ ] **P5-105** 确保 Python 研究代码只消费同一快照/schema，或用跨语言 fixture 证明公式一致。

### 5.7 数据健康状态

- [ ] **P5-120** 实现每个 source/asset/feature 的 freshness evaluator。
- [x] **P5-121** 实现 CEX 成交与订单流 3 秒 stale 规则。
- [x] **P5-122** 实现 OI 6 分钟 stale 规则。
- [x] **P5-123** 实现系统时钟 drift hard gate。
- [ ] **P5-124** 实现 unresolved gap 对依赖条件的阻止关系。
- [x] **P5-125** 实现 `PASS/DEGRADED/BLOCKED/UNKNOWN` 数据健康聚合，但保留组件状态。
- [ ] **P5-126** 记录健康状态变化事件和恢复事件。
- [ ] **P5-127** UI/通知故障不得反向改变 feature 或 decision 状态。

### 5.8 特征与健康测试

- [x] **P5-140** 用手算小样本验证所有收益、回撤、订单流和 progress 公式。
- [ ] **P5-141** 为数值极端、0 分母、负数、超大 decimal 建立测试。
- [x] **P5-142** 测试 market-arm breadth 不重复计入 VIRTUAL。
- [ ] **P5-143** 测试窗口刚 warm-up、刚 stale 和刚恢复的边界。
- [ ] **P5-144** 测试 gap 只阻止依赖条件，不污染独立链/资产。
- [ ] **P5-145** 实时流与同一流的 replay 快照逐项一致。
- [x] **P5-146** 生成 2026-08-22 特征时间线并与既有逐秒研究点核对。

### Phase 5 退出门槛

- [ ] **P5-GATE-01** 实时与回放特征输出完全一致。
- [x] **P5-GATE-02** 所有关键特征都带 coverage、freshness、版本和 evidence。
- [x] **P5-GATE-03** OI baseline 与 running low 无未来函数。
- [x] **P5-GATE-04** `UNKNOWN/STALE` 不会生成 0% 伪进度。
- [ ] **P5-GATE-05** 数据健康能准确隔离受影响条件并生成审计事件。

---

## Phase 6：卖出模型、买回模型与经济行动门槛

目标：实现两个纯确定性的决策状态机，输出可解释条件、差距、hard gates 和 `NO_ACTION/SHADOW_CANDIDATE`，不接触任何钱包写权限。

### 6.1 决策核心框架

- [x] **P6-001** 实现纯函数式 `evaluateSell(snapshot, context, config)`。
- [x] **P6-002** 实现纯函数式 `evaluateRebuy(snapshot, context, config)`。
- [x] **P6-003** 禁止两个模型共享可变全局状态。
- [ ] **P6-004** 实现 condition registry：字段、方向、目标、progress 函数、freshness、持续时间、missing rule。
- [ ] **P6-005** 实现 hard gate registry：class、risk reduced、false block cost、blocking mode、scope、fallback、evidence。
- [ ] **P6-006** 对尚未测量的 VOI 和 latency 填 `UNKNOWN + reason`，不编造数字。
- [ ] **P6-007** 实现 stage transition ledger，记录 from/to、触发条件、时间和 evidence。
- [x] **P6-008** 实现模型版本冻结：同一事件周期不静默切换配置。
- [x] **P6-009** 实现 `NO_ACTION`、`SHADOW_CANDIDATE` 与 `ACTIONABLE_WITH_EVIDENCE` 的互斥输出。

### 6.2 通用进度函数

- [x] **P6-020** 实现 `progressDown(current, neutral, target)`。
- [x] **P6-021** 实现 `progressUp(current, neutral, target)`。
- [x] **P6-022** 实现 duration progress。
- [x] **P6-023** 数值 + 持续时间条件使用 `min(valueProgress, durationProgress)`。
- [x] **P6-024** `AND` 组合摘要使用最小子条件进度，同时保留全部子条件。
- [x] **P6-025** 将进度 clamp 到 `[0,1]`，处理等于目标和 neutral=target 配置错误。
- [x] **P6-026** 输入 `UNKNOWN/STALE/ERROR/UNSUPPORTED` 时返回对应状态，不返回数值进度。
- [ ] **P6-027** 输出 current、operator、target、gap、duration、source 和 data age。

### 6.3 Sell Model：风险上下文

- [x] **P6-040** 实现 `SELL_IDLE → NEWS_ARMED`，只接受满足置信、范围和 freshness 的新闻 cluster。
- [x] **P6-041** 实现 `SELL_IDLE → MARKET_ARMED`，使用不含 VIRTUAL 的 BTC/ETH/SOL breadth 与 volume anomaly。
- [x] **P6-042** 为 market-only 使用比 news-assisted 更严格的可配置阈值。
- [ ] **P6-043** 新闻窗口过期且市场未确认时回到 `SELL_IDLE`。
- [x] **P6-044** market anomaly 消失且没有其他警戒时回到 `SELL_IDLE`。
- [ ] **P6-045** 同一新闻与同一市场窗口使用稳定去重键，防止重复 arm。

### 6.4 Sell Model：预触发与确认

- [x] **P6-060** 实现 VIRTUAL/BTC/SOL 60 秒回撤固定下限。
- [x] **P6-061** 实现 robust volatility 归一化阈值，并选择更严格的绝对回撤要求。
- [x] **P6-062** 只有风险上下文和跨资产冲击均通过时进入 `SELL_PRETRIGGER`。
- [x] **P6-063** 实现 VIRTUAL 60 秒 taker buy/sell ratio `<=0.60` 候选条件。
- [x] **P6-064** 实现卖盘确认至少连续 3 秒的候选规则。
- [x] **P6-065** 订单流确认后进入 `SELL_CONFIRMED`。
- [x] **P6-066** 实现 VIRTUAL excess drawdown soft feature，不允许其单独触发阶段。
- [ ] **P6-067** 实现数据、身份、报价、成本和经济证据 hard gates。
- [x] **P6-068** 实现 `SELL_PRETRIGGER` 候选比例为战术仓位 25%。
- [x] **P6-069** 实现 `SELL_CONFIRMED` 候选比例为战术仓位剩余 75%。
- [x] **P6-070** 战术仓位 `UNSET` 时比例可显示，绝对数量为 `UNKNOWN`。

### 6.5 Sell Model：防抖、降级与冷却

- [ ] **P6-080** 定义并实现每个阶段的最短停留时间。
- [ ] **P6-081** 定义并实现信号撤销阈值与 hysteresis，避免边界来回跳动。
- [ ] **P6-082** 数据过期时进入 `BLOCKED_DATA`，但保留最后阶段与原因。
- [ ] **P6-083** 对应链报价失败时仅该链进入 execution blocked。
- [ ] **P6-084** 形成候选动作快照后进入 `SELL_COOLDOWN`，保留历史建议。
- [ ] **P6-085** 冷却期间风险再次升级且仍有剩余战术仓位时允许新 revision。
- [ ] **P6-086** 一秒恢复不得直接从卖出阶段跳到买回动作。

### 6.6 Rebuy Model：入口和运行中低点

- [ ] **P6-100** 只有真实人工卖出记录或带当时 DEX quote 的 Shadow fill 才创建 rebuy context。
- [x] **P6-101** 没有卖出事实时允许展示恢复程度，但输出必须为 `NO_ACTION`。
- [x] **P6-102** 保存本轮卖出数量、所得结算资产、链、钱包和 quote evidence。
- [ ] **P6-103** 从 `SELL_PRETRIGGER` 或策略定义起点开始维护 running low。
- [x] **P6-104** 每次新低重置 `seconds_since_last_low`。
- [x] **P6-105** 无新低 300 秒时进度达到 100%，但单独不能触发买回。

### 6.7 Rebuy Model：去杠杆与稳定条件

- [x] **P6-120** 使用 risk-arm 前最后一个新鲜 OI contracts 快照作为 baseline。
- [x] **P6-121** 实现 OI contracts decline `>=5%` 候选条件。
- [x] **P6-122** OI 过期或 baseline 缺失时该条件为 `UNKNOWN` 并阻止买回。
- [x] **P6-123** 实现 VIRTUAL 60 秒订单流比 `>=1.10`。
- [x] **P6-124** 实现订单流恢复连续 30 秒。
- [x] **P6-125** 实现 BTC 60 秒收益 `>=-0.10%`。
- [x] **P6-126** 实现 SOL 60 秒收益 `>=-0.30%`。
- [x] **P6-127** 实现 BTC/SOL 稳定连续 30 秒。
- [ ] **P6-128** ETH 明显冲突时输出 `CONFLICTING_SIGNAL` 并保持等待。
- [x] **P6-129** 四个市场恢复条件满足时进入 `REBUY_ARMED`，仍不代表链可执行。

### 6.8 Rebuy Model：永久损伤与分档

- [x] **P6-140** 实现永久损伤 `PASS/FAIL/UNKNOWN/UNKNOWN_REVIEW_REQUIRED` gate。
- [x] **P6-141** `FAIL` 或 `UNKNOWN` 阻止买回 action；其他正条件不能抵消。
- [ ] **P6-142** 第一档 DEX 买回可执行时输出使用卖出所得 50% 的候选。
- [ ] **P6-143** 第一档 Shadow fill 必须绑定当时 quote，否则保持 `EXECUTION_UNKNOWN`。
- [x] **P6-144** 第一档后进入 `REBUY_TRANCHE_2_WAIT`。
- [x] **P6-145** 第二档至少再稳定 5 分钟，且不得创新低、订单流恶化或成本超限。
- [ ] **P6-146** 第二档输出剩余 50% 候选，禁止超过本轮卖出所得与配置上限。
- [x] **P6-147** 重新恶化时回到 `REBUY_WAIT` 并保留已完成档位事实。

### 6.9 条件完成率与每链状态

- [x] **P6-160** Sell 面板严格输出 `passed_required_count/4`。
- [x] **P6-161** Rebuy 面板严格输出 `passed_required_count/5`。
- [x] **P6-162** 数据健康、资产身份、永久损伤和经济证据显示为独立 gates。
- [x] **P6-163** Base 和 Robinhood 使用同一信号状态，但独立计算第四/第五个 DEX 条件。
- [x] **P6-164** 同一快照允许 Base 为 `SHADOW_CANDIDATE`、Robinhood 为 `UNKNOWN`。
- [ ] **P6-165** next-missing-condition 按 gate 优先级和离目标差距生成，附精确 gap。
- [x] **P6-166** 禁止生成单一总分或“成功率”字段。

### 6.10 经济行动门槛

- [ ] **P6-180** 定义 `NO_ACTION` 基线的输入与输出 schema。
- [ ] **P6-181** 定义卖出/买回两侧成本项：价格影响、路由费、协议费、Gas、失败成本、人工延迟。
- [x] **P6-182** 实现 DEX effective sell/buy price 的 DecimalString 算法。
- [ ] **P6-183** 实现 round-trip token quantity delta 的 CEX reference 与 DEX executable 两套互斥口径。
- [x] **P6-184** 实现 `economic_evidence` 状态，初始固定 `POSITIVE_EV_NOT_PROVEN`。
- [x] **P6-185** 未完成 Phase 9/10 前，禁止经济 gate 返回 PASS。
- [x] **P6-186** 定义 lower confidence bound 与 decision margin 接口；样本不足时返回 `UNKNOWN`。
- [x] **P6-187** 将经济 gate 实现为 hard gate，不作为负权重。
- [ ] **P6-188** 压力场景覆盖快速反弹、继续暴跌、买不回、成本翻倍和报价失效。

### 6.11 模型测试

- [x] **P6-200** 测试平静市场不 arm。
- [x] **P6-201** 测试有新闻无价格反应只进入 `NEWS_ARMED`。
- [x] **P6-202** 测试无新闻强市场异常可进入 `MARKET_ARMED`。
- [ ] **P6-203** 测试 VIRTUAL 独跌不会被误判为全市场 market arm，但可作为资产特定风险观察。
- [ ] **P6-204** 测试 BTC 下跌而 VIRTUAL 抗跌不进入卖出确认。
- [x] **P6-205** 测试跨资产冲击与订单流冲突只进入预触发。
- [ ] **P6-206** 测试尖刺、持续恶化、V 型反转和 hysteresis。
- [x] **P6-207** 测试 OI 不下降、OI 下降仍创新低、无新低后再破低。
- [ ] **P6-208** 测试订单流恢复但 DEX 报价恶化。
- [x] **P6-209** 测试永久损伤 FAIL 与 UNKNOWN 均阻止买回。
- [ ] **P6-210** 测试关键数据缺失、过期、极端离群和条件冲突。
- [ ] **P6-211** 测试每个阈值下方/等于/上方边界。
- [ ] **P6-212** property test：任何 hard gate FAIL 都不能得到 actionable 输出。
- [x] **P6-213** property test：相同 snapshot/context/config 输出稳定一致。
- [ ] **P6-214** 使用 2026-08-22 fixture 跑完整状态时间线断言。

### Phase 6 退出门槛

- [x] **P6-GATE-01** Sell/Rebuy 模型完全独立且为纯确定性核心。
- [ ] **P6-GATE-02** 必测场景、边界、缺失、冲突和极端测试全部通过。
- [x] **P6-GATE-03** Base/Robinhood 信号共享但执行状态隔离。
- [x] **P6-GATE-04** 验证期无法产生 `ACTIONABLE_WITH_EVIDENCE`。
- [ ] **P6-GATE-05** 2026-08-22 回放状态与计划断言一致。

---

## Phase 7：Base 与 Robinhood Chain 的 DEX 只读适配

目标：为每条链提供可验证的资产身份和指定数量 DEX 报价；Base 当前按 ADR-0011 使用固定数量，明确不需要公开钱包。协议事实全部留在 adapter，决策核心不猜 ABI、router 或 finality。

### 7.1 通用链能力与 adapter 契约

- [x] **P7-001** 实现 `ChainTransportAdapter`：chain ID、最新块、RPC 健康、延迟和 failure semantics。
- [x] **P7-002** 实现 `IdentityAdapter`：chain、token、settlement asset、decimals、pool/router 证据列表。
- [x] **P7-003** 分离 identity binding 与 metadata confidence；symbol/name 不得替代地址和 chain ID。
- [x] **P7-004** 实现 `QuoteAdapter`：方向、数量、expected/minimum out、费用、Gas、route、block、observed/expires。
- [x] **P7-005** 实现 `WalletReadAdapter`：公开地址、余额、allowance 只读状态。
- [x] **P7-006** 实现每个 adapter 的 capability manifest 和 limitations。
- [x] **P7-007** sign/broadcast/calldata 第一版保持 `UNSUPPORTED`；接口实现不得含私钥参数。
- [ ] **P7-008** 定义 chain-specific finality、reorg、quote expiry 和 block lag，不放入通用核心猜测。
- [x] **P7-009** 实现 provider/RPC 错误脱敏，不记录 credential 或签名 URL。

### 7.2 Base 网络与资产身份

- [x] **P7-020** 当前链上复核 Base chain ID 与 RPC 返回值，保存 `VERIFIED_CURRENT` evidence。
- [x] **P7-021** 复核 Base VIRTUAL 合约 `0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b` 的 code、decimals、symbol 和标准兼容性。
- [x] **P7-022** 确认 Base 结算资产及其地址、decimals 和计价规则。
- [x] **P7-023** 发现并验证至少一个具有实际流动性的 VIRTUAL 路由/池。
- [ ] **P7-024** 记录 router/aggregator/pool 的来源、版本、费用、税费、hook/callback 与已知盲区。
- [x] **P7-025** 创建 Base `ChainProfile` 并生成配置 hash。
- [x] **P7-026** 测试错误 chain ID、错误 token、错误 decimals 和同 symbol 假币会被 identity gate 阻止。

### 7.3 Base 钱包只读能力

- [x] **P7-040 [DECIDED: NOT_REQUIRED]** 用户确认 Base 研究采用固定数量，不收集、不公开钱包地址；不得请求私钥或助记词。
- [x] **P7-041** Base API/UI 显示 `NOT_REQUIRED_FIXED_TEST_AMOUNTS`，不将钱包缺失冒充为报价失败。
- [ ] **P7-042** 读取 VIRTUAL、结算资产和 Gas 资产余额，并记录 block/observed time。
- [ ] **P7-043** 读取 allowance 仅作展示，不发送 approve。
- [ ] **P7-044** 余额超过 30 秒或链上变更后旧库存状态过期。
- [x] **P7-045** 战术仓位 `UNSET` 时不计算绝对卖出数量。

### 7.4 Base DEX 报价

- [x] **P7-060** 按 ADR-0011 为卖出 `1,000 / 5,000 / 10,000 VIRTUAL` 固定研究档请求双源报价，不从钱包比例推导。
- [ ] **P7-061** 为买回 50%/50% 卖出所得请求反向报价。
- [x] **P7-062** 记录 expected out、minimum out、price impact、route fee、protocol fee、Gas 与 total cost；无可复核分项证据的字段显式保持 `UNKNOWN`。
- [ ] **P7-063** 计算 effective sell/buy price，并与 CEX 参考价分栏。
- [x] **P7-064** 每个 quote 绑定 block、route、amount、direction、observed_at、expires_at 和 evidence。
- [x] **P7-065** 报价超过 5 秒或链头落后超过 2 个已知块时标记 stale。
- [ ] **P7-066** 在 adapter 支持时实现只读 simulation；明确覆盖范围和盲区。
- [x] **P7-067** 报价成功但 simulation unknown/fail 时按配置输出独立 gate，不伪装 quote 失败。
- [x] **P7-068** 将所有实时 quote 以 schema 校验、`0600` 权限和 fsync 追加写入历史存储，以便未来 DEX replay。

### 7.5 Robinhood Chain 身份与能力

- [ ] **P7-080 [BLOCKED: USER_INPUT]** 获取确切 chain ID、网络环境、官方 RPC/数据入口。
- [ ] **P7-081 [BLOCKED: USER_INPUT]** 获取 Robinhood Chain 上 VIRTUAL 合约/映射资产及桥接关系。
- [ ] **P7-082 [BLOCKED: USER_INPUT]** 获取结算资产和用户常用 DEX/聚合器信息。
- [x] **P7-083** 未取得强身份信息前，保持 `identity=UNKNOWN`，不得按 symbol 猜地址。
- [ ] **P7-084** 验证 chain ID、token code、decimals、结算资产和至少一个路由。
- [ ] **P7-085** 创建 Robinhood `ChainProfile` 与 capability manifest。
- [ ] **P7-086** 为映射/桥接资产记录兑付性、桥状态和永久损伤依赖。

### 7.6 Robinhood 钱包与报价

- [ ] **P7-100 [BLOCKED: USER_INPUT]** 获取 Robinhood 公开钱包地址。
- [ ] **P7-101** 实现钱包余额与 allowance 只读读取。
- [ ] **P7-102** 实现指定数量卖出/买回 quote。
- [ ] **P7-103** 实现价格影响、费用、Gas、block、expiry 与 effective price。
- [ ] **P7-104** 将 quote 写入独立历史分区，不能与 Base 混用。
- [x] **P7-105** 链不可用或未配置时 UI/API 返回 `UNSUPPORTED/UNKNOWN` 与原因。

### 7.7 Quote orchestrator 与链隔离

- [x] **P7-120** Base/Robinhood quote 并行请求，单链超时不阻塞另一链。
- [ ] **P7-121** 平静状态使用 5–15 秒频率，风险阶段按配置提高频率。
- [x] **P7-122** quote request 去重，避免同一链/方向/数量的无意义风暴。
- [x] **P7-123** last-known-good 只用于展示；超过 expiry 不能用于行动状态。
- [ ] **P7-124** 钱包余额变化、chain profile 变化或模型分档变化后使旧 quote 失效。
- [ ] **P7-125** 实现每链 quote 成功率、延迟 p50/p95/p99、stale 比率和错误分类。
- [x] **P7-126** 将 quote 状态合并进每链完成度的最后一个条件。

### 7.8 DEX/链测试

- [x] **P7-140** 测试精确 chain/token/settlement identity。
- [x] **P7-141** 测试 decimals 与不同数量级换算。
- [x] **P7-142** 测试不同交易数量的相对 size impact 单调性和异常偏差。
- [ ] **P7-143** 测试报价过期、链头停滞、reorg、RPC 超时和限流。
- [ ] **P7-144** 测试无路由、无流动性、余额不足和 Gas 资产不足。
- [x] **P7-145** 测试 quote success/simulation fail 的分离语义。
- [x] **P7-146** 测试 Base 故障不污染 Robinhood，反之亦然。
- [x] **P7-147** 测试同 symbol 错误 token 不通过身份 gate。
- [x] **P7-148** 测试历史 DEX quote 缺失时 replay 保持 `UNKNOWN`。
- [x] **P7-149** 运行至少 60 分钟 quote soak test，并生成覆盖率与延迟报告。
  - 收据：3,600.001 秒，308 attempts / 304 successes，909/912 档位双源 PASS，p50/p95/p99 为 1.385/2.217/3.640 秒，`minimumSixtyMinutesSatisfied=true`。

### Phase 7 退出门槛

- [x] **P7-GATE-01** Base network/identity/quote 至少达到 `TESTED`。
- [x] **P7-GATE-02** Base 指定数量报价有 block、expiry、费用（可证明值或显式 UNKNOWN）、有效价格和 evidence。
- [x] **P7-GATE-03** Robinhood 信息未提供时准确保持 `UNKNOWN/PLANNED`，不伪造完成。
- [x] **P7-GATE-04** 两条链的故障和数据完全隔离。
- [x] **P7-GATE-05** sign/broadcast/approve/execute 能力仍为 `UNSUPPORTED`。

---

## Phase 8：只读 API、可视化驾驶舱与通知

目标：让用户在 5 秒内理解当前阶段、条件缺口、数据健康和每条链可执行性，并能完整追溯证据。

### 8.1 只读 API

- [x] **P8-001** 实现 `GET /api/status`，返回模式、版本、数据健康、经济证据和 capability 摘要。
- [x] **P8-002** 实现 `GET /api/decision/current`。
- [ ] **P8-003** 实现 `GET /api/decision/history`，支持时间和模型过滤。
- [x] **P8-004** 实现 `GET /api/conditions/current?model=SELL|REBUY&chain=...`。
- [x] **P8-005** 实现 `GET /api/quotes/current?chain=...`。
- [x] **P8-006** 实现 `GET /api/news/clusters`。
- [x] **P8-007** 实现 `GET /api/events/timeline`。
- [x] **P8-008** 实现 `GET /api/data-health`。
- [x] **P8-009** 实现 `GET /api/wallets/read-only`；Base 固定数量研究返回 `NOT_REQUIRED_FIXED_TEST_AMOUNTS`，其他需库存的未配置链保持 `UNKNOWN`。
- [x] **P8-010** 实现 `GET /api/models/versions` 与配置 readback。
- [ ] **P8-011** 实现 replay start/pause/seek/step/speed 控制接口。
- [ ] **P8-012** 实现 operator acknowledge/mark-execution；明确人工标记不等于链上 receipt。
- [ ] **P8-013** 为所有响应提供 schema version、generated_at 和 evidence refs。
- [x] **P8-014** 添加 API 合约测试和 OpenAPI/JSON Schema 输出。
- [x] **P8-015** 添加路由否定测试，证明 sign/broadcast/approve/execute 返回不存在。

### 8.2 实时推送

- [ ] **P8-020** 选择 SSE 或 WebSocket 并记录 ADR；默认优先单向 SSE。
- [ ] **P8-021** 推送 data health、risk arm、sell/rebuy stage、quote、blocked 和 expiry 事件。
- [ ] **P8-022** 每个推送包含 event ID、dedupe ID、version、observed time 和 evidence refs。
- [ ] **P8-023** 客户端断线重连时从 last event ID 恢复，不丢关键状态转换。
- [ ] **P8-024** UI 断线不阻塞采集、决策或账本。

### 8.3 UI 基础与状态语义

- [ ] **P8-040** 建立响应式 React 应用、路由和本地 API client。
- [x] **P8-041** 建立状态设计 token：PASS/FAIL/UNKNOWN/STALE/VETO/BLOCKED。
- [x] **P8-042** 红色只用于 VETO/CRITICAL；UNKNOWN 使用独立颜色、图标和文案。
- [x] **P8-043** 所有颜色状态同时提供文本/图标，满足无障碍要求。
- [x] **P8-044** 金额与关键数值使用等宽数字，显示单位和 decimal 精度。
- [x] **P8-045** 全局固定展示“条件完成度不代表价格或盈利概率”。
- [x] **P8-046** 模式标签始终可见：REPLAY/SHADOW/LIVE_READ_ONLY。
- [x] **P8-047** 经济证据 `POSITIVE_EV_NOT_PROVEN` 在验证完成前始终可见。

### 8.4 页面 1：实时驾驶舱

- [ ] **P8-060** 顶部显示模式、Sell/Rebuy 当前阶段、数据健康、模型版本和最后更新时间。
- [x] **P8-061** 显示 Sell 必要条件 `n/4` 与 Rebuy `n/5`。
- [x] **P8-062** 显示 next missing condition、当前值、目标、精确 gap 和持续时间。
- [x] **P8-063** 显示 hard gates，不能混入完成度分母。
- [ ] **P8-064** 显示候选动作和比例；战术仓位未设置时隐藏绝对数量。
- [x] **P8-065** Base 与 Robinhood 使用独立卡片和状态。
- [x] **P8-066** 报价卡展示 direction、amount、expected/minimum out、effective price、price impact、费用、Gas、route、block、age/expiry 和 simulation；无证据项显式为 `UNKNOWN/UNSUPPORTED`。
- [ ] **P8-067** 报价过期倒计时归零后立即转为 STALE，不能保持绿色。
- [x] **P8-068** 市场信号 ready 但经济 gate 未证明时显示 `SHADOW_CANDIDATE`，不得显示可盈利文案。

### 8.5 条件卡和图表

- [ ] **P8-080** 条件卡展示状态、进度、当前、operator、目标、gap、趋势、持续时间、数据年龄和来源。
- [x] **P8-081** `UNKNOWN/STALE` 卡不显示 0% 进度。
- [ ] **P8-082** 组合条件展开显示所有子条件，摘要用最小进度。
- [ ] **P8-083** 实现 BTC/ETH/SOL/VIRTUAL 对齐价格图。
- [ ] **P8-084** 实现多窗口收益与回撤图。
- [ ] **P8-085** 实现 VIRTUAL taker buy/sell、ratio 与净主动流图。
- [ ] **P8-086** 实现 OI contracts、OI USD 和 baseline 图，视觉上明确区分。
- [ ] **P8-087** 数据 gap 在图表中显示为空缺/阴影，不插值冒充真实值。

### 8.6 页面 2–7

- [ ] **P8-100** 实现事件中心：cluster、首发、传播链、置信、严重度、attention、永久损伤审核。
- [ ] **P8-101** 实现市场结构页：价格、订单流、OI、强平、资金费率和数据覆盖。
- [ ] **P8-102** 实现回放实验室：事件选择、播放速度、暂停、seek、逐秒、模型版本比较。
- [ ] **P8-103** 回放 UI 只显示虚拟时钟当时可见数据。
- [ ] **P8-104** 实现 CEX reference 与 DEX executable 反事实分栏。
- [ ] **P8-105** 实现 Shadow 账本：建议、quote、假设成交、未成交原因、成本覆盖和 token delta。
- [ ] **P8-106** 实现数据健康页：adapter、last message、gap、clock drift、rate limit、quote 延迟与 capability level。
- [ ] **P8-107** 实现设置与版本页：网络/资产/钱包只读/模型阈值/成本/新闻/通知/模式。
- [ ] **P8-108** 设置页只生成配置变更提案或安全更新，不允许添加秘密到浏览器持久存储。
- [ ] **P8-109** 实现证据详情抽屉，可从决策追到 snapshot、source 和 quote。

### 8.7 移动端与可访问性

- [ ] **P8-120** 手机首屏显示阶段、建议、下一个缺口、Base 和 Robinhood 状态。
- [ ] **P8-121** 条件卡支持折叠，但 hard gate/VETO 不得默认隐藏。
- [ ] **P8-122** 测试窄屏、横屏、桌面和高分辨率布局。
- [ ] **P8-123** 测试键盘导航、屏幕阅读器标签、对比度和不依赖颜色。
- [x] **P8-124** 关键状态变化不使用会误导为博彩概率的动画或视觉。

### 8.8 通知

- [ ] **P8-140** 实现 INFO/WATCH/ACTION/CRITICAL 通知等级。
- [ ] **P8-141** ACTION 通知仅在模型条件达到候选且至少一条链 quote 新鲜时生成；验证期标记 Shadow。
- [ ] **P8-142** 通知包含满足条件、缺口、两链状态、quote expiry、数据时间和“不是成交回执”。
- [ ] **P8-143** 实现 stage/quote/dedupe ID 去重与冷却，防止通知风暴。
- [ ] **P8-144** 实现故障与恢复配对通知。
- [ ] **P8-145** REPLAY 默认只在 UI 内显示，不发送外部通知。
- [ ] **P8-146 [BLOCKED: USER_INPUT]** 确认用户希望使用的外部通知渠道。
- [x] **P8-147** 在未选择外部渠道时提供本地桌面/浏览器通知或保持 UI-only。

### 8.9 UI/API 测试

- [ ] **P8-160** 为 API 正常、UNKNOWN、STALE、VETO 和错误响应建立合约测试。
- [ ] **P8-161** 用 fixtures 覆盖 Base ready/Robinhood unknown 及反向状态。
- [ ] **P8-162** E2E 验证首页 5 秒内能回答 plan.md 第 12.1 节十个问题。
- [ ] **P8-163** E2E 验证 quote 过期后 UI 与通知立即降级。
- [ ] **P8-164** E2E 验证 2026-08-22 时间线和回放控制。
- [x] **P8-165** E2E 验证没有 sign/broadcast/approve/execute UI 或 API。
- [ ] **P8-166** 视觉回归覆盖桌面与移动端关键状态。
- [ ] **P8-167** 运行可访问性自动检查和人工键盘检查。

### Phase 8 退出门槛

- [ ] **P8-GATE-01** 首页在 5 秒内清楚显示阶段、缺口和两链状态。
- [x] **P8-GATE-02** 条件完成度、hard gates 和经济证据互不混淆。
- [ ] **P8-GATE-03** 所有报价和决策可追溯到 evidence。
- [ ] **P8-GATE-04** 移动端和可访问性测试通过。
- [x] **P8-GATE-05** UI/API 全面只读，无交易写路径。

---

## Phase 9：历史事件集、模型验证与经济性评估

目标：用预先定义的样本规则和留出评估证明或推翻信号优势，禁止围绕单次成功事件过拟合。

### 9.1 定义事件全集与抽样规则

- [ ] **P9-001** 定义“市场冲击事件”的 canonical 入口条件、开始时间、结束时间和去重规则。
- [ ] **P9-002** 定义负样本：有新闻无下跌、高波动无持续冲击、VIRTUAL 独跌、快速 V 反等。
- [ ] **P9-003** 定义事件可用性水位：数据完整范围、缺口、源覆盖和时区。
- [ ] **P9-004** 建立机会漏斗：全市场候选 → 本地可观察 → 数据完整 → 条件 eligible → no-action/blocked/candidate → 可评估结果。
- [ ] **P9-005** 预先冻结样本纳入/排除标准，禁止看到策略结果后挑选事件。
- [ ] **P9-006** 预先冻结事件标签定义，不能只以“后来跌了”作为真值。
- [ ] **P9-007** 记录采样期间、来源和可能的幸存者偏差。

### 9.2 构建至少 30 个事件的数据集

- [ ] **P9-020** 收集宏观政策冲击事件。
- [ ] **P9-021** 收集地缘政治冲击事件。
- [ ] **P9-022** 收集全市场清算事件。
- [ ] **P9-023** 收集稳定币/交易所/市场基础设施事件。
- [ ] **P9-024** 收集 VIRTUAL/Virtuals 特定事件。
- [ ] **P9-025** 收集假新闻或新闻无价格反应事件。
- [ ] **P9-026** 收集没有明确新闻的高波动事件。
- [ ] **P9-027** 收集快速 V 型反转事件。
- [ ] **P9-028** 收集慢速持续下跌事件。
- [ ] **P9-029** 使总样本至少达到 30，并记录每类数量；单类不能垄断结果。
- [ ] **P9-030** 对每个事件保存原始数据 checksum、coverage、来源和已知限制。
- [ ] **P9-031** 历史 DEX 报价不可得时明确标 `UNKNOWN`，不使用当前池状态回填过去。

### 9.3 训练、验证和版本冻结

- [ ] **P9-040** 按时间顺序划分参数探索集与留出验证集，禁止随机泄漏未来市场状态。
- [ ] **P9-041** 冻结 v0.1 参数、模型版本和配置 hash 后再运行留出集。
- [ ] **P9-042** 对固定阈值、波动率系数、持续时间和分档比例做敏感性网格。
- [ ] **P9-043** 比较 news-assisted 与 market-only 两条路径的增量价值。
- [ ] **P9-044** 比较 BTC/SOL 核心条件与 ETH 广度/冲突信号的增量价值。
- [ ] **P9-045** 检验 excess drawdown soft 特征是否有增量；无证据则保持 soft 或删除。
- [ ] **P9-046** 进行 walk-forward 或滚动留出评估，记录每个市场状态结果。
- [ ] **P9-047** 每次参数修改创建新模型版本，旧结果不可被覆盖。

### 9.4 批量回放与信号指标

- [ ] **P9-060** 对全部事件运行确定性批量 replay。
- [ ] **P9-061** 计算 false-arm、sell-pretrigger、sell-confirm、false-sell 和漏报。
- [ ] **P9-062** 计算 risk arm → pretrigger → confirm → 局部低点的领先/滞后分布。
- [ ] **P9-063** 计算 rebuy-arm、first tranche、second tranche 与后续价格路径。
- [ ] **P9-064** 计算预触发到确认转化率和条件冲突率。
- [ ] **P9-065** 计算新闻源首次接收、市场启动和各传播节点的相对延迟。
- [ ] **P9-066** 计算数据 gate、identity gate、quote gate 和经济 gate 的阻止次数。
- [ ] **P9-067** 计算每个 gate 的 false-block 候选与避免损失候选，证据不足时保持 VOI `UNKNOWN`。
- [ ] **P9-068** 计算每类事件和总体的 p50/p95/p99 信号领先时间。

### 9.5 策略与经济指标

- [ ] **P9-080** 计算不交易 `NO_ACTION` 基线。
- [ ] **P9-081** 计算只卖不买基线。
- [ ] **P9-082** 计算一次性全部卖出/买回基线。
- [ ] **P9-083** 计算 25%/75% 卖出与 50%/50% 买回策略。
- [ ] **P9-084** 对战术仓位 10%/20%/40% 运行情景，不把情景比例当用户授权。
- [ ] **P9-085** 计算 CEX reference token quantity delta，并明确为参考反事实。
- [ ] **P9-086** 仅对有历史指定数量 DEX quote 的时间段计算 DEX executable 反事实。
- [ ] **P9-087** 加入卖出/买回 Gas、路由费、协议费、price impact 和失败成本。
- [ ] **P9-088** 加入人工反应延迟 1/3/5/10/30 秒敏感性。
- [ ] **P9-089** 计算最大不利波动、最大踏空、买回后继续下跌和买不回压力场景。
- [ ] **P9-090** 计算 token quantity delta 的分布、置信区间/稳健区间和下行尾部。
- [ ] **P9-091** 检查结果是否由单一事件、单一月份或单一市场类型贡献。

### 9.6 失败分析与模型迭代

- [ ] **P9-100** 为每个明显错误结果分类：field/definition/function/mapping/gate/data/implementation。
- [ ] **P9-101** 记录每个失败样本当时可用的原始输入和 hard gates。
- [ ] **P9-102** 只修改导致失败的最小字段、函数、阈值或映射。
- [ ] **P9-103** 修改后重跑探索集、留出集和所有既有回归 fixtures。
- [ ] **P9-104** 记录“通过、失败、修改、副作用、仍需决策、推荐默认”的迭代日志。
- [ ] **P9-105** 若新闻没有增量价值，提出降级为展示/永久损伤专用的决策评审。
- [ ] **P9-106** 若 DEX 成本吞噬优势，正式输出 `NO_ACTION/REFUTED`，不通过缩小样本美化结果。

### 9.7 Phase 9 评审结论

- [ ] **P9-120** 生成完整历史验证报告，列出数据覆盖、样本构成、模型版本和限制。
- [ ] **P9-121** 分开报告 `CEX_REFERENCE`、`DEX_EXECUTABLE` 和 `EXECUTION_UNKNOWN`。
- [ ] **P9-122** 分开报告成功规避、误卖踏空、早买、迟买和未买回。
- [ ] **P9-123** 给出 `SUPPORTED / REFUTED / INCONCLUSIVE`，不得只给单个平均收益。
- [ ] **P9-124** 明确经济证据仍是 `POSITIVE_EV_NOT_PROVEN`，除非留出结果达到预定义门槛。
- [ ] **P9-125** 决定是否进入 Phase 10 Shadow；若不进入，记录停止/修订原因。

### Phase 9 退出门槛

- [ ] **P9-GATE-01** 至少 30 个包含正负样本的事件完成回放。
- [ ] **P9-GATE-02** 参数选择与留出验证严格分离。
- [ ] **P9-GATE-03** CEX 与 DEX 经济口径严格分离。
- [ ] **P9-GATE-04** 所有失败样本和模型修改有审计记录。
- [ ] **P9-GATE-05** 已形成是否值得进入实时 Shadow 的明确结论。

---

## Phase 10：实时 Shadow、运行可靠性与 14 天验证

目标：用实时数据生成但不执行决策，持续记录 DEX 报价、延迟、数据缺口和反事实，验证理论优势是否能在真实运行边界中存在。

### 10.1 Shadow 前部署决策

- [ ] **P10-001** 评审本地、全云或混合部署，记录 14 天连续运行的选择与理由。
- [ ] **P10-002** 若继续本地运行，关闭睡眠或明确非 24/7 窗口，并在报告中标记覆盖限制。
- [ ] **P10-003** 若使用云端，完成最小权限、网络、凭证、日志和备份安全评审。
- [ ] **P10-004** 配置仓库外秘密存储和轮换流程。
- [ ] **P10-005** 记录运行版本、配置 hash、数据源 capability 和启动时间。

### 10.2 运行管理与恢复

- [ ] **P10-020** 实现服务 supervisor 与崩溃自动重启。
- [ ] **P10-021** 启动时恢复 source offsets、未完成数据 gap、状态机上下文和最近快照。
- [ ] **P10-022** 重启后在窗口 warm-up 完成前保持关键条件 `UNKNOWN`。
- [ ] **P10-023** 实现磁盘空间、数据库、Parquet 写入、API 和 UI 健康检查。
- [ ] **P10-024** 实现数据源限流/断线/恢复告警。
- [ ] **P10-025** 单一链故障只隔离该链 quote capability。
- [ ] **P10-026** 新闻系统故障继续 market-only 路径。
- [ ] **P10-027** 决策账本写入失败时停止产生新 Shadow candidates。
- [ ] **P10-028** 建立恢复演练：进程在风险阶段、报价 pending 和 rebuy wait 时重启。

### 10.3 Shadow 头寸与反事实

- [ ] **P10-040** 只有当时新鲜的指定数量 DEX quote 才能创建 `shadow_fill`。
- [ ] **P10-041** quote 缺失时记录 `EXECUTION_UNKNOWN`，不使用 CEX 价替代。
- [ ] **P10-042** Shadow 卖出记录 chain、wallet profile、quantity scenario、quote、成本和阶段。
- [ ] **P10-043** Shadow 买回只使用对应卖出所得，不能凭空增加资金。
- [ ] **P10-044** 多条链分别维护 Shadow 账本，不合并库存或报价。
- [ ] **P10-045** 计算完整卖出—买回的 token quantity delta 与 coverage。
- [ ] **P10-046** 未完成一轮时显示 OPEN/PARTIAL/UNKNOWN，不伪造 realized result。
- [ ] **P10-047** 用户可标记人工“已执行/忽略”，但必须与 Shadow 和链上 receipt 状态分开。
- [ ] **P10-048 [OPTIONAL]** 用户提供 tx hash 时，创建只读链上对账记录；没有 tx hash 不推断成交。

### 10.4 运行指标与日报

- [ ] **P10-060** 每日生成市场数据完整率、gap、stale 时间和重连次数。
- [ ] **P10-061** 每日生成 news source 延迟、聚类、重复和失败统计。
- [ ] **P10-062** 每日生成 Base/Robinhood quote 成功率、stale 率和 p50/p95/p99 延迟。
- [ ] **P10-063** 每日生成 decision latency：received→normalized→feature→decision→quote→UI/notification。
- [ ] **P10-064** 每日生成 arm/pretrigger/confirm/rebuy/block/unknown 漏斗。
- [ ] **P10-065** 每日生成 Shadow CEX 与 DEX 分层结果。
- [ ] **P10-066** 每周生成误卖、漏报、早买、迟买、报价不可执行和数据阻止复盘。
- [ ] **P10-067** 报告任何 hard gate bypass；预期次数必须为 0。

### 10.5 运行至少 14 天

- [ ] **P10-080** 启动正式 Shadow run，冻结模型版本与配置 hash。
- [ ] **P10-081** 连续记录至少 14 个自然日；计划停机与实际中断分开记录。
- [ ] **P10-082** 市场数据完整率目标达到 >=99.5%（排除已声明计划停机）。
- [ ] **P10-083** 所有 candidate、blocked 和 unknown 决策均可回放。
- [ ] **P10-084** 若 14 天没有足够高波动窗口，延长 Shadow，而不是自动通过。
- [ ] **P10-085** 记录每个风险窗口的真实 quote coverage 和用户可见通知延迟。
- [ ] **P10-086** 运行期间不得基于结果临时改参数；需要修改时终止当前版本并新开 run。

### 10.6 故障与压力演练

- [ ] **P10-100** 演练 CEX WebSocket 断线与补洞失败。
- [ ] **P10-101** 演练 OI stale 对买回的阻止。
- [ ] **P10-102** 演练新闻源全部不可用时 market-only 继续。
- [ ] **P10-103** 演练 Base RPC/quote 故障时 Robinhood 隔离运行，反向亦然。
- [ ] **P10-104** 演练系统时钟漂移阻止行动。
- [ ] **P10-105** 演练磁盘满/ledger 写失败停止新 candidate。
- [ ] **P10-106** 演练 quote 刚好过期时 UI、通知和状态同步降级。
- [ ] **P10-107** 演练永久损伤 `UNKNOWN_REVIEW_REQUIRED` 阻止买回。

### 10.7 Shadow 评审

- [ ] **P10-120** 生成 14 天或延长期完整 Shadow 报告。
- [ ] **P10-121** 比较历史回放与实时 Shadow 的特征、阶段、延迟和经济差异。
- [ ] **P10-122** 核对所有行动快照可重放且没有未来函数。
- [ ] **P10-123** 核对 DEX quote coverage 是否足以评估经济性。
- [ ] **P10-124** 计算相对 `NO_ACTION` 的保守结果和下行尾部。
- [ ] **P10-125** 判断经济 gate 为 `PASS/FAIL/UNKNOWN`，并保存模型版本和证据。
- [ ] **P10-126** 只有在预定义门槛通过时，提出进入 `LIVE_READ_ONLY` 的评审；否则保持 Shadow 或停止。

### Phase 10 退出门槛

- [ ] **P10-GATE-01** 至少 14 天且覆盖足够真实风险窗口；否则已明确延长。
- [ ] **P10-GATE-02** 数据完整率、quote coverage 和延迟达到预定义门槛。
- [ ] **P10-GATE-03** 所有 Shadow candidates 有证据，缺 quote 的保持 unknown。
- [ ] **P10-GATE-04** hard gate bypass、错误资产和过期报价误用次数均为 0。
- [ ] **P10-GATE-05** 已形成经济 gate 的正式证据结论。

---

## Phase 11：LIVE_READ_ONLY 发布评审与运行交付

目标：只有验证与安全门槛通过后，才把 Shadow 信号升级为用户可依赖的只读人工决策界面；系统仍不签名、不广播。

### 11.1 发布前证据评审

- [ ] **P11-001** 确认 Phase 0–10 所有必需 gate 已通过或有明确例外批准。
- [ ] **P11-002** 确认历史验证与 Shadow 均不依赖单一事件获得正结果。
- [ ] **P11-003** 确认经济 gate 相对 `NO_ACTION` 的保守下界超过 decision margin。
- [ ] **P11-004 [BLOCKED: USER_INPUT]** 用户确认可接受的 price impact、总成本、Gas 和 decision margin。
- [ ] **P11-005 [BLOCKED: USER_INPUT]** 用户确认战术仓位占总 VIRTUAL 的比例；未确认则继续只显示比例。
- [ ] **P11-006** 确认 Base/Robinhood 每项 capability 的证据等级与限制准确。
- [ ] **P11-007** 确认任何未验证链保持 `UNKNOWN/UNSUPPORTED`，不阻止已验证链只读发布。

### 11.2 安全与正确性审计

- [ ] **P11-020** 运行秘密扫描、依赖审计、许可证检查和构建产物检查。
- [ ] **P11-021** 检查仓库、日志、浏览器存储和导出中不存在私钥/助记词/API secret。
- [ ] **P11-022** 检查所有 API 路由，不存在 sign/broadcast/approve/execute。
- [ ] **P11-023** 检查 chain/token/settlement identity hard gate 可达且配置实际接线。
- [ ] **P11-024** 检查 quote expiry、data freshness 和 economic gate 实际接入最终行动状态。
- [ ] **P11-025** 检查 UI 不将条件进度、历史胜率或 Shadow 结果写成盈利保证。
- [ ] **P11-026** 检查 `UNKNOWN` 不能被任何 fallback 变成可行动 PASS。
- [ ] **P11-027** 检查 `Virtuals Whale Radar` 不在依赖、代码、文档运行链或数据源中。

### 11.3 运行手册与交付

- [ ] **P11-040** 编写本地启动、停止、重启和升级手册。
- [ ] **P11-041** 编写数据源断线、quote 故障、时钟漂移、磁盘满和存储损坏 runbook。
- [ ] **P11-042** 编写备份、恢复和 180 天保留 dry-run/执行手册。
- [ ] **P11-043** 编写模型/配置版本升级与回滚手册。
- [ ] **P11-044** 编写如何判断 `SIGNAL_READY`、`SHADOW_CANDIDATE`、`ACTIONABLE_WITH_EVIDENCE` 的用户说明。
- [ ] **P11-045** 编写人工成交标记与真实 tx receipt 区别说明。
- [ ] **P11-046** 编写已知限制：CEX 参考、DEX quote、人工延迟、Robinhood 配置、未保证盈利。

### 11.4 发布与当前状态 readback

- [ ] **P11-060** 构建 production artifact，并记录版本/hash。
- [ ] **P11-061** 启动 `LIVE_READ_ONLY`，读取实际运行配置和 capability manifest。
- [ ] **P11-062** 验证当前 BTC/ETH/SOL/VIRTUAL 数据流 freshness。
- [ ] **P11-063** 验证当前 Base/Robinhood quote 状态与各自证据。
- [ ] **P11-064** 验证当前数据健康、经济 gate、模型版本和 UI 状态一致。
- [ ] **P11-065** 运行移动端/桌面 smoke test 和通知 smoke test。
- [ ] **P11-066** 保存 `VERIFIED_CURRENT` readback 报告；只声明本轮真实验证的能力。

### 11.5 发布后观察

- [ ] **P11-080** 发布后一周持续监测数据 gap、quote stale、通知延迟和错误率。
- [ ] **P11-081** 任何 hard gate 失效时自动降级回 Shadow/blocked，不继续显示 actionable。
- [ ] **P11-082** 每个真实用户决策保留当时证据；用户未执行不视为模型失败或成交失败。
- [ ] **P11-083** 定期重新评估新闻付费源、部署形态和数据保留成本。
- [ ] **P11-084** 模型经济证据恶化时撤销 actionable 能力并回到 `POSITIVE_EV_NOT_PROVEN`。

### Phase 11 退出门槛

- [ ] **P11-GATE-01** `LIVE_READ_ONLY` 当前 readback 与文档声称能力一致。
- [ ] **P11-GATE-02** 只读安全审计通过，签名与广播能力为 `UNSUPPORTED`。
- [ ] **P11-GATE-03** 用户能在首页明确看到条件、缺口、两链执行状态和经济证据。
- [ ] **P11-GATE-04** 故障会 fail-closed/degrade，不会静默继续 actionable。
- [ ] **P11-GATE-05** 运行手册、恢复手册和已知限制齐全。

---

## Phase 12：可选交易准备或自动执行（当前禁止）

> 本阶段全部为 `GATED: AUTHORIZATION`。当前不得开始编码、接钱包、签名或广播。只有用户在完成历史验证、Shadow 与独立安全评审后明确授权，才能另开需求文档和开发计划。

### 12.1 新授权与独立需求

- [ ] **P12-001 [GATED: AUTHORIZATION]** 用户明确选择 `PREPARE_ONLY` 或 `AUTO_EXECUTE`，并记录授权范围。
- [ ] **P12-002 [GATED: AUTHORIZATION]** 新建独立 PRD，定义目标、机会衰减、风险预算、单次最大损失、并发敞口和最大 UNKNOWN age。
- [ ] **P12-003 [GATED: AUTHORIZATION]** 定义钱包 owner、nonce lease、资本 reservation 和单 writer 不变量。
- [ ] **P12-004 [GATED: AUTHORIZATION]** 定义 `Opportunity → Intent → ExecutionPlan → TxAttempt → EffectRecord → Position/ExitPlan`。
- [ ] **P12-005 [GATED: AUTHORIZATION]** 定义 AuthorizationRecord、scope hash、risk envelope、有效期和人工确认语义。

### 12.2 交易准备与保护

- [ ] **P12-020 [GATED: AUTHORIZATION]** 实现 calldata builder 与 plan hash，不在旧只读路径中复用未审计代码。
- [ ] **P12-021 [GATED: AUTHORIZATION]** 实现指定数量、min output、max fee、max total cost 和有效期绑定。
- [ ] **P12-022 [GATED: AUTHORIZATION]** 实现 quote/simulation freshness 与 plan invalidation。
- [ ] **P12-023 [GATED: AUTHORIZATION]** `PREPARE_ONLY` 只生成草案，由用户钱包界面确认。
- [ ] **P12-024 [GATED: AUTHORIZATION]** 私钥保持在仓库外部、最小权限 signer 中，LLM 永不接触。

### 12.3 广播、对账与恢复

- [ ] **P12-040 [GATED: AUTHORIZATION]** 明确 same-raw rebroadcast、same-nonce replacement、cancel 和 new intent。
- [ ] **P12-041 [GATED: AUTHORIZATION]** 区分 accepted/known/included/receipt/effect/balance，不以 RPC ACK 视为成交。
- [ ] **P12-042 [GATED: AUTHORIZATION]** 实现 receipt、event、balance 与 EffectRecord 对账。
- [ ] **P12-043 [GATED: AUTHORIZATION]** UNKNOWN 保留 nonce/资本并隔离 wallet lane，不能超时自动当失败。
- [ ] **P12-044 [GATED: AUTHORIZATION]** 实现重启恢复、replacement/cancel 和人工复核 runbook。
- [ ] **P12-045 [GATED: AUTHORIZATION]** 新 entry 熔断不阻止 receipt、recovery 和退出。

### 12.4 实盘前额外门槛

- [ ] **P12-060 [GATED: AUTHORIZATION]** 至少 100 个多市场状态事件和 walk-forward 验证。
- [ ] **P12-061 [GATED: AUTHORIZATION]** 小额、明确预算的测试网/仿真/受控实盘实验。
- [ ] **P12-062 [GATED: AUTHORIZATION]** 独立安全审计、秘密管理审计与灾难恢复演练。
- [ ] **P12-063 [GATED: AUTHORIZATION]** 真实 receipt、成本、退出和仓位闭环达到预定义门槛。
- [ ] **P12-064 [GATED: AUTHORIZATION]** 用户再次明确授权自动执行，不由本项目当前授权继承。

### Phase 12 退出门槛

- [ ] **P12-GATE-01 [GATED: AUTHORIZATION]** 独立授权记录、PRD、风险预算和安全边界已批准。
- [ ] **P12-GATE-02 [GATED: AUTHORIZATION]** Intent/Plan/Attempt/Effect/Position/Exit 状态与恢复测试通过。
- [ ] **P12-GATE-03 [GATED: AUTHORIZATION]** 签名、nonce、广播、receipt 和 UNKNOWN 对账完成独立安全审计。
- [ ] **P12-GATE-04 [GATED: AUTHORIZATION]** 小额受控实验满足预算、样本和停止条件。
- [ ] **P12-GATE-05 [GATED: AUTHORIZATION]** 用户在看到验证与审计结果后再次明确授权所选执行级别。

---

## 13. 用户输入与外部依赖清单

这些任务保持未勾选，直到获得真实输入。未完成不阻塞无关主流程。

- [ ] **INPUT-001 [BLOCKED: USER_INPUT]** Robinhood Chain 确切 chain ID、网络环境与官方数据/RPC 入口。
- [ ] **INPUT-002 [BLOCKED: USER_INPUT]** Robinhood Chain VIRTUAL 合约/映射资产、桥接关系和结算资产。
- [ ] **INPUT-003 [BLOCKED: USER_INPUT]** Robinhood Chain 常用 DEX/聚合器。
- [x] **INPUT-004 [DECIDED: NOT_REQUIRED]** 用户确认 Base 固定数量研究不提供公开钱包；未来实际库存研究需另行授权。
- [ ] **INPUT-005 [BLOCKED: USER_INPUT]** Robinhood 公开钱包地址。
- [ ] **INPUT-006 [BLOCKED: USER_INPUT]** 用户可接受的单次 price impact 上限。
- [ ] **INPUT-007 [BLOCKED: USER_INPUT]** 用户可接受的 round-trip 总成本/Gas 上限。
- [ ] **INPUT-008 [BLOCKED: USER_INPUT]** 战术仓位占总 VIRTUAL 的比例。
- [ ] **INPUT-009 [BLOCKED: USER_INPUT]** 通知渠道偏好。
- [ ] **INPUT-010 [BLOCKED: USER_INPUT]** 已有付费新闻/行情订阅及合法接入方式。
- [ ] **INPUT-011 [BLOCKED: USER_INPUT]** 是否要求 24/7 运行；如要求，选择云端或混合部署。
- [ ] **INPUT-012 [OPTIONAL]** 用户是否愿意在人工交易后提供 tx hash 做只读对账。

输入缺失时的默认行为：

- [x] **INPUT-DEFAULT-01** Robinhood 身份未知时显示 `UNKNOWN/PLANNED`，不得按名称猜测。
- [x] **INPUT-DEFAULT-02** 钱包地址未知时不输出余额或实际库存结论；固定研究数量不等于用户绝对交易数量。
- [x] **INPUT-DEFAULT-03** 战术仓位未知时仅展示 10%/20%/40% 情景和档位比例。
- [x] **INPUT-DEFAULT-04** 成本上限未知时只展示 quote 明细，不升级为 actionable。
- [x] **INPUT-DEFAULT-05** 通知渠道未知时使用 UI-only 或本地通知。

---

## 14. 全局完成定义（Definition of Done）

任何阶段或功能在满足以下对应条件前不得标记完成。

### 14.1 功能完成

- [x] **DOD-FUNC-01** 需求与 `plan.md` 对应关系明确。
- [ ] **DOD-FUNC-02** 正常、边界、缺失、过期、冲突和极端测试存在并通过。
- [x] **DOD-FUNC-03** 错误和降级行为有明确状态，不依赖日志猜测。
- [x] **DOD-FUNC-04** 配置字段已证明进入真实调用点。
- [ ] **DOD-FUNC-05** 文档、schema/API 和运行 readback 一致。

### 14.2 数据完成

- [ ] **DOD-DATA-01** 数据源、单位、时间、freshness、coverage 和 missing rule 明确。
- [x] **DOD-DATA-02** 原始 evidence 可追溯且 hash/版本可复核。
- [ ] **DOD-DATA-03** 重复、乱序、断线、补洞和 schema 漂移已测试。
- [x] **DOD-DATA-04** `KNOWN(0)`、`UNKNOWN`、`UNSUPPORTED`、`ERROR` 和 `STALE` 不混淆。
- [x] **DOD-DATA-05** 历史回放不使用未来信息。

### 14.3 模型完成

- [x] **DOD-MODEL-01** 决策问题、输出、字段、维度、函数、组合和映射均有版本。
- [x] **DOD-MODEL-02** hard gate 不被总分抵消。
- [x] **DOD-MODEL-03** 进度不被展示为概率。
- [ ] **DOD-MODEL-04** 真实、历史和模拟测试均有结果与失败分析。
- [x] **DOD-MODEL-05** 未证明经济性时保持 `POSITIVE_EV_NOT_PROVEN`。

### 14.4 链能力完成

- [ ] **DOD-CHAIN-01** chain ID、token、settlement asset、decimals 和 route 有强证据。
- [ ] **DOD-CHAIN-02** quote 绑定数量、方向、区块、路由和到期时间。
- [x] **DOD-CHAIN-03** Base/Robinhood 故障与状态隔离。
- [x] **DOD-CHAIN-04** capability level 与真实证据一致，quote 不推出 simulation/execute。
- [x] **DOD-CHAIN-05** 第一版 sign/broadcast 保持 `UNSUPPORTED`。

### 14.5 发布完成

- [ ] **DOD-REL-01** lint/typecheck/unit/integration/e2e/build 全部通过。
- [x] **DOD-REL-02** 秘密扫描、依赖审计和禁用能力扫描通过。
- [ ] **DOD-REL-03** 运行、恢复、备份和故障手册齐全。
- [ ] **DOD-REL-04** 当前运行 readback 与声称能力一致。
- [x] **DOD-REL-05** 用户可见已知限制和证据等级准确。

---

## 15. 需求覆盖核对

- [ ] **TRACE-001** 新闻源分布与不只依赖 Twitter：Phase 4 完整覆盖。
- [x] **TRACE-002** 数据侧独立发现风险：Phase 5/6 market-only 路径覆盖。
- [x] **TRACE-003** 本次事件可重新运行：Phase 3 fixture 与 Phase 6 回放覆盖。
- [x] **TRACE-004** 卖出与买回：Phase 6 两套状态机覆盖。
- [x] **TRACE-005** 进度条显示满足项与差距：Phase 6 输出 + Phase 8 UI 覆盖。
- [ ] **TRACE-006** DEX 钱包而非 CEX 执行：Phase 7 只读钱包与 DEX quote 覆盖。
- [x] **TRACE-007** Base 与 Robinhood 共用分析、独立执行：Phase 6/7 覆盖。
- [x] **TRACE-008** 不使用 Whale Radar：Phase 0/1/11 扫描覆盖。
- [ ] **TRACE-009** 先验证再上线：Phase 3/9/10/11 门槛覆盖。
- [x] **TRACE-010** 不签名、不广播：Phase 0/1/7/8/11 持续验证。

---

## 16. 推荐的实际开工顺序

在没有新增用户输入时，可以立即按以下顺序开始；这些任务均不需要钱包私钥、Robinhood 细节或付费新闻源。

- [x] **START-001** 完成 P0 决策记录、字段字典、状态机表和 fixture 规范。
- [x] **START-002** 初始化 TypeScript/Python workspace 与质量门禁。
- [x] **START-003** 实现 `Knowledge<T>`、DecimalString、EvidenceRef 和核心 schemas。
- [x] **START-004** 实现 append-only ledger、Parquet raw store 和配置 readback。
- [ ] **START-005** 接入 BTC/ETH/SOL/VIRTUAL 参考市场流与 VIRTUAL OI。
- [x] **START-006** 实现虚拟时钟和 2026-08-22 基准 fixture。
- [x] **START-007** 实现实时/回放共享特征引擎。
- [x] **START-008** 实现 Sell/Rebuy 纯决策核心并通过 fixture。
- [x] **START-009** 使用 fixtures 开发驾驶舱骨架和进度组件。
- [x] **START-010** 当前链上复核 Base 资产身份并开始只读 quote adapter。

Robinhood、绝对交易数量、外部通知和 `LIVE_READ_ONLY` actionable 状态按各自输入与验证门槛后置。
