# 贡献与质量门禁

## 开发原则

1. 先写可证伪的业务结果，再写实现。
2. 所有资金、数量和价格使用 DecimalString，不使用浮点数。
3. KNOWN(0)、UNKNOWN、UNSUPPORTED、ERROR 和 STALE 不得混淆。
4. 新增状态必须通过 exhaustive switch，并补齐正常、边界、缺失、冲突与过期测试。
5. 配置存在不证明已接线；测试必须覆盖真实调用点。
6. 只读版本不得新增签名、授权或广播路径。
7. 不为目录完整度创建无调用方的抽象。

## 合并门禁

本地和 CI 必须使用同一个命令：

    pnpm run ci

它包含格式检查、lint、只读边界扫描、TypeScript 类型检查、全部测试、Python 检查和 Web 构建。

任务只有在命令结果和业务断言均有证据时才能在 docs/todo.md 勾选。失败、未运行、远程未验证必须明确记录。

## 提交信息

使用简短、祈使式、带范围的提交信息：

    feat(domain): add explicit knowledge states
    test(replay): block future observations
    docs(adr): freeze read-only capability boundary
    chore(ci): add shared quality gate

一次提交只承载一个可复核结果。不要把格式化整个仓库与业务修改混在同一提交中。

## Pull Request

PR 描述必须包含：

- 对应 todo ID；
- 用户可见或业务结果；
- 变更文件；
- 执行命令与结果；
- 风险与降级；
- CI 状态；
- 未闭环问题。
