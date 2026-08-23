import {
  BASE_USDC_ADDRESS,
  BASE_VIRTUAL_ADDRESS,
  BaseQuoteResearchService,
  type BaseQuoteResearchSettings,
  type ChainTransportAdapter,
  type ReadOnlyRpcMethod,
} from "@virtual/chain";
import { timestamp } from "@virtual/domain";
import { encodeFunctionResult, getAddress, parseUnits, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const NOW = timestamp("2026-08-22T12:00:00.000Z");
const POOL_ADDRESS = getAddress("0x529d2863a1521d0b57db028168fde2e97120017c");
const FACTORY_ADDRESS = getAddress("0x33128a8fc17869897dce68ed026d694621f6fdfd");
const QUOTER_ADDRESS = getAddress("0x3d4e44eb1374240ce5f1b871ab261cd16335b76a");

const TOKEN_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const POOL_ABI = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "fee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const settings: BaseQuoteResearchSettings = {
  fixedSellAmountsVirtual: ["1000", "5000", "10000"],
  settlementAssetAddress: BASE_USDC_ADDRESS,
  researchSlippageBps: "50",
  maximumCrossSourceDeviationBps: "100",
  quoteExpirySeconds: 5,
  maximumBlockLag: 2,
  aggregatorProviderId: "velora-prices-v6.2",
  canonicalPoolProviderId: "uniswap-v3-direct-pool",
  canonicalPoolAddress: POOL_ADDRESS,
  canonicalPoolFee: 3000,
  canonicalPoolFactoryAddress: FACTORY_ADDRESS,
  canonicalQuoterAddress: QUOTER_ADDRESS,
};

const canonicalOutputs = new Map([
  [parseUnits("1000", 18).toString(), 700_000_000n],
  [parseUnits("5000", 18).toString(), 3_480_000_000n],
  [parseUnits("10000", 18).toString(), 6_900_000_000n],
]);

class QuoteTransport implements ChainTransportAdapter {
  readonly adapterId = "quote-fixture";
  readonly #virtualDecimals: number;
  readonly #chainIdHex: Hex;
  readonly #poolToken1: Address;

  constructor(input: { virtualDecimals?: number; chainIdHex?: Hex; poolToken1?: Address } = {}) {
    this.#virtualDecimals = input.virtualDecimals ?? 18;
    this.#chainIdHex = input.chainIdHex ?? "0x2105";
    this.#poolToken1 = input.poolToken1 ?? BASE_USDC_ADDRESS;
  }

  async health() {
    return { chainId: "8453", latestBlock: "123", latencyMs: 1, observedAt: NOW };
  }

  async call(_method: ReadOnlyRpcMethod, _params: unknown[]): Promise<unknown> {
    throw new Error("The quote service must use bounded batch reads when available");
  }

  async batchCall(
    calls: ReadonlyArray<{ method: ReadOnlyRpcMethod; params: unknown[] }>,
  ): Promise<unknown[]> {
    return calls.map(({ method, params }) => this.#result(method, params));
  }

  #result(method: ReadOnlyRpcMethod, params: unknown[]): unknown {
    if (method === "eth_chainId") return this.#chainIdHex;
    if (method === "eth_blockNumber") return "0x7b";
    if (method === "eth_getCode") return "0x6000";
    if (method !== "eth_call") throw new Error(`Unexpected method ${method}`);
    const call = params[0] as { to: Address; data: Hex };
    const selector = call.data.slice(0, 10);
    if (selector === "0x313ce567") {
      const result =
        call.to.toLowerCase() === BASE_VIRTUAL_ADDRESS.toLowerCase() ? this.#virtualDecimals : 6;
      return encodeFunctionResult({ abi: TOKEN_ABI, functionName: "decimals", result });
    }
    if (selector === "0x95d89b41") {
      const result =
        call.to.toLowerCase() === BASE_VIRTUAL_ADDRESS.toLowerCase() ? "VIRTUAL" : "USDC";
      return encodeFunctionResult({ abi: TOKEN_ABI, functionName: "symbol", result });
    }
    if (selector === "0x0dfe1681") {
      return encodeFunctionResult({
        abi: POOL_ABI,
        functionName: "token0",
        result: BASE_VIRTUAL_ADDRESS,
      });
    }
    if (selector === "0xd21220a7") {
      return encodeFunctionResult({
        abi: POOL_ABI,
        functionName: "token1",
        result: this.#poolToken1,
      });
    }
    if (selector === "0xddca3f43") {
      return encodeFunctionResult({ abi: POOL_ABI, functionName: "fee", result: 3000 });
    }
    if (selector === "0xc45a0155") {
      return encodeFunctionResult({
        abi: POOL_ABI,
        functionName: "factory",
        result: FACTORY_ADDRESS,
      });
    }
    if (selector === "0xc6a5026a") {
      const amountIn = BigInt(`0x${call.data.slice(10 + 64 * 2, 10 + 64 * 3)}`).toString();
      const amountOut = canonicalOutputs.get(amountIn);
      if (amountOut === undefined) throw new Error(`Unexpected quote amount ${amountIn}`);
      return encodeFunctionResult({
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        result: [amountOut, 0n, 0, 100_000n],
      });
    }
    throw new Error(`Unexpected call selector ${selector}`);
  }
}

function aggregatorFetch(
  input: {
    blockNumber?: number;
    status?: number;
    outputs?: ReadonlyMap<string, bigint>;
    poolAddresses?: string[];
  } = {},
): typeof fetch {
  const outputs =
    input.outputs ??
    new Map([
      [parseUnits("1000", 18).toString(), 701_000_000n],
      [parseUnits("5000", 18).toString(), 3_490_000_000n],
      [parseUnits("10000", 18).toString(), 6_950_000_000n],
    ]);
  return (async (request: string | URL | Request) => {
    if (input.status !== undefined) return new Response("unavailable", { status: input.status });
    const url = new URL(request instanceof Request ? request.url : request);
    const srcAmount = url.searchParams.get("amount");
    if (srcAmount === null) throw new Error("Fixture received no amount");
    const destAmount = outputs.get(srcAmount);
    if (destAmount === undefined) throw new Error(`Unexpected aggregator amount ${srcAmount}`);
    return Response.json({
      priceRoute: {
        blockNumber: input.blockNumber ?? 122,
        srcToken: BASE_VIRTUAL_ADDRESS,
        srcDecimals: 18,
        srcAmount,
        destToken: BASE_USDC_ADDRESS,
        destDecimals: 6,
        destAmount: destAmount.toString(),
        srcUSD: "1",
        destUSD: "1",
        gasCostUSD: "0.01",
        side: "SELL",
        network: 8453,
        version: "6.2",
        bestRoute: [
          {
            swaps: [
              {
                swapExchanges: [
                  {
                    exchange: "uniswapv3",
                    poolAddresses: input.poolAddresses ?? [POOL_ADDRESS],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  }) as typeof fetch;
}

function service(
  input: {
    transport?: ChainTransportAdapter;
    fetchImplementation?: typeof fetch;
    settingsOverride?: Partial<BaseQuoteResearchSettings>;
  } = {},
): BaseQuoteResearchService {
  return new BaseQuoteResearchService({
    settings: { ...settings, ...input.settingsOverride },
    transport: input.transport ?? new QuoteTransport(),
    fetchImplementation: input.fetchImplementation ?? aggregatorFetch(),
  });
}

describe("Base fixed-size quote research", () => {
  it("cross-checks all three fixed sell amounts without requiring a wallet", async () => {
    const snapshot = await service().snapshot();
    expect(snapshot).toMatchObject({
      purpose: "RESEARCH_ONLY",
      quoteState: "PASS",
      identityState: "PASS",
      fixedAmountsVirtual: ["1000", "5000", "10000"],
      walletState: "NOT_REQUIRED_FIXED_TEST_AMOUNTS",
      quoteLimitsState: "UNSET",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
    });
    expect(snapshot.scenarios.map(({ crossCheckState }) => crossCheckState)).toEqual([
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(snapshot.scenarios[0]?.canonicalPool).toMatchObject({
      state: "KNOWN",
      value: { expectedOut: "700", protocolFeeBps: { state: "KNOWN", value: "30" } },
    });
  });

  it("rejects the entire snapshot when exact token identity is wrong", async () => {
    await expect(
      service({ transport: new QuoteTransport({ virtualDecimals: 6 }) }).snapshot(),
    ).rejects.toThrow("virtual_decimals_mismatch");
  });

  it("rejects wrong chain, settlement address, and pool token even when metadata could match", async () => {
    await expect(
      service({ transport: new QuoteTransport({ chainIdHex: "0x1" }) }).snapshot(),
    ).rejects.toThrow("chain_id_mismatch");
    await expect(
      service({
        settingsOverride: {
          settlementAssetAddress: "0x1111111111111111111111111111111111111111",
        },
      }).snapshot(),
    ).rejects.toThrow("native Base USDC");
    await expect(
      service({
        transport: new QuoteTransport({
          poolToken1: "0x2222222222222222222222222222222222222222",
        }),
      }).snapshot(),
    ).rejects.toThrow("pool_token_pair_mismatch");
  });

  it("keeps decimal scaling exact and exposes increasing direct-pool size impact", async () => {
    const snapshot = await service().snapshot();
    expect(
      snapshot.scenarios.map(({ canonicalPool }) =>
        canonicalPool.state === "KNOWN" ? canonicalPool.value.expectedOut : canonicalPool.state,
      ),
    ).toEqual(["700", "3480", "6900"]);
    const impacts = snapshot.scenarios.map(({ canonicalPool }) => {
      if (
        canonicalPool.state !== "KNOWN" ||
        canonicalPool.value.relativeSizeImpactBps.state !== "KNOWN"
      ) {
        throw new Error("Expected known direct-pool size impact");
      }
      return Number(canonicalPool.value.relativeSizeImpactBps.value);
    });
    expect(impacts[0]).toBe(0);
    expect(impacts[1]).toBeGreaterThan(impacts[0] ?? 0);
    expect(impacts[2]).toBeGreaterThan(impacts[1] ?? 0);
  });

  it("keeps canonical evidence but marks the cross-check unknown when the aggregator fails", async () => {
    const snapshot = await service({
      fetchImplementation: aggregatorFetch({ status: 503 }),
    }).snapshot();
    expect(snapshot.quoteState).toBe("PARTIAL");
    expect(snapshot.scenarios[0]).toMatchObject({
      aggregator: { state: "ERROR", retryable: true },
      canonicalPool: { state: "KNOWN" },
      crossCheckState: "UNKNOWN",
    });
  });

  it("keeps core quote evidence while filtering non-address route metadata", async () => {
    const snapshot = await service({
      fetchImplementation: aggregatorFetch({
        poolAddresses: [POOL_ADDRESS, "provider-specific-pool-identifier"],
      }),
    }).snapshot();
    const aggregator = snapshot.scenarios[0]?.aggregator;
    expect(aggregator?.state).toBe("KNOWN");
    if (aggregator?.state !== "KNOWN") throw new Error("Expected a known aggregator quote");
    expect(aggregator.value.poolAddresses).toEqual([POOL_ADDRESS]);
    expect(
      aggregator.value.evidenceIds.some((evidenceId) =>
        evidenceId.startsWith("velora-route-metadata-filtered-"),
      ),
    ).toBe(true);
  });

  it("marks independent data stale when the aggregator exceeds the block-lag boundary", async () => {
    const snapshot = await service({
      fetchImplementation: aggregatorFetch({ blockNumber: 110 }),
    }).snapshot();
    expect(snapshot.quoteState).toBe("PARTIAL");
    expect(snapshot.scenarios.every(({ crossCheckState }) => crossCheckState === "STALE")).toBe(
      true,
    );
  });

  it("fails the research cross-check when provider deviation exceeds the configured boundary", async () => {
    const outputs = new Map([
      [parseUnits("1000", 18).toString(), 800_000_000n],
      [parseUnits("5000", 18).toString(), 4_000_000_000n],
      [parseUnits("10000", 18).toString(), 8_000_000_000n],
    ]);
    const snapshot = await service({
      fetchImplementation: aggregatorFetch({ outputs }),
    }).snapshot();
    expect(snapshot.quoteState).toBe("PARTIAL");
    expect(snapshot.scenarios.every(({ crossCheckState }) => crossCheckState === "FAIL")).toBe(
      true,
    );
  });
});
