# 时间、版本与证据契约

状态：`ACCEPTED`  
适用版本：schema `1.0.0`、model `0.1.0`

## 1. 时间语义

内部时间一律使用带 `Z` 的 RFC 3339 UTC；UI 仅在展示层转换为 `Asia/Shanghai`。没有时区的时间字符串、运行机器本地时区和隐式 DST 推断均为非法输入。

| 字段 | 唯一定义 | 决策边界 |
|---|---|---|
| `source_occurred_at` | 来源声称事件/内容发生或发布的时间；可以 `UNKNOWN` | 不代表系统当时已经知道 |
| `event_time` | 市场、链或来源系统为该观察给出的事件时间 | 只用于窗口定位，不授权提前可见 |
| `received_at` | 本系统第一次拿到该 payload 的 wall-clock 时间 | 回放可见性的第一边界 |
| `normalized_at` | 规范化记录完成时间 | 用于处理延迟，不替代 `received_at` |
| `observed_at` | 某个派生值或读回值成立的时间 | 与 `expires_at` 一起决定 freshness |
| `decided_at` / `created_at` | 决策纯函数完成并生成快照的时间 | 不得早于所有输入 `received_at` |
| `expires_at` | 值不再能支持新动作的最晚时间 | 过期后状态为 `STALE`，保留旧值 |

回放主排序：`received_at ASC → source sequence ASC → ingestion sequence ASC → stable ID ASC`。同一输入、配置、模型版本和回放时钟必须产生逐字节一致的输出。

## 2. 时钟边界

- wall clock：记录外部时间、日志和展示时间；可能跳变，因此受 drift gate 约束。
- monotonic clock：测量进程内持续时间和延迟；不可持久化为跨进程绝对时间。
- 任何 `received_at > replay_clock.now` 的记录均不可见。
- 发现未来输入时，`futureDataDetected=true` 且数据健康为 `BLOCKED`；不得静默丢弃后继续给动作。
- duration 条件从首次连续满足时的 0 秒开始；`>=3 秒` 必须真的经过至少 3,000 ms。

## 3. 稳定 ID 与哈希

- `decision_id = model + sha256(canonical({model,snapshot_id,model_version,mode,now}))[0:24]`。
- `snapshot_id = feature- + sha256(canonical(snapshot_without_id))[0:24]`。
- canonical JSON：对象键按 Unicode 字典序排序；数组保持业务顺序；Decimal 使用 canonical `DecimalString`；时间使用 UTC `Z`。
- payload checksum 使用 `sha256:<64 lowercase hex>`。
- 同一来源修订不得复用旧 event ID；revision 通过 `parent_id` 链接旧事实。

## 4. 版本字段

| 版本 | 变化时机 | 同一事件周期规则 |
|---|---|---|
| `schemaVersion` | 字段或校验契约改变 | 旧事件保持原版本，可通过显式迁移读取 |
| `modelVersion` | 状态机或行动映射改变 | 不静默切换；新版本产生独立结果 |
| `formulaVersion` | 特征公式改变 | 必须与快照一起保存 |
| `parameterVersion` | 阈值、窗口、持续时间改变 | 必须与模型输出关联 |
| `configVersion` / `configHash` | 运行配置改变 | 追加配置事件，不覆盖旧配置 |
| `adapterVersion` | 来源映射、去重或失败语义改变 | 原始 payload 保留，便于重算 |

## 5. Append-only evidence envelope

公共 envelope 为：`event_id, sequence, parent_id?, event_type, source, schema_version, event_time, observed_at, payload_hash, payload`。

规则：

- sequence 必须连续递增；
- parent 必须已存在；
- `event_time <= observed_at`；
- correction/retraction/config change/stage transition 都是新事件；
- 普通更新不能覆盖旧 payload；
- 写入失败是决策 hard gate，不允许继续产生新的可行动建议。

## 6. 证据等级

从弱到强但不可自动互相推导：

| 等级 | 含义 |
|---|---|
| `PLANNED` | 仅在计划或设计中 |
| `REPOSITORY_RECORD` | 文件/代码/配置存在 |
| `TESTED` | 指定测试在当前环境通过 |
| `HISTORICAL_REFERENCE` | 历史链接或人工整理材料，可帮助研究但不证明当时系统读到 |
| `HISTORICAL_RECEIPT` | 当前保存了带校验和的历史 API/文件回执 |
| `VERIFIED_CURRENT` | 当前进程/链/API 的实时读回证据 |
| `UNKNOWN` | 缺少足够证据或语义不能确定 |

禁止推导示例：代码存在 ≠ 配置启用；配置启用 ≠ 运行成功；历史 CEX 价格 ≠ DEX 可执行报价；Shadow 正确 ≠ 正期望；页面显示 ≠ 成交回执。

## 7. `Knowledge<T>` 互斥语义

- `KNOWN`：值、观察时间和证据均明确；可选 `expiresAt` 决定 freshness。
- `UNKNOWN`：理论上可获得但当前没有足够证据；必须有 reason 和 since。
- `UNSUPPORTED`：当前能力/适配器明确不支持；不是暂时故障。
- `ERROR`：尝试获取或计算时失败；说明是否可重试。
- `STALE` 不是第五种持久值；它是对过期 `KNOWN` 在某个决策时点的评价结果。
- `KNOWN(0)`、`UNKNOWN`、`ERROR` 和 `UNSUPPORTED` 绝不等价。

## 8. DecimalString

资金、价格、数量、Gas、费率与比例的业务算术使用 arbitrary-precision decimal；禁止 JS/Python binary float 做资金换算。canonical 格式不允许指数、前导零、尾随小数零、`-0`、`NaN` 或 `Infinity`。时间差、消息计数和展示进度可使用整数/非资金 number。
