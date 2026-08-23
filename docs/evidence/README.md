# 完成证据规则

每条证据记录绑定一个或多个 todo ID，并至少包含：

- evidence level；
- 变更文件；
- 执行命令；
- 退出码与关键业务断言；
- CI/CD 和 runtime 状态；
- 未闭环问题。

代码存在只能标 REPOSITORY_RECORD；本地测试通过标 TESTED；远程 Actions 或运行服务必须单独记录。汇总项、TRACE 和 DOD 不能替代底层任务证据。

