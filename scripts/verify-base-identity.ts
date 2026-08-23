import { readErc20Identity, ReadOnlyJsonRpcTransport, verifyErc20Identity } from "@virtual/chain";

const VIRTUAL_ADDRESS = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const endpoint = process.env["BASE_RPC_URL"] ?? "https://mainnet.base.org";
const transport = new ReadOnlyJsonRpcTransport({
  adapterId: "base-public-read-only-v1",
  endpoint,
});
const evidence = await readErc20Identity({ transport, tokenAddress: VIRTUAL_ADDRESS });
const verification = verifyErc20Identity(evidence, {
  chainId: "8453",
  tokenAddress: VIRTUAL_ADDRESS,
  decimals: 18,
  symbol: "VIRTUAL",
});

console.log(
  JSON.stringify(
    {
      evidenceLevel: "VERIFIED_CURRENT",
      capability: "IDENTITY_READ_ONLY",
      evidence,
      verification,
      limitations: [
        "Public Base endpoint is rate-limited and not a production provider",
        "This proves token identity fields, not DEX route liquidity or quote executability",
        "No wallet, signer, transaction preparation, or broadcast method is used",
      ],
    },
    null,
    2,
  ),
);

if (verification.state !== "PASS") process.exitCode = 1;
