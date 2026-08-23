# Base VIRTUAL 固定数量报价研究证据

日期：2026-08-22  
证据等级：`VERIFIED_CURRENT` 当时读回 + `TESTED` 错误路径  
权限：`RESEARCH_ONLY / LIVE_READ_ONLY`

## 用户确认的边界

- 固定卖出测试量：`1,000 / 5,000 / 10,000 VIRTUAL`。
- 不提供、不读取、不公开 Base 钱包地址。
- 最终结算资产：Base 原生 USDC。
- 主路径：Velora `/prices` SELL；独立校验：Uniswap V3 VIRTUAL/USDC 直接池 QuoterV2。
- 报价通过不代表用户成本上限、正 EV、模拟、签名、广播或成交通过。

决策原文见 `docs/decisions/0011-fixed-base-quote-research.md`。

## 身份与路由绑定

| 项目 | 当时核验值 |
|---|---|
| Chain | Base mainnet / chain ID `8453` |
| VIRTUAL | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b`, 18 decimals, symbol VIRTUAL |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals, symbol USDC |
| Uniswap V3 pool | `0x529d2863a1521d0b57db028168fdE2E97120017C` |
| Pool fee | `3000` hundredths of a basis point = `30 bps` |
| Uniswap V3 factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |

来源：[Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)、[Velora price API](https://developers.velora.xyz/api/get-rate-for-a-token-pair)、[Uniswap SDK address source](https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts)、[Base RPC documentation](https://docs.base.org/base-chain/api-reference/rpc-overview)。

## 当前链上读回

执行：

```sh
BASE_RPC_URL=https://base-rpc.publicnode.com pnpm legacy:v0.2:quote:verify:base
```

2026-08-22T12:20:42Z–12:20:44Z 的读回：

| 固定输入 | Velora expected USDC | Uniswap V3 expected USDC | 有效价偏差 | 状态 |
|---:|---:|---:|---:|---|
| 1,000 VIRTUAL | 687.702722 | 683.891613 | 55.7268 bps | PASS |
| 5,000 VIRTUAL | 3,438.547061 | 3,416.413505 | 64.7859 bps | PASS |
| 10,000 VIRTUAL | 6,876.889276 | 6,825.230839 | 75.6875 bps | PASS |

当时三档均在 5 秒 TTL 和 2 块滞后边界内，偏差均低于 100 bps 研究门槛。这些数字是当时快照，不是当前价格承诺。

2026-08-22T12:36:53Z 后的本地 API 再次读回三档 PASS，例如三档偏差为 `18.9243 / 26.5516 / 36.9856 bps`；API 同时回读：

```text
walletState=NOT_REQUIRED_FIXED_TEST_AMOUNTS
quoteLimitsState=UNSET
economicEvidence=POSITIVE_EV_NOT_PROVEN
writeCapabilities=UNSUPPORTED
```

## 失败语义与公共 RPC 限制

- Base 官方公共/Flashblocks 端点在本轮密集验证中返回 `HTTP 429` 或 JSON-RPC `-32016 over rate limit`。程序会分批、限次重试并保留 ERROR/PARTIAL，不把失败伪装成旧报价。
- 完整 PASS 收据使用 PublicNode 的公开 Base 只读 RPC；该端点可由仓库外 `BASE_RPC_URL` 替换。[PublicNode Base endpoint](https://base-rpc.publicnode.com/)。
- 精确身份错误会阻止整个快照；单报价源错误只降级该源和交叉校验；超过 TTL/区块滞后为 STALE；超 100 bps 为 FAIL。

## 测试与运行时验收

- `tests/unit/base-quote-research.test.ts`：三档 PASS、错 decimals 硬阻断、聚合器失败 PARTIAL、区块滞后 STALE、超偏差 FAIL。
- `tests/unit/chain-adapters.test.ts`：RPC 只读 allowlist、batch 顺序、限次限流重试与方法拒绝。
- `tests/unit/quote-journal.test.ts`：快照 schema、`0600` 日志、并发去重、成功/错误统计和失败不入账。
- `tests/integration/server.test.ts`：当前 quote 作为 `Knowledge` 返回，未配置与错误不伪造 KNOWN，Base 钱包不再被要求。
- 真实桌面与 390px 移动端浏览器 QA 通过；移动端 `scrollWidth=clientWidth=390`，三档报价与 12 个进度条存在。截图保存在本地 `output/playwright/desktop.png` 与 `output/playwright/mobile.png`。

## 浸泡状态

- 5 秒烟雾浸泡：2/2 快照成功，6/6 场景交叉校验 PASS，`minimumSixtyMinutesSatisfied=false`。
- 旧解析器的首次长跑在 115 条快照后主动中止：它暴露了 Velora 可选 `poolAddresses` 有时包含非 EVM 地址标识。这份日志保存为 bug evidence，不计入 60 分钟验收。
- 修复后仍对 chain/token/decimals/side/amount/output/block 保持硬校验；非地址路由标识只会被过滤并记录为 `velora-route-metadata-filtered-*` 哈希 evidence。当前链读回已实际命中该分支且三档均 PASS。
- 最终版 60 分钟浸泡：`COMPLETED_WITH_EVIDENCE`。

| 指标 | 收据 |
|---|---:|
| 实际时长 | 3,600.001 秒 |
| 时长门槛 | `minimumSixtyMinutesSatisfied=true` |
| 尝试 / 成功快照 | 308 / 304（98.70%） |
| PASS / PARTIAL / BLOCKED 快照 | 301 / 3 / 0 |
| 档位双源 PASS | 909/912（99.67%） |
| Uniswap 直接池 KNOWN | 912/912 |
| 延迟 p50 / p95 / p99 | 1.385 / 2.217 / 3.640 秒 |
| 公共 RPC 整快照失败 | 4 |
| Velora 单档降级 | 3（2 次 `fetch failed`，1 次 timeout） |
| STALE / 偏差 FAIL | 0 / 0 |
| 命中非地址路由标签过滤的快照 | 30 |
| 已知双源偏差范围 | 0.5054–79.9759 bps |

报告与 304 条原始 JSONL 已重算一致，文件权限均为 `0600`。数据也暴露了一个生产风险：无密钥公共 RPC 和单聚合器不应作为未来连续监控的单点。

## 不能由本证据推导的结论

- 不能证明应该卖出或买回 VIRTUAL。
- 不能证明使用者有足够的 VIRTUAL、USDC 或 Gas。
- 不能证明 total cost、round-trip EV、模拟或真实成交。
- 不能回填 2026-08-22 历史事件中当时未记录的 DEX 报价。
