# ADR-0009：TypeScript 实时核心与 Python 离线研究

- 状态：ACCEPTED
- 生效版本：0.1.0
- 确认人：用户
- 确认时间：2026-08-22
- 可逆性：COSTLY

## 决策

实时采集、特征、决策、API 与 React UI 使用 TypeScript/Node.js；证据索引与配置使用 SQLite，原始高频数据使用 Parquet；Python/DuckDB 只用于离线研究。

实时和离线代码读取同一版本化 JSON Schema 与 fixture，不重复定义公式。第一版使用进程内事件流，不引入 Kafka。

## 验收与证据

对应 P0-011。跨语言 fixture 必须验证字段语义一致。

