# v0.3 本地运行与恢复手册

## 启动与读回

```sh
pnpm start
pnpm dev:web

curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/sources
curl --fail http://127.0.0.1:8787/api/data-health
curl --fail http://127.0.0.1:8787/api/soak/current
```

健康 readback 必须显示 `externalInputCount=2`，来源只能是 `techflow-public-newsletter` 与 `binance-spot-public`。`rpc/dexQuote/walletRead/writeCapabilities` 必须为 `UNSUPPORTED`。

正常停止使用 `Ctrl-C` 或向进程发送 `SIGTERM`。运行时先停止两个 adapter，再 fsync Shadow 日志。强制退出、电脑休眠或网络中断会形成观察空窗；不能把墙上时间全部计入 Shadow。

## 持久化文件

- `data/runtime/techflow-cursor.json`：最近列表 ID、内容 hash、revision、ETag 与 Last-Modified；重启后去重。
- `data/runtime/v3-shadow-v0.3.1.jsonl`：当前 `0600` append-only 运行证据；含启动/停止、源快照、事件、gap、阶段变化和 Shadow 参考卖出。
- `data/runtime/v3-shadow.jsonl`：性能修复前的诊断证据，原样保留但不计入 v0.3.1 的 60 分钟/14 天进度。
- `output/reports/v3-shadow-status.json`：由 `pnpm shadow:report:v3`生成的可再生报告。

不要手工改写 cursor 或 journal。怀疑损坏时先停止运行、复制原文件保全证据，再用新的显式路径做恢复测试；不要删除原证据。Journal 在序号断裂或 payload hash 不匹配时 fail closed。

## TechFlow 故障

| 现象 | 系统行为 | 处理 |
|---|---|---|
| 403/429/5xx | source `ERROR`，正常新闻路径不可确认 | 保留日志，降低人工重试频率；不切隐蔽接口 |
| 登录墙 | `TECHFLOW_LOGIN_WALL` | 停止把页面当公开源，重新评审产品来源 |
| 空列表/schema 漂移 | `TECHFLOW_SCHEMA_DRIFT_OR_EMPTY_LIST` | 保存最小公开 fixture，修 parser 与回归测试后再恢复 |
| cursor 不在可见页 | `COVERAGE_GAP/DEGRADED` | 记录漏页区间；不得用旧事件冒充新鲜 |
| 304 | 视为条件请求成功 | 不产生重复事件 |

TechFlow 没有已验证 SLA、API、RSS 或再分发许可。API 只返回内部决策元数据，不提供正文导出。

## Binance Spot 故障

| 现象 | 系统行为 | 处理 |
|---|---|---|
| WebSocket 断开 | 指数退避 + jitter 重连 | 检查 reconnect 与 freshness；不启用第二交易所 |
| aggTrade ID gap | 受影响的 60 秒订单流为 `GAP/UNKNOWN` | 等 gap 离开滚动窗口；保留 gap 证据 |
| 没有 VIRTUAL 成交 | `NO_TRADES/UNKNOWN` | 不把买卖量补 0，不确认 Sell/Rebuy 订单流条件 |
| bookTicker/aggTrade 过期 | 依赖条件 `STALE` | 等待新消息，不沿用旧值 |
| 单一 symbol 异常 | 仅阻断依赖它的条件 | 不污染无关条件 |

## Shadow 与 soak

```sh
curl --fail http://127.0.0.1:8787/api/soak/current
pnpm shadow:report:v3
```

60 分钟 soak 结束后检查 TechFlow 成功率、错误分类、重复率、数据年龄和新事件接收延迟；检查 Binance 每个 symbol×stream 的消息率、aggTrade 序列完整率、gap、重连及 p50/p95/p99 延迟。达到时长后状态是 `ELAPSED_REVIEW_REQUIRED`，不是自动 PASS。

14 天 Shadow 只累计相邻 source snapshot 不超过 30 秒的观察时长。报告达到 14 天后仍需覆盖真实高波动窗口，并形成 `SUPPORTED/REFUTED/INCONCLUSIVE` 结论。

## 不可越过的停止边界

- 不向项目提供钱包、私钥、助记词或 API secret。
- 不新增 RPC、DEX quote、签名、广播或交易执行作为故障兜底。
- `SELL_READY/REBUY_READY` 只创建 Shadow 参考上下文，不是成交。
- 没有真实 DEX 成交记录时，不报告 DEX 可实现收益。
