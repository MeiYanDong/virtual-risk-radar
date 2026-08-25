# v0.3 数据源登记与失败语义

机器记录：`config/source-registry.json`  
当前版本：2.0.0  
当前范围：恰好两条免费、公开、只读输入

## TechFlow 7×24h

- Source ID：`techflow-public-newsletter`
- 入口：`https://www.techflowpost.com/newsletter`
- 方式：`PUBLIC_WEBPAGE`，无登录、无 cookie、无私有接口
- 成本：`FREE`
- 官方 API / RSS：`NOT_VERIFIED`
- SLA：`NONE`
- 再分发许可：`NOT_VERIFIED`
- 活跃范围：仅最新快讯列表及决策所需最小字段；不抓文章、研究、活动或 sitemap
- 初始轮询：10 秒；服务端返回 ETag/Last-Modified 时使用条件请求；距最后成功语义解析超过 30 秒即为 `STALE`
- 本地审计：功能启用后实际观察到的独立列表项及 revision 保存 180 天；仅含规范化元数据、链接、判断和最多 600 字摘要

HTTP 403/429/5xx、登录墙、空列表、时间失败与 schema 漂移都进入显式 source error。fetch 或 body 超过 8 秒会显式 timeout，后续轮询继续。系统不会转用隐藏接口或其他新闻源，也不会把旧列表继续标成新鲜。`/api/news/audit` 返回必要摘要与判断，但不保存或再分发完整正文；停机和 coverage gap 不会被伪装成完整历史。

## Binance Spot

- Source ID：`binance-spot-public`
- 入口：`wss://data-stream.binance.vision/stream`（Binance 官方纯市场数据端点，不含用户数据流）
- 资产：`BTCUSDT/ETHUSDT/SOLUSDT/VIRTUALUSDT`
- 流：每个 symbol 的 `aggTrade` 与 `bookTicker`
- 成本/认证：`FREE/NONE`
- taker side：`aggTrade.m=true` 表示 buyer 是 maker，因此主动方为 SELL；`false` 为主动 BUY

重复与乱序消息被丢弃；aggTrade ID 缜密性无法证明时写 coverage gap。gap 只让与它重叠的 60 秒 VIRTUAL 订单流条件变成 `UNKNOWN`，离开滚动窗口后不再永久阻断，但历史 gap 计数和证据保留。任何 stream 超过 freshness 阈值只阻断依赖条件，不使用第二交易所或旧值兜底。

Binance 官方 Spot WebSocket 说明：<https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams>

## 明确禁止的活动来源

`RPC / CHAIN_MONITORING / DEX_QUOTE / WALLET_READ / DERIVATIVES / SECOND_EXCHANGE / SECOND_NEWS_SOURCE / PAID_SOURCE`

任何新增来源必须单独做产品决策，并在历史事件与留出样本中证明增量信息价值；不能因当前源失败而自动启用。

## 证据等级

- registry 中 `TESTED`：fixture 和本地 adapter 测试通过；
- runtime health 中 `VERIFIED_CURRENT`：本进程至少完成过一次语义有效的当前读取；
- HTTP 200 或 WebSocket open 本身不能推出语义可用；
- 当前 readback 不能推出长期 SLA。

v0.2 的 futures/RPC/DEX 来源只存在于 `legacy-v0.2-*` 配置、测试和历史证据中，不是本 registry 的活动成员。
