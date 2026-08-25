# 完成证据规则

每条证据记录绑定一个或多个 todo ID，并至少包含：

- evidence level；
- 变更文件；
- 执行命令；
- 退出码与关键业务断言；
- CI/CD 和 runtime 状态；
- 未闭环问题。

代码存在只能标 REPOSITORY_RECORD；本地测试通过标 TESTED；远程 Actions 或运行服务必须单独记录。汇总项、TRACE 和 DOD 不能替代底层任务证据。

## 当前新闻审计批次收据

- 实现、命令、当前进程读回与未闭环边界：`docs/evidence/implementation-log.md` Batch 9。
- 桌面视觉收据：`output/playwright/v3-news-audit-desktop.png`。
- 390×844 手机收据：`output/playwright/v3-news-audit-mobile.png`、`output/playwright/v3-news-audit-mobile-expanded.png`。
- 当前本地门禁为 `PASS_LOCAL`；新闻审计变更尚未 commit/push，因此旧 GitHub Actions run 不作为本批次远端证据。

## 当前云资源回执

- [2026-08-25 阿里云 SWAS 购买回执](2026-08-25-swas-purchase.md)：独立美国西海岸实例已购买并由控制面验证；状态严格保持 `SERVER_PURCHASED / APPLICATION_NOT_DEPLOYED`。
