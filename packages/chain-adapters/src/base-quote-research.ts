import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import {
  BaseQuoteResearchSnapshotSchema,
  decimal,
  divide,
  knowledgeError,
  known,
  timestamp,
  unknown,
  type BaseQuoteResearchSnapshot,
  type Knowledge,
  type QuoteProviderObservation,
  type QuoteResearchScenario,
  type Timestamp,
} from "@virtual/domain";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddressEqual,
  isHex,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import type { ChainTransportAdapter, ReadOnlyRpcMethod } from "./transport";

const ERC20_IDENTITY_ABI = [
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

const QUOTER_V2_ABI = [
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

const veloraExchangeSchema = z
  .object({
    exchange: z.string().min(1),
    poolAddresses: z.array(z.string().min(1).max(512)).max(128).optional(),
  })
  .passthrough();

const veloraResponseSchema = z
  .object({
    priceRoute: z
      .object({
        blockNumber: z.number().int().nonnegative(),
        srcToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        srcDecimals: z.literal(18),
        srcAmount: z.string().regex(/^\d+$/),
        destToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        destDecimals: z.literal(6),
        destAmount: z.string().regex(/^\d+$/),
        srcUSD: z.string().min(1),
        destUSD: z.string().min(1),
        gasCostUSD: z.string().min(1),
        side: z.literal("SELL"),
        network: z.literal(8453),
        version: z.string().min(1),
        maxImpactReached: z.boolean().optional(),
        bestRoute: z.array(
          z
            .object({
              swaps: z.array(
                z
                  .object({
                    swapExchanges: z.array(veloraExchangeSchema),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();

export type BaseQuoteResearchSettings = {
  fixedSellAmountsVirtual: string[];
  settlementAssetAddress: string;
  researchSlippageBps: string;
  maximumCrossSourceDeviationBps: string;
  quoteExpirySeconds: number;
  maximumBlockLag: number;
  aggregatorProviderId: string;
  canonicalPoolProviderId: string;
  canonicalPoolAddress: string;
  canonicalPoolFee: number;
  canonicalPoolFactoryAddress: string;
  canonicalQuoterAddress: string;
};

export const BASE_VIRTUAL_ADDRESS = getAddress("0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b");
export const BASE_USDC_ADDRESS = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

function stableId(prefix: string, payload: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function expiresAt(observedAt: Timestamp, seconds: number): Timestamp {
  return timestamp(new Date(Date.parse(observedAt) + seconds * 1_000));
}

function researchMinimumOut(expectedOut: string, slippageBps: string): ReturnType<typeof decimal> {
  return decimal(
    new Decimal(expectedOut)
      .times(new Decimal(1).minus(new Decimal(slippageBps).dividedBy(10_000)))
      .toDecimalPlaces(6, Decimal.ROUND_DOWN),
  );
}

function effectivePrice(expectedOut: string, amountIn: string): ReturnType<typeof decimal> {
  return divide(decimal(expectedOut), decimal(amountIn));
}

function routeDetails(route: z.infer<typeof veloraResponseSchema>["priceRoute"]): {
  exchanges: string[];
  pools: Address[];
  filteredMetadataEvidenceIds: string[];
} {
  const exchanges = new Set<string>();
  const pools = new Map<string, Address>();
  const filteredMetadataEvidenceIds = new Set<string>();
  for (const branch of route.bestRoute) {
    for (const swap of branch.swaps) {
      for (const exchange of swap.swapExchanges) {
        exchanges.add(exchange.exchange);
        for (const address of exchange.poolAddresses ?? []) {
          if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
            filteredMetadataEvidenceIds.add(stableId("velora-route-metadata-filtered", address));
            continue;
          }
          const checksummed = getAddress(address.toLowerCase());
          pools.set(checksummed.toLowerCase(), checksummed);
        }
      }
    }
  }
  return {
    exchanges: [...exchanges].sort(),
    pools: [...pools.values()],
    filteredMetadataEvidenceIds: [...filteredMetadataEvidenceIds].sort(),
  };
}

function codePresent(value: unknown): boolean {
  return typeof value === "string" && value !== "0x" && !/^0x0*$/.test(value);
}

function asHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value)) {
    throw new TypeError(`${label} did not return ABI hex data`);
  }
  return value;
}

function resultAt(results: unknown[], index: number, label: string): unknown {
  if (index >= results.length) throw new Error(`Base identity batch omitted ${label}`);
  return results[index];
}

async function readCalls(
  transport: ChainTransportAdapter,
  calls: ReadonlyArray<{ method: ReadOnlyRpcMethod; params: unknown[] }>,
): Promise<unknown[]> {
  if (transport.batchCall !== undefined) return transport.batchCall(calls);
  return Promise.all(calls.map(({ method, params }) => transport.call(method, params)));
}

type VerifiedBaseQuoteIdentity = {
  chainId: "8453";
  poolAddress: Address;
  poolFactoryAddress: Address;
  poolFee: number;
  quoterAddress: Address;
  evidenceIds: string[];
};

async function verifyBaseQuoteIdentity(input: {
  transport: ChainTransportAdapter;
  settings: BaseQuoteResearchSettings;
}): Promise<VerifiedBaseQuoteIdentity> {
  const virtualAddress = BASE_VIRTUAL_ADDRESS;
  const settlementAddress = getAddress(input.settings.settlementAssetAddress);
  if (!isAddressEqual(settlementAddress, BASE_USDC_ADDRESS)) {
    throw new Error("Settlement identity does not match native Base USDC");
  }
  const poolAddress = getAddress(input.settings.canonicalPoolAddress);
  const expectedFactory = getAddress(input.settings.canonicalPoolFactoryAddress);
  const quoterAddress = getAddress(input.settings.canonicalQuoterAddress);
  const results = await readCalls(input.transport, [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
    { method: "eth_getCode", params: [virtualAddress, "latest"] },
    {
      method: "eth_call",
      params: [
        {
          to: virtualAddress,
          data: encodeFunctionData({ abi: ERC20_IDENTITY_ABI, functionName: "decimals" }),
        },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        {
          to: virtualAddress,
          data: encodeFunctionData({ abi: ERC20_IDENTITY_ABI, functionName: "symbol" }),
        },
        "latest",
      ],
    },
    { method: "eth_getCode", params: [settlementAddress, "latest"] },
    {
      method: "eth_call",
      params: [
        {
          to: settlementAddress,
          data: encodeFunctionData({ abi: ERC20_IDENTITY_ABI, functionName: "decimals" }),
        },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        {
          to: settlementAddress,
          data: encodeFunctionData({ abi: ERC20_IDENTITY_ABI, functionName: "symbol" }),
        },
        "latest",
      ],
    },
    { method: "eth_getCode", params: [poolAddress, "latest"] },
    { method: "eth_getCode", params: [quoterAddress, "latest"] },
    {
      method: "eth_call",
      params: [
        { to: poolAddress, data: encodeFunctionData({ abi: POOL_ABI, functionName: "token0" }) },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        { to: poolAddress, data: encodeFunctionData({ abi: POOL_ABI, functionName: "token1" }) },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        { to: poolAddress, data: encodeFunctionData({ abi: POOL_ABI, functionName: "fee" }) },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        { to: poolAddress, data: encodeFunctionData({ abi: POOL_ABI, functionName: "factory" }) },
        "latest",
      ],
    },
  ]);
  const chainIdHex = asHex(resultAt(results, 0, "chain id"), "chain id");
  const blockNumberHex = asHex(resultAt(results, 1, "block number"), "block number");
  const virtualCode = resultAt(results, 2, "VIRTUAL code");
  const virtualDecimals = decodeFunctionResult({
    abi: ERC20_IDENTITY_ABI,
    functionName: "decimals",
    data: asHex(resultAt(results, 3, "VIRTUAL decimals"), "VIRTUAL decimals"),
  });
  const virtualSymbol = decodeFunctionResult({
    abi: ERC20_IDENTITY_ABI,
    functionName: "symbol",
    data: asHex(resultAt(results, 4, "VIRTUAL symbol"), "VIRTUAL symbol"),
  });
  const usdcCode = resultAt(results, 5, "USDC code");
  const usdcDecimals = decodeFunctionResult({
    abi: ERC20_IDENTITY_ABI,
    functionName: "decimals",
    data: asHex(resultAt(results, 6, "USDC decimals"), "USDC decimals"),
  });
  const usdcSymbol = decodeFunctionResult({
    abi: ERC20_IDENTITY_ABI,
    functionName: "symbol",
    data: asHex(resultAt(results, 7, "USDC symbol"), "USDC symbol"),
  });
  const poolCode = resultAt(results, 8, "pool code");
  const quoterCode = resultAt(results, 9, "quoter code");
  const token0Hex = asHex(resultAt(results, 10, "pool token0"), "pool token0");
  const token1Hex = asHex(resultAt(results, 11, "pool token1"), "pool token1");
  const feeHex = asHex(resultAt(results, 12, "pool fee"), "pool fee");
  const factoryHex = asHex(resultAt(results, 13, "pool factory"), "pool factory");
  const token0 = decodeFunctionResult({ abi: POOL_ABI, functionName: "token0", data: token0Hex });
  const token1 = decodeFunctionResult({ abi: POOL_ABI, functionName: "token1", data: token1Hex });
  const fee = decodeFunctionResult({ abi: POOL_ABI, functionName: "fee", data: feeHex });
  const factory = decodeFunctionResult({
    abi: POOL_ABI,
    functionName: "factory",
    data: factoryHex,
  });
  const reasons: string[] = [];
  const chainId = BigInt(chainIdHex).toString();
  if (chainId !== "8453") reasons.push("chain_id_mismatch");
  if (!codePresent(virtualCode)) reasons.push("virtual_code_missing");
  if (virtualDecimals !== 18) reasons.push("virtual_decimals_mismatch");
  if (virtualSymbol !== "VIRTUAL") reasons.push("virtual_symbol_mismatch");
  if (!codePresent(usdcCode)) reasons.push("usdc_code_missing");
  if (usdcDecimals !== 6) reasons.push("usdc_decimals_mismatch");
  if (usdcSymbol !== "USDC") reasons.push("usdc_symbol_mismatch");
  if (!codePresent(poolCode)) reasons.push("pool_code_missing");
  if (!codePresent(quoterCode)) reasons.push("quoter_code_missing");
  const pairMatches =
    (isAddressEqual(token0, virtualAddress) && isAddressEqual(token1, settlementAddress)) ||
    (isAddressEqual(token1, virtualAddress) && isAddressEqual(token0, settlementAddress));
  if (!pairMatches) reasons.push("pool_token_pair_mismatch");
  if (fee !== input.settings.canonicalPoolFee) reasons.push("pool_fee_mismatch");
  if (!isAddressEqual(factory, expectedFactory)) reasons.push("pool_factory_mismatch");
  if (reasons.length > 0) throw new Error(`Base quote identity check failed: ${reasons.join(",")}`);
  return {
    chainId: "8453",
    poolAddress,
    poolFactoryAddress: expectedFactory,
    poolFee: fee,
    quoterAddress,
    evidenceIds: [
      `rpc:${input.transport.adapterId}:block:${BigInt(blockNumberHex).toString()}`,
      `erc20:${virtualAddress}`,
      `erc20:${settlementAddress}`,
      `uniswap-v3-pool:${poolAddress}`,
      `uniswap-v3-factory:${expectedFactory}`,
      `uniswap-quoter-v2:${quoterAddress}`,
    ],
  };
}

function errorKnowledge(
  error: unknown,
  observedAt: Timestamp,
): Knowledge<QuoteProviderObservation> {
  return knowledgeError(
    error instanceof Error ? error.message : "Quote provider failed",
    observedAt,
    true,
  );
}

export class BaseQuoteResearchService {
  readonly #settings: BaseQuoteResearchSettings;
  readonly #transport: ChainTransportAdapter;
  readonly #fetch: typeof fetch;
  readonly #veloraEndpoint: URL;
  #identityPromise: Promise<VerifiedBaseQuoteIdentity> | undefined;

  constructor(input: {
    settings: BaseQuoteResearchSettings;
    transport: ChainTransportAdapter;
    fetchImplementation?: typeof fetch;
    veloraEndpoint?: string;
  }) {
    this.#settings = input.settings;
    this.#transport = input.transport;
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#veloraEndpoint = new URL(input.veloraEndpoint ?? "https://api.paraswap.io/prices");
    if (this.#veloraEndpoint.protocol !== "https:") {
      throw new Error("Aggregator price endpoint must use HTTPS");
    }
  }

  async #identity(): Promise<VerifiedBaseQuoteIdentity> {
    this.#identityPromise ??= verifyBaseQuoteIdentity({
      transport: this.#transport,
      settings: this.#settings,
    });
    return this.#identityPromise;
  }

  async #aggregatorQuote(amountIn: string, latestBlock: bigint): Promise<QuoteProviderObservation> {
    const observedAt = timestamp(new Date());
    const amountAtomic = parseUnits(amountIn, 18).toString();
    const url = new URL(this.#veloraEndpoint);
    url.search = new URLSearchParams({
      srcToken: BASE_VIRTUAL_ADDRESS,
      srcDecimals: "18",
      destToken: BASE_USDC_ADDRESS,
      destDecimals: "6",
      amount: amountAtomic,
      side: "SELL",
      network: "8453",
      version: "6.2",
    }).toString();
    const response = await this.#fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Aggregator price endpoint returned HTTP ${response.status}`);
    const { priceRoute } = veloraResponseSchema.parse(await response.json());
    if (!isAddressEqual(getAddress(priceRoute.srcToken), BASE_VIRTUAL_ADDRESS)) {
      throw new Error("Aggregator returned the wrong source token");
    }
    if (!isAddressEqual(getAddress(priceRoute.destToken), BASE_USDC_ADDRESS)) {
      throw new Error("Aggregator returned the wrong destination token");
    }
    if (priceRoute.srcAmount !== amountAtomic) {
      throw new Error("Aggregator returned a different source amount");
    }
    if (priceRoute.maxImpactReached === true) {
      throw new Error("Aggregator reports that its maximum impact boundary was reached");
    }
    const expectedOut = decimal(formatUnits(BigInt(priceRoute.destAmount), 6));
    const details = routeDetails(priceRoute);
    const providerBlock = BigInt(priceRoute.blockNumber);
    const blockLag = Number(
      providerBlock > latestBlock ? providerBlock - latestBlock : latestBlock - providerBlock,
    );
    const expiry = expiresAt(observedAt, this.#settings.quoteExpirySeconds);
    const evidenceIds = [
      `velora-price-route:block:${priceRoute.blockNumber}`,
      ...details.pools.map((pool) => `pool:${pool}`),
      ...details.filteredMetadataEvidenceIds,
    ];
    return {
      observationId: stableId("quote-observation", {
        provider: this.#settings.aggregatorProviderId,
        amountAtomic,
        destAmount: priceRoute.destAmount,
        block: priceRoute.blockNumber,
      }),
      providerId: this.#settings.aggregatorProviderId,
      providerKind: "AGGREGATOR",
      chainProfileId: "base-mainnet-virtual-usdc-research-v1",
      side: "SELL_VIRTUAL",
      tokenInAddress: BASE_VIRTUAL_ADDRESS,
      tokenOutAddress: BASE_USDC_ADDRESS,
      amountIn: decimal(amountIn),
      expectedOut,
      researchMinimumOut: researchMinimumOut(expectedOut, this.#settings.researchSlippageBps),
      effectivePrice: effectivePrice(expectedOut, amountIn),
      priceImpactBps: unknown(
        "Aggregator price route does not provide an independently reproducible spot-price impact receipt",
        observedAt,
      ),
      relativeSizeImpactBps: unknown("Calculated after all fixed tiers are observed", observedAt),
      protocolFeeBps: unknown(
        "Aggregator route does not expose one canonical fee tier",
        observedAt,
      ),
      routeFeesSettlement: unknown(
        "Aggregator response does not itemize all route fees in settlement units",
        observedAt,
      ),
      totalCostPct: unknown(
        "Provider USD reference fields are not an itemized executable cost receipt",
        observedAt,
      ),
      estimatedGasUsd: known(decimal(priceRoute.gasCostUSD), observedAt, evidenceIds, expiry),
      routeId: `${this.#settings.aggregatorProviderId}:${details.exchanges.join("+") || "unknown-route"}`,
      poolAddresses: details.pools,
      blockNumber: providerBlock.toString(),
      blockLag,
      observedAt,
      expiresAt: expiry,
      freshnessState: blockLag <= this.#settings.maximumBlockLag ? "FRESH" : "STALE",
      evidenceIds,
    };
  }

  #canonicalObservation(
    amountIn: string,
    latestBlock: bigint,
    identity: VerifiedBaseQuoteIdentity,
    result: Hex,
  ): QuoteProviderObservation {
    const observedAt = timestamp(new Date());
    const amountAtomic = parseUnits(amountIn, 18);
    const [amountOut, _sqrtPriceAfter, _ticksCrossed, _gasEstimate] = decodeFunctionResult({
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      data: result,
    });
    if (amountOut <= 0n) throw new Error("Canonical pool quoter returned zero output");
    const expectedOut = decimal(formatUnits(amountOut, 6));
    const expiry = expiresAt(observedAt, this.#settings.quoteExpirySeconds);
    const evidenceIds = [
      ...identity.evidenceIds,
      `uniswap-v3-quote:block:${latestBlock.toString()}:amount:${amountAtomic.toString()}`,
    ];
    return {
      observationId: stableId("quote-observation", {
        provider: this.#settings.canonicalPoolProviderId,
        amountAtomic: amountAtomic.toString(),
        amountOut: amountOut.toString(),
        block: latestBlock.toString(),
      }),
      providerId: this.#settings.canonicalPoolProviderId,
      providerKind: "CANONICAL_POOL",
      chainProfileId: "base-mainnet-virtual-usdc-research-v1",
      side: "SELL_VIRTUAL",
      tokenInAddress: BASE_VIRTUAL_ADDRESS,
      tokenOutAddress: BASE_USDC_ADDRESS,
      amountIn: decimal(amountIn),
      expectedOut,
      researchMinimumOut: researchMinimumOut(expectedOut, this.#settings.researchSlippageBps),
      effectivePrice: effectivePrice(expectedOut, amountIn),
      priceImpactBps: unknown(
        "Direct quoter output has no independently sampled pre-trade pool spot reference",
        observedAt,
      ),
      relativeSizeImpactBps: unknown("Calculated after all fixed tiers are observed", observedAt),
      protocolFeeBps: known(decimal(identity.poolFee / 100), observedAt, evidenceIds, expiry),
      routeFeesSettlement: unknown(
        "Pool fee rate is known, but the quoter does not itemize an absolute settlement fee",
        observedAt,
      ),
      totalCostPct: unknown(
        "Direct quoter output does not itemize total round-trip cost",
        observedAt,
      ),
      estimatedGasUsd: unknown(
        "Quoter returns gas units, but no independently verified ETH/USD gas cost",
        observedAt,
      ),
      routeId: `${this.#settings.canonicalPoolProviderId}:${identity.poolAddress}:fee-${identity.poolFee}`,
      poolAddresses: [identity.poolAddress],
      blockNumber: latestBlock.toString(),
      blockLag: 0,
      observedAt,
      expiresAt: expiry,
      freshnessState: "FRESH",
      evidenceIds,
    };
  }

  async #canonicalQuotes(
    amountsIn: string[],
    latestBlock: bigint,
    identity: VerifiedBaseQuoteIdentity,
  ): Promise<Array<Knowledge<QuoteProviderObservation>>> {
    const startedAt = timestamp(new Date());
    const calls = amountsIn.map((amountIn) => ({
      method: "eth_call" as const,
      params: [
        {
          to: identity.quoterAddress,
          data: encodeFunctionData({
            abi: QUOTER_V2_ABI,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn: BASE_VIRTUAL_ADDRESS,
                tokenOut: BASE_USDC_ADDRESS,
                amountIn: parseUnits(amountIn, 18),
                fee: identity.poolFee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
        },
        "latest",
      ],
    }));
    try {
      const results = await readCalls(this.#transport, calls);
      return amountsIn.map((amountIn, index) => {
        const observation = this.#canonicalObservation(
          amountIn,
          latestBlock,
          identity,
          asHex(resultAt(results, index, `canonical quote ${amountIn}`), "canonical quote"),
        );
        return known(
          observation,
          observation.observedAt,
          observation.evidenceIds,
          observation.expiresAt,
        );
      });
    } catch (error) {
      return amountsIn.map(() => errorKnowledge(error, startedAt));
    }
  }

  async #safeAggregatorQuote(
    amountIn: string,
    latestBlock: bigint,
  ): Promise<Knowledge<QuoteProviderObservation>> {
    const startedAt = timestamp(new Date());
    try {
      const observation = await this.#aggregatorQuote(amountIn, latestBlock);
      return known(
        observation,
        observation.observedAt,
        observation.evidenceIds,
        observation.expiresAt,
      );
    } catch (error) {
      return errorKnowledge(error, startedAt);
    }
  }

  #addRelativeSizeImpact(
    quote: Knowledge<QuoteProviderObservation>,
    baselineEffectivePrice: Decimal | undefined,
  ): Knowledge<QuoteProviderObservation> {
    if (quote.state !== "KNOWN" || baselineEffectivePrice === undefined) return quote;
    const current = new Decimal(quote.value.effectivePrice);
    const impact = Decimal.max(
      0,
      baselineEffectivePrice.minus(current).dividedBy(baselineEffectivePrice).times(10_000),
    );
    const relativeSizeImpactBps = known(
      decimal(impact),
      quote.value.observedAt,
      quote.value.evidenceIds,
      quote.value.expiresAt,
    );
    const value = { ...quote.value, relativeSizeImpactBps };
    return known(value, quote.observedAt, quote.evidenceIds, quote.expiresAt);
  }

  async snapshot(): Promise<BaseQuoteResearchSnapshot> {
    const startedAt = timestamp(new Date());
    const identity = await this.#identity();
    const health = await this.#transport.health();
    if (health.chainId !== identity.chainId)
      throw new Error("Base RPC chain changed after identity verification");
    const latestBlock = BigInt(health.latestBlock);
    const [aggregatorQuotes, canonicalQuotes] = await Promise.all([
      Promise.all(
        this.#settings.fixedSellAmountsVirtual.map((amountIn) =>
          this.#safeAggregatorQuote(amountIn, latestBlock),
        ),
      ),
      this.#canonicalQuotes(this.#settings.fixedSellAmountsVirtual, latestBlock, identity),
    ]);
    const rawPairs = this.#settings.fixedSellAmountsVirtual.map((amountIn, index) => ({
      amountIn,
      aggregator:
        aggregatorQuotes[index] ?? unknown("Aggregator quote result was omitted", startedAt),
      canonicalPool:
        canonicalQuotes[index] ?? unknown("Canonical quote result was omitted", startedAt),
    }));
    const aggregatorBaseline =
      rawPairs[0]?.aggregator.state === "KNOWN"
        ? new Decimal(rawPairs[0].aggregator.value.effectivePrice)
        : undefined;
    const canonicalBaseline =
      rawPairs[0]?.canonicalPool.state === "KNOWN"
        ? new Decimal(rawPairs[0].canonicalPool.value.effectivePrice)
        : undefined;
    const scenarios: QuoteResearchScenario[] = rawPairs.map((pair) => {
      const aggregator = this.#addRelativeSizeImpact(pair.aggregator, aggregatorBaseline);
      const canonicalPool = this.#addRelativeSizeImpact(pair.canonicalPool, canonicalBaseline);
      let crossSourceDeviationBps: QuoteResearchScenario["crossSourceDeviationBps"] = unknown(
        "Both quote sources must be known",
        startedAt,
      );
      let crossCheckState: QuoteResearchScenario["crossCheckState"] = "UNKNOWN";
      let crossCheckReason = "One or both quote sources are unavailable";
      if (aggregator.state === "KNOWN" && canonicalPool.state === "KNOWN") {
        const crossObservedAt = timestamp(new Date());
        const crossExpiresAt = timestamp(
          new Date(
            Math.min(
              Date.parse(aggregator.value.expiresAt),
              Date.parse(canonicalPool.value.expiresAt),
            ),
          ),
        );
        const deviation = new Decimal(aggregator.value.effectivePrice)
          .minus(canonicalPool.value.effectivePrice)
          .abs()
          .dividedBy(canonicalPool.value.effectivePrice)
          .times(10_000);
        crossSourceDeviationBps = known(
          decimal(deviation),
          crossObservedAt,
          [...aggregator.value.evidenceIds, ...canonicalPool.value.evidenceIds],
          crossExpiresAt,
        );
        if (
          aggregator.value.freshnessState === "STALE" ||
          canonicalPool.value.freshnessState === "STALE"
        ) {
          crossCheckState = "STALE";
          crossCheckReason = "At least one source exceeds the block-lag freshness boundary";
        } else if (deviation.lte(this.#settings.maximumCrossSourceDeviationBps)) {
          crossCheckState = "PASS";
          crossCheckReason = "Independent outputs are within the research deviation boundary";
        } else {
          crossCheckState = "FAIL";
          crossCheckReason = "Independent outputs exceed the research deviation boundary";
        }
      }
      return {
        scenarioId: `base-sell-${pair.amountIn}-virtual`,
        amountInVirtual: decimal(pair.amountIn),
        aggregator,
        canonicalPool,
        crossSourceDeviationBps,
        crossCheckState,
        crossCheckReason,
      };
    });
    const knownQuotes = scenarios.flatMap(({ aggregator, canonicalPool }) =>
      [aggregator, canonicalPool].filter(
        (value): value is Extract<typeof value, { state: "KNOWN" }> => value.state === "KNOWN",
      ),
    );
    const quoteState = scenarios.every(({ crossCheckState }) => crossCheckState === "PASS")
      ? "PASS"
      : knownQuotes.length > 0
        ? "PARTIAL"
        : "BLOCKED";
    const snapshotExpiry =
      knownQuotes.length === 0
        ? expiresAt(startedAt, this.#settings.quoteExpirySeconds)
        : timestamp(
            new Date(Math.min(...knownQuotes.map(({ value }) => Date.parse(value.expiresAt)))),
          );
    const evidenceIds = [
      ...new Set([
        ...identity.evidenceIds,
        ...knownQuotes.flatMap(({ value }) => value.evidenceIds),
      ]),
    ];
    return BaseQuoteResearchSnapshotSchema.parse({
      snapshotId: stableId("base-quote-research", {
        latestBlock: latestBlock.toString(),
        scenarios: scenarios.map(({ amountInVirtual, aggregator, canonicalPool }) => ({
          amountInVirtual,
          aggregator:
            aggregator.state === "KNOWN" ? aggregator.value.observationId : aggregator.state,
          canonicalPool:
            canonicalPool.state === "KNOWN"
              ? canonicalPool.value.observationId
              : canonicalPool.state,
        })),
      }),
      purpose: "RESEARCH_ONLY",
      chainProfileId: "base-mainnet-virtual-usdc-research-v1",
      networkScope: "eip155:8453",
      quoteState,
      identityState: "PASS",
      virtualTokenAddress: BASE_VIRTUAL_ADDRESS,
      settlementAssetAddress: BASE_USDC_ADDRESS,
      settlementAssetSymbol: "USDC",
      fixedAmountsVirtual: this.#settings.fixedSellAmountsVirtual.map(decimal),
      researchSlippageBps: decimal(this.#settings.researchSlippageBps),
      maximumCrossSourceDeviationBps: decimal(this.#settings.maximumCrossSourceDeviationBps),
      maximumBlockLag: this.#settings.maximumBlockLag,
      expirySeconds: this.#settings.quoteExpirySeconds,
      walletState: "NOT_REQUIRED_FIXED_TEST_AMOUNTS",
      quoteLimitsState: "UNSET",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
      scenarios,
      observedAt: startedAt,
      expiresAt: snapshotExpiry,
      evidenceIds,
      limitations: [
        "Fixed test amounts are not derived from a wallet balance.",
        "The 50 bps minimum-out buffer is a research convention, not trading authorization.",
        "User cost limits are UNSET and economic evidence remains POSITIVE_EV_NOT_PROVEN.",
        "A quote response is not calldata, a simulation receipt, a signature, a broadcast, or a fill.",
      ],
    });
  }
}
