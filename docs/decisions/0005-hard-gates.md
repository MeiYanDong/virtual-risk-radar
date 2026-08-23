# ADR-0005：资产、数据、报价、永久损伤与经济证据使用硬门槛

- 状态：ACCEPTED
- 生效版本：0.1.0
- 确认人：用户
- 确认时间：2026-08-22
- 可逆性：COSTLY

## 决策

关键数据健康、chain/token identity、指定数量 DEX quote、永久损伤和经济行动证据是 correctness invariant 或显式 blocking gate，不进入加权平均。

UNKNOWN 不得由默认值、超时或总分抵消。故障只隔离最小受影响链或 capability。

## 验收与证据

对应 P0-007、P0-054。边界测试必须证明任何硬门槛 FAIL/UNKNOWN 都不能得到 actionable。

