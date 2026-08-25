# 2026-08-25 阿里云 SWAS 购买回执

## 结论

证据等级：`CLOUD_CONTROL_PLANE_VERIFIED`。

用户确认不与旧服务器上的 LetsCash 等项目共用主机，并要求为本项目购买美国西海岸、56 元/月的独立服务器。2026-08-25 已完成购买和控制面验收；本回执只证明云资源存在，不代表应用、CD、域名、TLS、备份或 24/7 Shadow 已部署完成。

## 订单与实例

| 字段 | 控制面读回 |
|---|---|
| 产品 | 阿里云轻量应用服务器（SWAS） |
| 地区 | 美国西海岸 `us-west-1` |
| 实例名称 | `virtual-risk-radar-us-west` |
| 实例 ID | `3927c29de1de42b489f9b889d71b25cd` |
| 公网 IP | `47.251.165.112` |
| 镜像 | Ubuntu 24.04 |
| 套餐 | `swas.s.c2m2s40b1.linux` |
| 配置 | 2 vCPU、2 GiB、40 GiB ESSD、200 Mbps、1 个公网 IPv4 |
| 购买数量/周期 | 1 台 / 1 个月 |
| 询价与成交边界 | `56.00 CNY`；无优惠、无附加数据盘 |
| 自动续费 | 创建请求明确设置为 `false` |
| 到期时间 | `2026-09-25T16:00:00Z` |
| 当前实例状态 | `Running`，`BusinessStatus=Normal` |

购买请求使用固定 `us-west-1` endpoint、region 和 biz region，创建后再次读回 `RegionId=us-west-1` 与公网 IP，避免受本机默认香港 endpoint 影响。

## 初始安全与运行读回

- Cloud Assistant：`Status=true`。
- 默认公网防火墙：TCP 22、80、443 以及 ICMP；来源均为 `0.0.0.0/0`。
- 没有额外数据盘。
- 本次没有安装应用、同步仓库、上传秘密、设置钱包、增加自定义端口或启动 VIRTUAL runtime。
- 本次没有配置登录密码、SSH key、DNS、TLS、Nginx、systemd、日志保留或备份。

因此当前状态必须写作：

```text
SERVER_PURCHASED / APPLICATION_NOT_DEPLOYED / CD_NOT_CONFIGURED / RUNTIME_READBACK_NOT_RUN
```

## 后续门禁

部署前仍需完成 `P10-003`—`P10-005`：最小权限与网络评审、仓库外配置边界、日志/备份、发布版本和配置 hash。默认开放的 SSH 不等于已经建立可审计的生产访问方式；应用部署后还必须分别验证 API、网页、TechFlow、Binance、持久化恢复和服务重启行为。
