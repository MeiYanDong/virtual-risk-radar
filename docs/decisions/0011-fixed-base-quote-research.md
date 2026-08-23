# ADR-0011：Base 报价研究使用固定数量，不要求公开钱包

- 状态：ACCEPTED
- 生效版本：0.2.0
- 确认人：用户
- 确认时间：2026-08-22
- 可逆性：REVERSIBLE

## 背景

当前目标是先证明 Base 上 VIRTUAL 的报价数据能否被稳定获取、验证和比较，而不是读取用户实际库存或生成交易。公开钱包会带来不必要的隐私暴露，且对固定数量报价没有技术必要性。

## 决策

1. Base 卖出研究固定使用 `1,000 / 5,000 / 10,000 VIRTUAL` 三档，不从钱包余额推导数量。
2. 研究结算资产固定为 Base 原生 USDC：`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`，精度 6。聚合器内部可经 WETH 路由，但最终输出统一以 USDC 表示。
3. 主数据源为 Velora `/prices` SELL 报价；独立交叉校验为 Uniswap V3 VIRTUAL/USDC 直接池 `0x529d2863a1521d0b57db028168fdE2E97120017C` 的 QuoterV2 读取。
4. 每个数量只在精确 chain/token/settlement/pool/factory/quoter 身份通过、两源新鲜且有效价偏差不超过 `100 bps` 时，将“报价数据交叉校验”标为 PASS。
5. 报价 TTL 为 5 秒，聚合器区块滞后上限为 2 块，研究 minimum-out buffer 为 `50 bps`。这些是数据研究边界，不是用户成本限额或交易授权。
6. Base 钱包显示为 `NOT_REQUIRED_FIXED_TEST_AMOUNTS`。只有未来需要实际库存、绝对交易数量、余额/Gas/allowance 校验或真实执行时，才需另行授权钱包读取。

## 收益、代价与风险

- 收益：不暴露公开钱包；三档数量可比较规模冲击；两个独立读取路径可发现错路由、假币、错池或过期数据。
- 代价：不能推导用户真实可卖数量，不能验证余额、Gas 和 allowance。
- 风险：固定数量可能与真实仓位差异较大；聚合器路由与单池输出不同不必然是错误；公共 RPC 可限流。
- 停止边界：`quote=PASS` 不推导 `simulation/sign/broadcast/fill=PASS`；`quoteLimitsState=UNSET` 和 `POSITIVE_EV_NOT_PROVEN` 继续阻止任何买卖结论。

## 验收与证据

- 配置 readback 必须显示 `FIXED_TEST_AMOUNTS` 和三档数量。
- API/UI 必须显示每档的身份、聚合器、独立池、偏差四个条件及差距。
- 错 chain/token/decimals/pool/factory、任一源失败、过期或超偏差都必须 fail closed。
- 所有快照追加写入本地证据日志；60 分钟浸泡门槛在报告实际时长达标前不得勾选。
