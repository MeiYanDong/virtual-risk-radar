# 2026-08-25 阿里云 SWAS 部署回执

## 结论

证据等级：`CLOUD_RUNTIME_VERIFIED_CURRENT`。

VIRTUAL 双源风险雷达已经部署到项目独占的美国西海岸 SWAS，并完成公网 API、TechFlow、Binance Spot、只读边界、systemd 重启恢复和真实浏览器读回。它仍是 `SHADOW / CEX_REFERENCE / POSITIVE_EV_NOT_PROVEN`，不连接钱包、RPC、DEX quote，也不签名或广播。

当前入口：

- 驾驶舱：<http://47.251.165.112/>
- 新闻审计：<http://47.251.165.112/news>
- 健康检查：<http://47.251.165.112/api/health>

## 目标与发布版本

| 字段 | 部署读回 |
|---|---|
| 实例 | `virtual-risk-radar-us-west` / `3927c29de1de42b489f9b889d71b25cd` |
| 地区与公网 IP | `us-west-1` / `47.251.165.112` |
| 系统与运行时 | Ubuntu 24.04；Node `22.22.3`；pnpm `11.19.0`；Nginx + systemd |
| 当前 release | `d372bd51106177eccf94b6972e8b35c1f2fb9e0e` |
| 发布制品 SHA-256 | `bc23d163550abb7afac8dae4f902e27ccecc2bf0657504bc36966e1fbdbe2034` |
| 配置版本 / API 配置 hash | `0.3.2` / `sha256:f13d55ae3e678bea9b0b7a04a1446577584703e7a5f1e6495240c4f66546b747` |
| `config/default.json` 文件 hash | `9392a08c2d5ee0004978f92debe02a3939098069718a1bfbbf4b9d97954d9dee` |
| `config/source-registry.json` 文件 hash | `0c221346ad4928bd5cd5d49c04a78a4fc20c89c6194a463f7c4ac246acf386d4` |
| 远端 CI | [GitHub Actions run 32801242516](https://github.com/MeiYanDong/virtual-risk-radar/actions/runs/32801242516)，quality `PASS` |
| 发布方式 | 人工触发、单一制品、SHA-256 校验、原子 symlink、健康失败自动回滚；自动 CD 未配置 |

发布脚本拒绝脏工作树，制品使用显式 allowlist；检查确认制品不含 `data/`、`.env`、测试、Git 元数据、SSH key 或 PEM。生产依赖在 release 目录安装，运行数据单独保存在 `/var/lib/virtual-risk-radar`。

## 安全与进程读回

- 管理入口只允许 `vrr-admin` 公钥登录；`PermitRootLogin=no`、`PasswordAuthentication=no`、`KbdInteractiveAuthentication=no`。
- 应用使用 `virtual-risk:virtual-risk`，无交互 shell；systemd 设置 `NoNewPrivileges`、空 capability bounding set、`ProtectSystem=strict`、1 GiB 内存上限和唯一可写数据根。
- `systemd-analyze security` 当前 exposure 为 `3.8 OK`。
- API 只监听 `127.0.0.1:8787`；公网只由 Nginx 监听 80。公网 `POST /api/health` 返回 `403`，未开放写 API。
- 数据目录为 `0700`，cursor、Shadow journal 和新闻审计 journal 为 `0600`；SSH 私钥位于仓库外并为 `0600`。
- 当前 release、systemd unit 与 Nginx 配置归 root 所有；服务进程没有发布目录写权限。

## 双源与页面读回

最终发布后 `/api/health` 显示 `externalInputCount=2`，active source 恰好为 TechFlow 与 Binance Spot；`writeCapabilities/rpc/dexQuote/walletRead` 均为 `UNSUPPORTED`。

- TechFlow：`HEALTHY / VERIFIED_CURRENT`，公开列表持续轮询，错误与 gap 保持可见。
- Binance Spot：`HEALTHY / VERIFIED_CURRENT`，BTC、ETH、SOL、VIRTUAL 的 `aggTrade + bookTicker` 八流均新鲜；发布后抽样时 reconnect 为 0、active gap 为 0。
- Binance 美国节点验证：交易域名 `stream.binance.com` 的 443/9443 均返回 HTTP 451；Binance 官方纯市场数据端点 `wss://data-stream.binance.vision/stream` 在同机返回 `101 Switching Protocols` 并收到成交。最终配置仍只有一个 Binance Spot 市场源，没有增加交易所或兜底链路。
- 真实 Chromium 从首页点击进入 `/news` 成功；主页面中文结论、价格与 8 条条件进度可见，新闻页显示程序实际捕获的全部新闻及过滤判断。最终两页控制台均为 0 error / 0 warning。

浏览器收据位于 `output/playwright/swas-main.png` 与 `output/playwright/swas-news.png`；它们只记录公开页面，不进入生产 release allowlist。

## 重启恢复读回

在风险观察阶段执行 `systemctl restart virtual-risk-radar`：

- 第 5 次一秒轮询时 TechFlow 与 Binance 均恢复 `HEALTHY`；service 为 `active/running`，`NRestarts=0`。
- Shadow journal 从 79 行增长到 85 行，说明停止/启动和新快照继续追加。
- 新闻审计 journal 保持 12 行，独立新闻总数重启前后均为 11，没有重复写入或丢失。
- 重启后的 runtime `startedAt=2026-08-25T02:29:19.079Z`；窗口积满前，依赖 60 秒特征的条件保持等待/未知，不沿用旧市场值。

这只证明 cursor、新闻审计和 append-only 日志的本次恢复；市场滚动窗口、未完成 gap、完整状态机上下文和 Shadow 卖出上下文尚未实现跨进程恢复，`P10-021` 继续未完成。

## 发布中发现并修复的问题

1. 首个 release `af78bdb1...` 通过依赖安装，但 systemd 的 `ProtectSystem=strict` 阻止运行时 `pnpm start` 写临时文件。健康门禁失败后安装器自动停止服务并回滚。修复提交 `9830384` 改为 Node 直接加载 `tsx`，没有放松只读文件系统。
2. 修复启动后，服务器实测 Binance 交易域名返回 451，导致页面行情为 `ERROR`。最终提交 `d372bd5` 改用 Binance 官方 market-data-only WebSocket；本地 235 个测试和远端 CI 均通过后重新发布，两源恢复 `HEALTHY`。

## 尚未闭环

- 当前只有公网 HTTP；没有域名、TLS 或 HSTS。页面不接收凭据，但传输仍未加密。
- 没有异机/对象存储备份或已验证恢复点；单机故障可能丢失 180 天审计数据。
- 没有数据源、磁盘或进程异常外部告警；当前只能通过网页/API/systemd 主动检查。
- GitHub CI 已生效，但生产发布仍是人工脚本，自动 CD 未配置。
- 60 分钟双源 soak、30 个历史事件与 14 天 Shadow 尚未完成，不能据此声称长期稳定或正期望。
- 实例自动续费关闭，到期时间为 `2026-09-25T16:00:00Z`；到期前需人工续费或迁移。
