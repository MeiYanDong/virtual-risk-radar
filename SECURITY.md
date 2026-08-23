# 安全策略

v0.3 当前只接受 TechFlow 公开新闻页与 Binance Spot 公共市场数据。RPC、链状态、DEX quote、钱包读取和所有写入能力均退出活动范围。

禁止提交：

- 私钥、助记词、keystore、签名材料；
- API token、带凭证 URL 或生产 secret；
- 自动 approve、sign、broadcast、sendRawTransaction 或交易执行入口；
- RPC、链上监听、DEX quote、钱包读取、衍生品或第二数据源作为隐式故障兜底；
- 将人工标记、RPC ACK、模拟结果或页面状态表述为成交回执。

发现秘密或潜在写链路径时，立即停止新的可行动建议，保留证据并按最小范围隔离。不要在 Issue、日志或测试 fixture 中粘贴秘密。
