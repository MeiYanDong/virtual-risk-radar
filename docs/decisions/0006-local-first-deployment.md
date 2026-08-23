# ADR-0006：本地优先，Shadow 前重新评审部署

- 状态：ACCEPTED
- 生效版本：0.1.0
- 确认人：用户
- 确认时间：2026-08-22
- 可逆性：REVERSIBLE

## 决策

开发、fixture、replay 和初期 Shadow 采用本地运行。架构保留云采集与本地控制台的迁移边界，但在连续 14 天 Shadow 前不配置生产 CD。

本地模式不承诺 24/7；电脑休眠、网络中断和数据缺口必须可见。

## 验收与证据

对应 P0-008。CI 与 CD 分开：CI 可先运行，CD 保持 NOT_CONFIGURED。

