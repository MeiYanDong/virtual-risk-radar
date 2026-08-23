# VIRTUAL 双源风险决策驾驶舱

[![CI](https://github.com/MeiYanDong/virtual-risk-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/MeiYanDong/virtual-risk-radar/actions/workflows/ci.yml)

这是一个本地优先、只读、可回放的 VIRTUAL 风险监测系统。v0.3 只有两条外部输入：

- TechFlow 免费公开 `7×24h 快讯`页面：提供全球宏观事件上下文；
- Binance Spot：提供 BTC、ETH、SOL、VIRTUAL 的 `aggTrade` 与 `bookTicker`。

系统分别展示 Sell 与 Rebuy 的四项条件进度。默认前端只用自然中文回答“现在要不要操作、满足了什么、还差什么”；原生状态、阈值、来源和证据 ID 保留在后台审计层。新闻不能单独触发卖出；正常 Sell 路径必须四项全部通过。

## 当前边界

- 输出仅为 `CEX_REFERENCE`，不代表 DEX 可成交价格或收益。
- 实际买卖前，用户在 DEX 钱包自行检查即时 quote。
- RPC、链上监听、DEX quote、钱包读取、衍生品、第二交易所、第二新闻源、付费源、签名和广播均为 `UNSUPPORTED`。
- 极端 market-only 路径仍为 `NOT_CALIBRATED`。
- 历史与实时经济证据仍为 `POSITIVE_EV_NOT_PROVEN`。
- TechFlow 是公开网页入口，不是已验证的官方 API/RSS；没有 SLA，页面结构可能变化。

v0.2 的 Base RPC/DEX quote、衍生品和多新闻源研究代码与收据暂时保留作历史证据，但不在 v0.3 composition root、默认配置、API 或 UI 中可达。相关命令统一使用 `legacy:v0.2:*` 前缀。

## 本地运行

要求 Node.js 22+、pnpm 11；完整门禁还需要 Python 3.12。

```sh
pnpm install
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'

# 终端 1：双源只读运行时与 API
pnpm start

# 终端 2：本地驾驶舱
pnpm dev:web
```

打开 <http://127.0.0.1:5173>。API 默认位于 <http://127.0.0.1:8787>。

```sh
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/state
curl --fail http://127.0.0.1:8787/api/soak/current
```

运行时会在 `data/runtime/` 保存 TechFlow cursor 与 `0600` append-only Shadow 日志。生成当前进度报告：

```sh
pnpm shadow:report:v3
# output/reports/v3-shadow-status.json
```

电脑休眠、断网或进程停止不计入连续 Shadow 时间。60 分钟与 14 天只是最低观察时长，达到后仍需复核数据质量和风险窗口，不能自动证明有效。

## 回放与质量门禁

```sh
# 2026-08-22：只用 TechFlow + Binance Spot 的 v0.3 回放
pnpm fixture:analyze:v3:2026-08-22

# 全量本地合并门禁；注意必须带 run
pnpm run ci
```

`pnpm run ci` 执行格式、lint、只读/秘密边界扫描、严格类型、schema freshness、fixture 完整性、覆盖率测试、Python 检查、依赖审计、许可证检查和生产 Web 构建。

GitHub Actions workflow 在 push 与 pull request 时运行；远端执行结果以仓库 Actions 页面为准。CD 与部署后 readback 仍为 `NOT_CONFIGURED/NOT_RUN`。

## 关键文档

- [需求与技术方案](docs/plan.md)
- [活跃任务清单](docs/todo.md)
- [v0.3 运行手册](docs/runbook-v3.md)
- [已知限制](docs/known-limitations-v3.md)
- [工程质量基线](docs/quality-baseline.md)
- [实施证据日志](docs/evidence/implementation-log.md)

页面、配置、测试、回放和 Shadow 参考都不等于真实交易回执，系统不承诺盈利。
