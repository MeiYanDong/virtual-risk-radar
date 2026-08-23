# ADR-0001：第一版只提供 Replay、Shadow 与 Live Read Only

- 状态：ACCEPTED
- 生效版本：0.1.0
- 确认人：用户
- 确认时间：2026-08-22
- 可逆性：COSTLY

## 背景

当前只有单事件参考，DEX 历史可执行性与正期望尚未证明。

## 互斥方案

- 只读：资金权限最小，人工执行有延迟。
- 交易草案：减少构造时间，但扩大钱包和 calldata 风险面。
- 自动执行：延迟最低，但需要完整授权、nonce、对账、恢复和独立安全审计。

## 决策

第一版仅允许 REPLAY、SHADOW、LIVE_READ_ONLY。PREPARE_ONLY 与 AUTO_EXECUTE 是新的授权域。

sign、broadcast、approve-token 和 execute-trade 均为 UNSUPPORTED；不能通过依赖或隐藏路由隐式开启。

## 验收与证据

对应 P0-002、P0-003、P0-020 至 P0-026。静态扫描和 API 路由测试必须证明写链能力不存在。

