# 模型、时间、缺失与跨链测试矩阵

状态：`ACCEPTED`  
用途：完成 `P0-060`–`P0-067` 的测试规范；本文的 `TESTED/PARTIAL/PLANNED` 不代替 `docs/todo.md` 的实现验收。

## 稳定模型场景 ID

| ID | 场景 | 必要断言 | 当前证据 |
|---|---|---|---|
| TM-MOD-001 | 正常平静市场 | Sell/Rebuy 都不越权行动 | TESTED |
| TM-MOD-002 | 负面新闻但市场无下跌 | 最多 `NEWS_ARMED`，不卖 | TESTED |
| TM-MOD-003 | 无新闻但市场同步暴跌 | 可 `MARKET_ARMED`，仍需订单流/DEX gate | TESTED |
| TM-MOD-004 | VIRTUAL 独跌 | 不满足不含 VIRTUAL 的 market breadth | TESTED |
| TM-MOD-005 | BTC 下跌但 VIRTUAL 抗跌 | 不进入卖出确认 | PLANNED |
| TM-MOD-006 | 跨资产冲击与 VIRTUAL 订单流冲突 | 最多预触发 | TESTED |
| TM-MOD-007 | 瞬时尖刺后立即恢复 | 持续时间重置，不越级 | PARTIAL |
| TM-MOD-008 | 持续恶化 | 持续条件累积并仅经合法转换 | TESTED |
| TM-MOD-009 | OI 不下降 | Rebuy OI 条件 FAIL | TESTED |
| TM-MOD-010 | OI 下降但仍创新低 | 无新低重置，不买回 | TESTED |
| TM-MOD-011 | 无新低后再破低 | running-low 计时归零 | TESTED |
| TM-MOD-012 | 订单流恢复但 DEX 报价恶化 | 仅对应链 blocked，不买回 | PARTIAL |
| TM-MOD-013 | Base 可执行、Robinhood 不可执行 | 信号共享、行动隔离 | TESTED |
| TM-MOD-014 | Robinhood 可执行、Base 不可执行 | 反向隔离一致 | TESTED |
| TM-MOD-015 | 永久损伤 FAIL | Rebuy 硬 veto | TESTED |
| TM-MOD-016 | 永久损伤 UNKNOWN | Rebuy 硬阻止 | TESTED |
| TM-MOD-017 | 新闻重复与来源时间冲突 | 去重，attention 与 fact 分离 | PARTIAL |
| TM-MOD-018 | 数据缺失/过期/乱序/补洞失败 | 组件 UNKNOWN/STALE/BLOCKED，不填 0 | PARTIAL |
| TM-MOD-019 | 极端离群值 | Decimal 公式可定义，不溢出/静默转 float | TESTED |
| TM-MOD-020 | 阈值边界 | 刚低于/等于/刚高于按 operator 一致 | PARTIAL |
| TM-MOD-021 | 系统时钟漂移 | data health BLOCKED，不输出 actionable | TESTED |
| TM-NEWS-AUDIT-001 | 普通新闻被过滤 | 仍写入审计并显示“未进入风险观察”及具体理由 | TESTED |
| TM-NEWS-AUDIT-002 | 相关但方向/影响不明 | 显示“需要人工复核”，不得强行归入负面或普通新闻 | TESTED |
| TM-NEWS-AUDIT-003 | 四项新闻 gate 全通过 | 仅进入风险观察，仍不能单独产生减仓 | TESTED |
| TM-NEWS-AUDIT-004 | 重复、内容 revision、重启 | 重复不增行，revision 不覆盖，180 天内重启可查 | TESTED |
| TM-NEWS-AUDIT-005 | 30 秒无成功解析或 fetch 悬挂 | source 失效并阻断依赖条件，显式截止后继续轮询 | TESTED |
| TM-NEWS-AUDIT-006 | 客户端审计页 | 桌面/390×844、键盘、筛选/搜索/详情/外链可用且不显示原生字段 | TESTED |

## 统一阈值边界模板

每个 `LTE/GTE/duration` 条件最少使用三个用例：

| ID 后缀 | 输入 | 期望 |
|---|---|---|
| `-BELOW` | target 减去 schema 允许的最小单位 | 按 operator 映射 PASS/FAIL |
| `-EQUAL` | 精确 target | 包含边界，progress=1 |
| `-ABOVE` | target 加上 schema 允许的最小单位 | 按 operator 映射 PASS/FAIL |

阈值族稳定 ID：`TM-BND-SELL-RETURN-*`、`TM-BND-SELL-FLOW-*`、`TM-BND-REBUY-LOW-*`、`TM-BND-REBUY-OI-*`、`TM-BND-REBUY-FLOW-*`、`TM-BND-REBUY-STABILITY-*`、`TM-BND-QUOTE-EXPIRY-*`。

## 缺失与 freshness 模板

每个进入 condition/hard gate 的字段使用以下互斥用例：

- `TM-KNW-<FIELD>-KNOWN-ZERO`：证明真实 0 参与公式。
- `TM-KNW-<FIELD>-UNKNOWN`：无数值进度，不是 FAIL 或 0%。
- `TM-KNW-<FIELD>-UNSUPPORTED`：能力不存在，不自动重试或降级成 0。
- `TM-KNW-<FIELD>-ERROR`：保留 retryable 和脱敏原因。
- `TM-KNW-<FIELD>-STALE`：保留最后值/观测时间，阻止需要新鲜值的动作。

## 时间模型

| ID | 路径 | 关键断言 |
|---|---|---|
| TM-TIME-001 | 稳定 | stage 与 entered-at 不漂移 |
| TM-TIME-002 | 快速恶化 | 连续条件按真实 elapsed time 累积 |
| TM-TIME-003 | 快速改善 | 反向/过期立即重置 persistence |
| TM-TIME-004 | V 型反转 | 不因一秒恢复越级到 Rebuy action |
| TM-TIME-005 | 再创新低 | `secondsSinceLastEventLow=0` 并回到等待 |

## 跨链隔离模型

- `TM-CHAIN-001`：Base quote PASS / Robinhood UNKNOWN。
- `TM-CHAIN-002`：Base UNKNOWN / Robinhood quote PASS。
- `TM-CHAIN-003`：Base timeout / Robinhood success，并发结果不互相取代。
- `TM-CHAIN-004`：两链同 symbol 但 identity 不同，不允许跨链 quote 或 balance 复用。

## 2026-08-22 fixture 与无未来函数

规范和原始清单见 `docs/specs/fixture-2026-08-22.md`。稳定用例：

- `TM-FIX-001`：11:43:45 仅 news arm。
- `TM-FIX-002`：13:05:01 旧预触发断言必须失败，13:05:06.999 才首次通过。
- `TM-FIX-003`：13:07:13 旧确认断言必须失败，13:07:16.999 才首次通过。
- `TM-FIX-004`：running low 只使用虚拟时钟当时已见值。
- `TM-FIX-005`：OI baseline 只能使用 risk-arm 前最后已接收快照；后续高点基线必须被拒绝。
- `TM-FIX-006`：Base/Robinhood DEX quote `UNKNOWN:not_recorded`，无 Shadow fill/收益。
- `TM-FIX-007`：无 sell fact 时 Rebuy inactive，即使 3/5 市场恢复条件可见也 `NO_ACTION`。

审计方法：事件仅在 `receivedAt <= replayClock.now` 时可见；回放 manifest 绑定输入/config/model hash；同一输入三次字节一致。

## 失败分类

| ID | 类别 | 含义 |
|---|---|---|
| TM-FAIL-FIELD | field | 缺字段、单位或时间 |
| TM-FAIL-DEFINITION | definition | 指标语义不唯一 |
| TM-FAIL-FUNCTION | function | 公式错误 |
| TM-FAIL-MAPPING | mapping | 供应商字段/交易方向/资产映射错误 |
| TM-FAIL-GATE | gate | 硬门槛未阻止动作 |
| TM-FAIL-DATA | data | gap、stale、future、duplicate 或 corruption |
| TM-FAIL-IMPLEMENTATION | implementation | 代码/配置/接线与契约不一致 |
