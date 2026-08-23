# ADR-0012：v0.3 采用最小双源只读运行时

- 状态：ACCEPTED
- 生效版本：0.3.0
- 用户确认时间：2026-08-23（Asia/Shanghai）
- 可逆性：新增数据源需重新评审；旧代码删除需在 Shadow 稳定后单独授权

## 背景

本系统的目标不是解释单一加拿大事件，而是用最少必要链路监测全球宏观冲击与 VIRTUAL 的市场反应。用户明确要求免费来源、拒绝 RPC 带来的资源与延迟成本，并在自己的 DEX 钱包中检查最终 quote。

## 决定

v0.3 的唯一 live 新闻源是 TechFlow 免费公开 `7×24h 快讯`页面；唯一市场源是 Binance Spot，资产固定为 BTC、ETH、SOL、VIRTUAL，流固定为 `aggTrade` 与 `bookTicker`。

正常 Sell 路径必须同时满足：宏观冲击、跨资产下跌、VIRTUAL 相对弱势、VIRTUAL 主动卖压。Rebuy 独立检查：无新宏观升级、跨资产无新低、VIRTUAL 相对恢复、主动卖压归一。所有结果只输出 `CEX_REFERENCE`。

RPC、链上监听、DEX quote、钱包读取、衍生品、第二交易所、第二新闻源、付费源、签名和广播退出默认配置、composition root、API 与 UI。v0.2 代码只作为历史证据保留，并使用 `legacy:v0.2:*` 命令显式调用。

## 备选方案

1. 多新闻源 + 多交易所 + RPC/DEX：覆盖更广，但链路、成本、延迟和故障面显著增加。
2. 仅 TechFlow：最简单，但无法区分“负面标题”与真实市场冲击。
3. TechFlow + Binance Spot：用两条独立证据完成最小双确认，保留明确失败语义。

选择方案 3。

## 后果与风险

- 收益：运行链路最少，免费，无钱包与写链权限，判断与证据容易审计。
- 代价：TechFlow 漏报或页面漂移时没有第二新闻源兜底；Binance 异常时没有第二市场源。
- 风险控制：任一必要数据 `UNKNOWN/STALE/GAP` 时只阻断依赖条件，不补 0、不沿用旧数据。
- 市场备用路径：`EXTREME_MARKET_BREAKDOWN` 在历史校准前固定为 `NOT_CALIBRATED`，不能绕过新闻条件成为可行动建议。
- 经济边界：30 事件与 14 天 Shadow 未完成前保持 `POSITIVE_EV_NOT_PROVEN`。
