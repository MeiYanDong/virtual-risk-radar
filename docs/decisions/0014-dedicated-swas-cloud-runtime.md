# ADR-0014：项目独占 SWAS 云端运行

- 状态：ACCEPTED
- 生效版本：0.3.5
- 确认人：用户
- 确认时间：2026-08-25
- 可逆性：REVERSIBLE
- 取代：ADR-0006 的生产运行选择；本地开发与回放能力不变

## 背景

本地进程会因电脑休眠、断网和开发重启形成观测空窗。旧服务器同时运行 LetsCash 等项目，共用会扩大故障域和资源争用。用户明确要求使用美国西海岸、56 元/月的项目独占实例，并确认按推荐安全方案部署。

## 决策

生产 runtime 运行在独占阿里云 SWAS `virtual-risk-radar-us-west`，本地继续负责开发、fixture、replay 和发布制品生成。

首个云端版本保持最少必要链路：Nginx 静态网页与只读 API、单个 Node runtime、TechFlow 免费网页和 Binance Spot 纯市场数据 WebSocket。不得因云端部署增加 RPC、钱包、DEX quote、第二新闻/交易所、签名或广播。

发布必须来自 clean、远端 CI 通过的 commit，制品执行 allowlist、SHA-256、原子切换、健康失败回滚；应用以独立用户和只读发布目录运行，持久数据在仓库外。当前人工发布被接受，自动 CD 不是本 ADR 的完成条件。

## 代价与风险

- 每月 56 元且自动续费关闭，需要到期前人工续费或迁移。
- 当前公网只有 HTTP，没有域名/TLS；没有异机备份和外部告警。
- 单机故障会产生观测空窗，未备份数据可能丢失。
- 云端运行不自动证明 60 分钟 soak、14 天 Shadow、模型准确率或正期望。

## 验收与证据

- 购买回执：`docs/evidence/2026-08-25-swas-purchase.md`
- 部署回执：`docs/evidence/2026-08-25-swas-deployment.md`
- 当前公网 readback：TechFlow/Binance `HEALTHY`，写入/RPC/DEX quote/钱包能力 `UNSUPPORTED`
- 当前生产提交：`d372bd51106177eccf94b6972e8b35c1f2fb9e0e`；GitHub Actions run 32801242516 `PASS`
- 未完成门禁继续保留在 `V3-H011`、`P10-003`、`P10-021`—`P10-024` 与 Phase 10 soak/Shadow 任务中
