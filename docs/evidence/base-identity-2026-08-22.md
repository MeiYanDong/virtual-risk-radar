# Base identity readback — 2026-08-22

Evidence level: `VERIFIED_CURRENT` at `2026-08-22T09:31:30.636Z`.

Command:

```sh
pnpm legacy:v0.2:chain:verify:base
```

Read-only result:

| Field | Readback |
|---|---|
| RPC chain ID | `8453` |
| Latest block | `50300871` |
| Token | `0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b` |
| Contract code | present |
| Decimals | `18` |
| Symbol | `VIRTUAL` |
| Name | `Virtual Protocol` |
| Identity verification | `PASS` |

The endpoint and chain ID are also documented by the official Base documentation:
<https://docs.base.org/base-chain/quickstart/connecting-to-base>.

This evidence proves only Base network and ERC-20 identity fields. It does not prove a liquid DEX
route, an executable quote, a wallet balance, an allowance, settlement asset identity, simulation,
or economics. The official public endpoint is rate-limited and is not a production provider.
