# VIRTUAL 双源风险决策驾驶舱

[![CI](https://github.com/MeiYanDong/virtual-risk-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/MeiYanDong/virtual-risk-radar/actions/workflows/ci.yml)

这是一个本地可回放、云端持续运行、全程只读的 VIRTUAL 风险监测系统。v0.3 只有两条外部输入：

- TechFlow 免费公开 `7×24h 快讯`页面：提供全球宏观事件上下文；
- Binance Spot：提供 BTC、ETH、SOL、VIRTUAL 的 `aggTrade` 与 `bookTicker`。

系统分别展示 Sell 与 Rebuy 的四项条件进度。默认前端只用自然中文回答“现在要不要操作、满足了什么、还差什么”；原生状态、阈值、来源和证据 ID 保留在后台审计层。新闻不能单独触发卖出；正常 Sell 路径必须四项全部通过。

首页的“查看全部新闻判断”进入独立 `/news` 审计页。该页面展示功能启用后程序实际观察到的每条 TechFlow 独立快讯，包括被判定为“未进入风险观察”的新闻，并给出四步中文判断、必要摘要和官网核对链接。它不会声称补齐停机期间或公开列表之外从未看到的新闻。

## 当前边界

- 输出仅为 `CEX_REFERENCE`，不代表 DEX 可成交价格或收益。
- 实际买卖前，用户在 DEX 钱包自行检查即时 quote。
- RPC、链上监听、DEX quote、钱包读取、衍生品、第二交易所、第二新闻源、付费源、签名和广播均为 `UNSUPPORTED`。
- 极端 market-only 路径仍为 `NOT_CALIBRATED`。
- 历史与实时经济证据仍为 `POSITIVE_EV_NOT_PROVEN`。
- TechFlow 是公开网页入口，不是已验证的官方 API/RSS；没有 SLA，页面结构可能变化。
- TechFlow 距最后一次成功语义解析超过 30 秒即显示延迟并使依赖条件降级；审计记录仅在本地私有保存 180 天。

## 云端运行

2026-08-25 已部署到本项目独占的阿里云美国西海岸 SWAS：`virtual-risk-radar-us-west`，公网 IP `47.251.165.112`。当前入口：

- 驾驶舱：<http://47.251.165.112/>
- 逐条新闻审计：<http://47.251.165.112/news>
- 只读健康检查：<http://47.251.165.112/api/health>

生产 API 只监听 `127.0.0.1:8787`，由 Nginx 对外提供静态网页和只读 `GET /api/*`。服务使用独立无登录权限用户、systemd 自动重启、只读发布目录和仓库外 `0700/0600` 数据目录；SSH 已禁用 root、密码和键盘交互登录。当前为手工校验和发布，不是自动 CD。域名、TLS 和异机备份尚未配置，因此暂时只有 HTTP；不要在该站点提交任何敏感信息。

购买与部署证据见 [SWAS 购买回执](docs/evidence/2026-08-25-swas-purchase.md)和 [SWAS 部署回执](docs/evidence/2026-08-25-swas-deployment.md)。

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

打开 <http://127.0.0.1:5173>；逐条新闻审计位于 <http://127.0.0.1:5173/news>。API 默认位于 <http://127.0.0.1:8787>。

```sh
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/state
curl --fail http://127.0.0.1:8787/api/soak/current
curl --fail 'http://127.0.0.1:8787/api/news/audit?limit=10'
```

运行时会在 `data/runtime/` 保存 `0600` 的 TechFlow cursor、append-only Shadow journal 和新闻审计 journal。新闻审计只保存规范化元数据、链接、最多 600 字摘要、不可覆盖判断与 revision，不保存完整正文；整个 `data/` 目录由 Git 排除。生成当前进度报告：

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

GitHub Actions workflow 在 push 与 pull request 时运行；远端执行结果以仓库 Actions 页面为准。生产制品由已通过门禁的 clean commit 构建，执行 SHA-256 校验、原子切换、健康检查和失败回滚；发布仍由人工触发，自动 CD 为 `NOT_CONFIGURED`。当前部署后 API、双源、持久化重启和真实浏览器 readback 已运行并通过，详见部署回执。

## 关键文档

- [需求与技术方案](docs/plan.md)
- [活跃任务清单](docs/todo.md)
- [v0.3 运行手册](docs/runbook-v3.md)
- [已知限制](docs/known-limitations-v3.md)
- [工程质量基线](docs/quality-baseline.md)
- [实施证据日志](docs/evidence/implementation-log.md)

页面、配置、测试、回放和 Shadow 参考都不等于真实交易回执，系统不承诺盈利。
