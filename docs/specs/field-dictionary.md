# 决策字段字典

状态：`ACCEPTED`  
机器校验：`docs/specs/generated/*.schema.json`

本字典只列进入证据、特征、进度、报价和决策的字段。每个字段必须满足：必要、无歧义、可获取、可复核；不满足时删除或保持 `Knowledge=UNKNOWN`，不得猜值。

## 通用类型

| 字段/类型 | 定义 | 来源 | 单位 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `Timestamp` | canonical UTC RFC3339，必须以 `Z` 结尾 | 来源/系统时钟 | UTC | 可见性、freshness、延迟 | 非法即拒绝 |
| `DecimalString` | canonical base-10 任意精度十进制字符串 | 原始字符串/Decimal 算法 | 字段声明 | 资金与阈值 | 非法即拒绝 |
| `Knowledge<T>` | `KNOWN/UNKNOWN/UNSUPPORTED/ERROR` 判别联合 | adapter/算法 | — | 防止缺失值伪装 | 必须显式状态 |
| `evidenceIds` | 支持该值的不可变观察/事件 ID | append-only ledger | ID list | 追溯 | 决策值不得无证据 |
| `schemaVersion` | 字段契约版本 | 代码 | semver | 兼容性 | 必填 |

## NewsObservation

| 字段 | 定义 | 来源 | 单位/类型 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `observationId` | 本系统稳定观察 ID | 规范化器 | string | 去重/证据 | 必填 |
| `sourceId/sourceItemId` | 来源与来源内 ID | 来源 | string | 去重/offset | 无原生 ID 时用 URL+hash |
| `sourceUrl` | 可复核原始入口 | 来源 | URL | 人工核验 | 必填；不可访问不等于事实删除 |
| `sourceTier` | T0 官方、T1 综合、T2 加密媒体、T3 社交、T4 社区 | registry | enum | 来源规则 | 未登记拒绝进入实时 adapter |
| `headline/language` | 保存的短标题及语言 | 来源 | string | 展示/聚类辅助 | 不保存正文时仍保留 hash+URL |
| `revision` | 来源观察的追加修订序号 | adapter | integer | 撤稿/更正 | 不覆盖旧 revision |
| `ingestionMethod` | live、历史 fixture 或人工 reference | 系统 | enum | 证据等级 | 必填 |
| `sourceOccurredAt` | 来源声称发布时间 | 来源 | `Knowledge<Timestamp>` | 首发/延迟 | 不可确定则 UNKNOWN |
| `receivedAt/accessedAt` | 系统可见时间/本次核验时间 | 系统 | Timestamp | 回放边界/审计 | received 必填 |
| `rawTextHash` | 已保存文本的 SHA-256 | 规范化器 | hash | 内容去重 | 不得用翻译覆盖原 hash |
| `claimFingerprint` | 实体+规范化主张+时间窗指纹 | 规则/异步辅助 | Knowledge<string> | 聚类 | 失败仍保存原观察 |
| `credibilityState` | verified/corroborated/unverified/disputed/unknown | 规则+证据 | enum | 事实置信 | 转发量不能提高 |
| `entities` | 国家、机构、链、协议、资产等 | 规则/异步辅助 | list | 范围判断 | 解析失败为空并保留 evidence |

## NewsEventCluster

| 字段 | 定义 | 来源 | 单位/类型 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `clusterId/revision` | 事件聚类稳定 ID 与追加修订 | clusterer | string/int | 风险窗口/去重 | 必填 |
| `claimFingerprint/eventType` | 规范化主张指纹与事件类型 | clusterer | string/enum | 聚类、风险范围 | 未知类型显式为 `UNKNOWN` |
| `factConfidence` | 主张真实性；与严重度分离 | 独立/官方来源规则 | enum | 新闻警戒资格 | UNKNOWN 不等于低严重度 |
| `marketSeverity` | 若属实对广泛市场的潜在严重度 | 规则/审核 | enum | risk context | 不编造时为 UNKNOWN |
| `attentionState` | 传播热度 | 观察数量/传播层级 | enum | UI/异步优先级 | 不能替代 fact confidence |
| `firstReceivedAt/lastUpdatedAt` | 系统第一次知道与最近追加时间 | observations | Timestamp | 可见性/窗口 | 必填 |
| `officialConfirmationAt` | 官方确认在本系统中首次可见的时间 | T0 observation | Knowledge<Timestamp> | 事实置信 | 无官方源则 UNKNOWN |
| `sourceIds/independentSourceCount` | 成员来源及彼此独立的来源数 | registry/clusterer | list/int | fact confidence | 转述不计入独立来源 |
| `amplificationCount` | 同一主张的重复传播节点数 | clusterer | int | attention only | 不得提高 fact confidence |
| `observationIds/evidenceIds` | 成员与支持证据 | observations/ledger | list | 审计 | 至少一个 observation |

## V3NewsAuditRecord

| 字段 | 定义 | 来源 | 单位/类型 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `recordId/recordHash` | 新闻 ID、revision 与内容 hash 派生的稳定记录 ID，以及 item+judgment 的 canonical SHA-256 | audit journal | string/hash | 幂等、防篡改 | 必填；同 ID 不同 hash 拒绝 |
| `item` | 当次完整规范化 TechFlow 新闻；摘要最多 600 字 | TechFlow adapter | `V3NewsItem` | 展示、核对、重启恢复 | 不保存完整正文；schema 不符拒绝 |
| `judgment.outcome` | `ENTERED_RISK_OBSERVATION/NOT_TRIGGERED/REVIEW_REQUIRED` 三选一 | deterministic gate | enum | 新闻观察门禁 | 不得为空或多结果 |
| `judgment.checks` | 宏观相关、风险方向、影响程度、观察窗口四项固定顺序判断 | deterministic gate | length=4 | 中文解释与 Sell 新闻条件一致性 | 每项必须有 state/current/reason |
| `judgedAt` | 首次收到该 revision 时的冻结判断时间 | 系统时钟 | Timestamp | 防未来函数、retention | 不得在重启时重算覆盖 |
| `observationWindowEndsAt` | 来源发生与系统接收两种时限中较早的截止时间 | gate | Timestamp/null | 时效解释 | 来源时间未知时为 null 并复核 |
| `ruleVersion/modelVersion/configVersion` | 当次判断使用的规则、模型和配置 | code/config | string | 回放和变更审计 | 必填；新版本不能覆盖旧记录 |

## MarketObservation

| 字段 | 定义 | 来源 | 单位/类型 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `observationId/sourceId/instrumentId` | 稳定观察、来源和规范化交易对 | adapter | string | 去重/跨源对齐 | 必填 |
| `asset/quoteAsset` | BTC/ETH/SOL/VIRTUAL 与报价资产 | identity registry | enum/string | 特征路由与量纲 | 映射不明则拒绝 |
| `venueType` | SPOT/FUTURES/DEX/OTHER | adapter | enum | 防止市场属性混用 | 必填 |
| `marketRole` | PRICE_REFERENCE 或 ORDER_FLOW_REFERENCE | adapter | enum | 防止 CEX 参考价冒充 DEX 执行价 | 必填 |
| `observationKind` | TRADE/AGGREGATE_TRADE/KLINE_CLOSE/BEST_BID_ASK | adapter | enum | 可见边界与公式路由 | 必填 |
| `eventTime` | 成交/行情事件时间 | 来源 | Timestamp | 窗口 | 必填 |
| `receivedAt` | 本地收到时间 | 系统 | Timestamp | 回放可见性/延迟 | 必填 |
| `price` | 成交或已声明的行情价 | 来源 | DecimalString，quote/base | 收益/低点 | 缺失拒绝记录 |
| `quantity` | 原始 base 数量 | 来源 | Knowledge<DecimalString> | 名义金额/覆盖 | 缺失仅能进价格特征 |
| `takerSide` | BUY/SELL/UNKNOWN；Binance `m=true` 映射 SELL | adapter | enum | 订单流 | 未知不计主动流 |
| `sequence` | 来源序号 | 来源/adapter | Knowledge<string> | gap/排序 | 无序号用稳定去重键并声明 |
| `evidenceIds/schemaVersion` | 不可变输入引用与契约版本 | ledger/code | list/string | 追溯/兼容 | 必填 |

## DerivativeObservation

| 字段 | 定义 | 单位 | 决策用途 | 缺失规则 |
|---|---|---|---|---|
| `openInterestContracts` | 未平仓合约数量；首选去杠杆量纲 | contracts | OI baseline/flush | 缺失阻止 B2 |
| `openInterestUsd` | OI 按当时价格换算金额 | USD | 辅助展示 | 不得替代 contracts |
| `takerBuySellRatio` | 衍生品统计周期主动买/卖量比 | ratio | 交叉检查 | 与成交级 60s ratio 分名 |
| `liquidationUsd` | 覆盖期内可靠强平名义金额 | USD | soft/context | 无可靠流则 UNSUPPORTED |
| `fundingRate` | 资金费率 | decimal rate | 慢变量/辅助 | 不进秒级卖出 gate |
| `observedAt/receivedAt` | 来源统计时点/系统可见时点 | UTC | freshness/回放 | OI 超过 6 分钟为 stale |

## FeatureSnapshot

| 字段 | 定义/窗口 | 来源 | 单位 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `snapshotId/asOf` | canonical 输入哈希和决策时点 | feature core | ID/UTC | 稳定重放 | 必填 |
| `model/formula/parameterVersion` | 模型、公式和参数版本 | config/code | string | 复现 | 必填 |
| `return60s` | `price(t)/price(t-60s)-1` | 市场观察 | ratio | S1/B4 | 任一边界缺失为 UNKNOWN |
| `maxDrawdown60s` | 窗口运行高点到后续价的最小回撤 | 市场观察 | ratio | 展示/研究 | 无窗口值 UNKNOWN |
| `robustSigma60s` | 60s 收益历史的 `1.4826*MAD` | 历史窗口 | ratio | 混合阈值 | warm-up 不足 UNKNOWN |
| `virtualTakerBuy/SellNotional60s` | `Σ(price×quantity)`，按 taker side 分组 | VIRTUAL futures aggTrade | USDT | S2/B3 解释 | 无合格成交 UNKNOWN |
| `virtualTakerBuySellRatio60s` | buy/max(sell, epsilon) | 上述两项 | ratio | S2/B3 | 双方 0 为 UNKNOWN |
| `virtualNetTakerFlow60s` | buy-sell | 上述两项 | USDT | 趋势/解释 | 输入缺失 UNKNOWN |
| `virtualOrderFlowZScore60s` | 与历史同口径净流基线 z-score | 历史窗口 | sigma | soft | 样本<20 或 std=0 UNKNOWN |
| `virtualExcessReturn60s` | VIRTUAL 减参考市场候选收益 | returns | ratio | SOFT/EXPERIMENTAL | 不进 hard gate |
| 三个 persistence seconds | 连续卖压/恢复/稳定真实经过时间 | 在线 tracker | seconds | S2/B3/B4 | gap/stale/反向立即重置 |
| `marketShockBreadth` | BTC/ETH/SOL 达严格阈值数量，不含 VIRTUAL | returns/config | 0..3 | market-only arm | 任一必要收益 UNKNOWN |
| `broadMarketVolumeAnomaly` | 当前 60s 名义量/历史基线 | 市场观察 | ratio | market-only arm | baseline/warm-up 缺失 UNKNOWN |
| `riskArmedAt` | 本事件首次系统警戒时间 | state ledger | Knowledge<Timestamp> | OI baseline | 未 arm 为 UNKNOWN |
| `oiBaselineContracts` | risk arm 前最后一个新鲜已接收 OI | derivative observations | contracts | B2 | 不得使用 arm 后高点 |
| `oiContractsChangeFromBaselinePct` | `(current-baseline)/baseline` | OI | ratio | B2 | baseline/current stale 则 UNKNOWN |
| `eventRunningLow/secondsSinceLastEventLow` | 截至 asOf 的运行低点及持续时间 | 在线 tracker | price/seconds | B1 | 新低立即重置 |
| `newsRiskContext/permanentDamage` | 风险警戒与永久损伤审核状态 | clusters/audit | enum | S0/veto | 永久损伤 UNKNOWN 阻止买回 |
| `sourceCoverage/freshnessByFeature` | 组件覆盖与 freshness | health evaluator | map | UI/gate | 逐组件保留 |
| `dataHealth/evidenceIds` | 聚合状态及完整输入引用 | health/ledger | object/list | hard gate/追溯 | future/gap/essential stale 为 BLOCKED |

## ChainProfile / WalletProfile / ChainQuote

| 字段 | 定义 | 来源 | 单位 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `chainProfileId/networkScope/chainId` | 版本化网络身份 | 用户+官方/RPC | ID | 隔离故障域 | 不确认则 identity UNKNOWN |
| token/settlement address + decimals | 精确资产身份 | 合约/RPC | address/int | 金额/路由 | 任一不一致 BLOCKED_IDENTITY |
| wallet profile/address/account key | 只读钱包身份 | 用户 | public address | 库存/预算 | 不允许私钥字段 |
| `quoteId/side/amountIn` | 指定链、方向和数量的报价 | DEX adapter | ID/Decimal | 行动证据 | 页面价不可替代 |
| `expectedOut/minimumOut` | 预期与保护后最小输出 | route quote | Decimal | 成本/保护 | 缺失 QUOTE_PENDING |
| `priceImpactBps/totalCostPct/routeFees/gas` | 可量化成本 | quote/simulation | bps/rate/token | cost gate | 用户限制 UNSET 则 BLOCKED_COST |
| `effectivePrice/routeId/blockNumber` | 扣成本价格、路由与区块 | adapter | Decimal/ID | 复盘/重报 | 必填 |
| `observedAt/expiresAt` | 报价有效窗口 | adapter | UTC | freshness | 过期 BLOCKED_DATA |
| simulation/identity/route/wallet states | 独立可执行证据 | RPC/adapter | enum | chain hard gates | 失败按具体类别阻止 |

## BaseQuoteResearchSnapshot / QuoteProviderObservation

| 字段 | 定义 | 来源 | 单位 | 决策用途 | 缺失规则 |
|---|---|---|---|---|---|
| `purpose` | 快照用途固定为 `RESEARCH_ONLY` | adapter | enum | 防止报价被误解为交易授权 | 非该值拒绝 |
| `fixedAmountsVirtual` | 预注册的卖出研究数量 | ADR-0011/config | VIRTUAL | 规模冲击比较 | 不从钱包补值；当前必须为 1000/5000/10000 |
| `walletState` | 固定数量研究不需要钱包 | ADR-0011 | enum | 隐私/产品边界 | 只允许 `NOT_REQUIRED_FIXED_TEST_AMOUNTS` |
| token/settlement addresses | VIRTUAL 与 Base 原生 USDC 精确身份 | RPC/config | address | identity hard gate | 错地址、chain、code、decimals 任一项阻止整个快照 |
| `providerId/providerKind` | Velora 聚合器或 Uniswap V3 独立池 | adapter | ID/enum | 来源隔离 | 不可把两者当同一证据 |
| `amountIn/expectedOut/researchMinimumOut` | 原始输入、预期 USDC 输出和 50 bps 研究 buffer 后输出 | provider/config | DecimalString | 报价展示/对比 | amount/token 回读不一致时 ERROR |
| `effectivePrice/relativeSizeImpactBps` | 每 VIRTUAL 的 USDC 输出及相对 1000 档的规模影响 | adapter | USDC/VIRTUAL, bps | 规模流动性研究 | 基准档缺失则 impact UNKNOWN |
| `protocolFeeBps/estimatedGasUsd/totalCostPct` | 可直接证明的协议费、Gas 与总成本 | provider/ABI | Knowledge<DecimalString> | 成本 gate | 不可由非分项 USD 参考值猜 total cost；无证据必须 UNKNOWN |
| `blockNumber/blockLag/observedAt/expiresAt` | 报价区块、滞后、本地观测和失效时间 | RPC/provider/clock | block/UTC | freshness gate | 超 2 块或 5 秒过期为 STALE |
| `crossSourceDeviationBps/crossCheckState` | 聚合器与独立池有效价偏差与交叉检查状态 | quote orchestrator | bps/enum | 数据质量 gate | 任一源缺失为 UNKNOWN；过期为 STALE；超 100 bps 为 FAIL |
| `quoteLimitsState/economicEvidence` | 用户成本限额与经济证据 | config/validation | enum | 交易停止边界 | 当前分别为 `UNSET` / `POSITIVE_EV_NOT_PROVEN`，不得由 quote PASS 改写 |

## ConditionEvaluation / DecisionSnapshot

| 字段 | 定义 | 决策用途 | 缺失规则 |
|---|---|---|---|
| `rawValue/operator/targetValue/gapToTarget` | 当前、方向、目标和精确差距 | 展示“还差什么” | 输入未知则 gap UNKNOWN |
| `normalizedProgress` | 0..1 条件完成度，不是概率 | 进度条 | UNKNOWN/STALE 不返回 0 |
| `state` | PASS/FAIL/UNKNOWN/STALE/VETO | 状态机 | 互斥 |
| `conditions` | Sell 四项或 Rebuy 五项 | `passed/required` | 分母固定，不含 hard gates |
| `hardGates` | data/permanent damage/economics 等 | 不可被正条件抵消 | 独立显示 |
| `chainExecutability` | 每条链独立行动状态 | Base/Robinhood 隔离 | 不合并 |
| `recommendedAction/fraction` | NO_ACTION、WATCH、Shadow 档位等 | 人工决策 | EV 未证明最多 Shadow |
| `absoluteAmount` | 绝对数量建议 | 当前禁止 | tactical sleeve/wallet 未知时 UNKNOWN |
| `economicEvidence` | 正期望证据状态 | 全局 action gate | 初始 `POSITIVE_EV_NOT_PROVEN` |

## EvidenceRef / LedgerEvent

| 字段 | 定义 | 来源 | 决策用途 | 缺失规则 |
|---|---|---|---|---|
| `evidenceId/kind/sourceId` | 证据稳定 ID、种类与产生来源 | capture/store | 可复核性与路由 | 必填 |
| `observedAt/blockOrSequence` | 当前观测时间及可选的区块/序号 | source/clock | 新鲜度与定位 | observedAt 必填；来源无序号时可缺 |
| `freshness/payloadHash/redactedRef` | 新鲜度、payload 哈希与可选脱敏定位 | evaluator/store | 过期 gate/防篡改/人工核验 | freshness 与 hash 必填；脱敏定位可缺 |
| `evidenceLevel` | `PLANNED/REPOSITORY_RECORD/TESTED/HISTORICAL_REFERENCE/HISTORICAL_RECEIPT/VERIFIED_CURRENT/UNKNOWN` | evaluator | 防止不同证据等级互相推导 | 作为 ledger/capability 字段时必填 |
| `eventId/parentEventId/eventType` | append-only 事件身份、修订父链与类型 | ledger | 去重/更正/时间线 | 父 ID 可选，但指定时必须已存在 |
| `ingestionSequence` | 连续正整数，相同时间的最终稳定顺序 | event bus/ledger | 确定性回放 | 重复或跳号拒绝 |
| `source/schemaVersion` | 产生组件与 payload 契约版本 | producer | 审计/兼容 | 必填 |
| `eventTime/observedAt` | 事件发生时间与本系统可见时间 | source/system | 无未来函数 | `eventTime > observedAt` 拒绝 |
| `payloadHash/payload` | canonical payload 哈希与当时内容 | producer | 防篡改/回放 | 必填；修正必须追加新事件 |

## 覆盖规则

- 上表中的分组字段对应机器契约中的每个具体键；最终字段集以 `docs/specs/generated/*.schema.json` 为准。
- 新增任何进入条件、hard gate、quote、decision 或 ledger 的字段时，必须同时更新本字典与 JSON Schema；`pnpm schema:check` 阻止未同步生成物。
