import { createHash } from "node:crypto";
import {
  DecimalStringSchema,
  type Hash,
  HashSchema,
  type Timestamp,
  TimestampSchema,
} from "@virtual/domain";
import { z } from "zod";

const thresholdSchema = z
  .object({
    fixedReturn60s: z.record(z.enum(["BTC", "ETH", "SOL", "VIRTUAL"]), DecimalStringSchema),
    volatilityMultiplier: z.record(z.enum(["BTC", "ETH", "SOL", "VIRTUAL"]), DecimalStringSchema),
    robustSigmaLookbackSeconds: z.number().int().positive(),
    marketArmBreadth: z.number().int().min(1).max(3),
    broadMarketVolumeAnomalyMinimum: DecimalStringSchema,
    virtualSellRatioMaximum: DecimalStringSchema,
    virtualSellPersistenceSeconds: z.number().int().positive(),
  })
  .strict();

const rebuySchema = z
  .object({
    noNewLowSeconds: z.number().int().positive(),
    oiContractsDeclineMinimumPct: DecimalStringSchema,
    virtualBuySellRatioMinimum: DecimalStringSchema,
    orderFlowPersistenceSeconds: z.number().int().positive(),
    btcReturn60sMinimum: DecimalStringSchema,
    solReturn60sMinimum: DecimalStringSchema,
    marketStabilitySeconds: z.number().int().positive(),
    secondTrancheStabilitySeconds: z.number().int().positive(),
  })
  .strict();

const quoteLimitsSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("UNSET"),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      state: z.literal("SET"),
      maximumPriceImpactBps: DecimalStringSchema,
      maximumRoundTripCostPct: DecimalStringSchema,
      maximumGasSettlement: DecimalStringSchema,
    })
    .strict(),
]);

const chainCandidateSchema = z
  .object({
    chainProfileId: z.string().min(1),
    networkScope: z.string().min(1),
    chainId: z.string().min(1),
    candidateVirtualTokenAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    identityState: z.enum(["UNVERIFIED", "UNKNOWN", "VERIFIED_CURRENT"]),
    quoteAdapterState: z.enum(["PLANNED", "IMPLEMENTED", "UNSUPPORTED", "VERIFIED_CURRENT"]),
  })
  .strict();

const quoteResearchSchema = z
  .object({
    mode: z.literal("FIXED_TEST_AMOUNTS"),
    fixedSellAmountsVirtual: z.array(DecimalStringSchema).min(1),
    settlementAssetSymbol: z.literal("USDC"),
    settlementAssetAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    researchSlippageBps: DecimalStringSchema,
    maximumCrossSourceDeviationBps: DecimalStringSchema,
    quoteExpirySeconds: z.number().int().positive(),
    maximumBlockLag: z.number().int().nonnegative(),
    rpcEndpoint: z.string().url().startsWith("https://"),
    aggregatorProviderId: z.literal("velora-prices-v6.2"),
    canonicalPoolProviderId: z.literal("uniswap-v3-direct-pool"),
    canonicalPoolAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    canonicalPoolFee: z.number().int().positive(),
    canonicalPoolFactoryAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    canonicalQuoterAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .strict();

export const SystemConfigSchema = z
  .object({
    schemaVersion: z.string().min(1),
    modelVersion: z.string().min(1),
    configVersion: z.string().min(1),
    effectiveAt: TimestampSchema,
    mode: z.enum(["REPLAY", "SHADOW", "LIVE_READ_ONLY"]),
    economicEvidence: z.enum(["POSITIVE_EV_NOT_PROVEN", "PASS", "FAIL", "UNKNOWN"]),
    time: z
      .object({
        internalTimezone: z.literal("UTC"),
        uiTimezone: z.literal("Asia/Shanghai"),
        maximumClockDriftMs: z.number().int().nonnegative(),
      })
      .strict(),
    retention: z
      .object({
        rawDays: z.number().int().positive(),
        decisionSnapshots: z.literal("LONG_TERM"),
        cleanupMode: z.literal("DRY_RUN_ONLY"),
      })
      .strict(),
    tacticalSleeve: z
      .object({
        state: z.literal("UNSET"),
        scenariosPct: z.array(DecimalStringSchema).length(3),
        sellTranchesPct: z.array(DecimalStringSchema).length(2),
        rebuyTranchesPct: z.array(DecimalStringSchema).length(2),
      })
      .strict(),
    news: z
      .object({
        authority: z.literal("AUXILIARY"),
        marketOnlyPath: z.literal("ENABLED_STRICT"),
        observationWindowSeconds: z.number().int().positive(),
        publicSourcesFirst: z.literal(true),
      })
      .strict(),
    market: z
      .object({
        assets: z.tuple([
          z.literal("BTC"),
          z.literal("ETH"),
          z.literal("SOL"),
          z.literal("VIRTUAL"),
        ]),
        sell: thresholdSchema,
        rebuy: rebuySchema,
      })
      .strict(),
    quoteLimits: quoteLimitsSchema,
    quoteResearch: quoteResearchSchema,
    chains: z
      .object({
        base: chainCandidateSchema,
        robinhood: chainCandidateSchema,
      })
      .strict(),
  })
  .strict();

export type SystemConfig = z.infer<typeof SystemConfigSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function parseSystemConfig(input: unknown): Readonly<SystemConfig> {
  return Object.freeze(SystemConfigSchema.parse(input));
}

export function hashConfig(config: SystemConfig): Hash {
  const payload = JSON.stringify(canonicalize(config));
  return HashSchema.parse(`sha256:${createHash("sha256").update(payload).digest("hex")}`);
}

export type ConfigReadback = {
  schemaVersion: string;
  modelVersion: string;
  configVersion: string;
  configHash: Hash;
  effectiveAt: Timestamp;
  mode: SystemConfig["mode"];
  economicEvidence: SystemConfig["economicEvidence"];
  tacticalSleeveState: "UNSET";
  quoteLimitsState: SystemConfig["quoteLimits"]["state"];
  quoteResearchMode: SystemConfig["quoteResearch"]["mode"];
  fixedSellAmountsVirtual: SystemConfig["quoteResearch"]["fixedSellAmountsVirtual"];
};

export function createConfigReadback(config: SystemConfig): ConfigReadback {
  return {
    schemaVersion: config.schemaVersion,
    modelVersion: config.modelVersion,
    configVersion: config.configVersion,
    configHash: hashConfig(config),
    effectiveAt: config.effectiveAt,
    mode: config.mode,
    economicEvidence: config.economicEvidence,
    tacticalSleeveState: config.tacticalSleeve.state,
    quoteLimitsState: config.quoteLimits.state,
    quoteResearchMode: config.quoteResearch.mode,
    fixedSellAmountsVirtual: config.quoteResearch.fixedSellAmountsVirtual,
  };
}
