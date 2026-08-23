import { z } from "zod";
import { DecimalStringSchema } from "./decimal";
import { knowledgeSchema, TimestampSchema } from "./knowledge";

const EvmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const QuoteProviderObservationSchema = z
  .object({
    observationId: z.string().min(1),
    providerId: z.string().min(1),
    providerKind: z.enum(["AGGREGATOR", "CANONICAL_POOL"]),
    chainProfileId: z.string().min(1),
    side: z.literal("SELL_VIRTUAL"),
    tokenInAddress: EvmAddressSchema,
    tokenOutAddress: EvmAddressSchema,
    amountIn: DecimalStringSchema,
    expectedOut: DecimalStringSchema,
    researchMinimumOut: DecimalStringSchema,
    effectivePrice: DecimalStringSchema,
    priceImpactBps: knowledgeSchema(DecimalStringSchema),
    relativeSizeImpactBps: knowledgeSchema(DecimalStringSchema),
    protocolFeeBps: knowledgeSchema(DecimalStringSchema),
    routeFeesSettlement: knowledgeSchema(DecimalStringSchema),
    totalCostPct: knowledgeSchema(DecimalStringSchema),
    estimatedGasUsd: knowledgeSchema(DecimalStringSchema),
    routeId: z.string().min(1),
    poolAddresses: z.array(EvmAddressSchema),
    blockNumber: z.string().regex(/^\d+$/),
    blockLag: z.number().int().nonnegative(),
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    freshnessState: z.enum(["FRESH", "STALE"]),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type QuoteProviderObservation = z.infer<typeof QuoteProviderObservationSchema>;

export const QuoteResearchScenarioSchema = z
  .object({
    scenarioId: z.string().min(1),
    amountInVirtual: DecimalStringSchema,
    aggregator: knowledgeSchema(QuoteProviderObservationSchema),
    canonicalPool: knowledgeSchema(QuoteProviderObservationSchema),
    crossSourceDeviationBps: knowledgeSchema(DecimalStringSchema),
    crossCheckState: z.enum(["PASS", "FAIL", "UNKNOWN", "STALE"]),
    crossCheckReason: z.string().min(1),
  })
  .strict();
export type QuoteResearchScenario = z.infer<typeof QuoteResearchScenarioSchema>;

export const BaseQuoteResearchSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    purpose: z.literal("RESEARCH_ONLY"),
    chainProfileId: z.string().min(1),
    networkScope: z.literal("eip155:8453"),
    quoteState: z.enum(["PASS", "PARTIAL", "BLOCKED"]),
    identityState: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    virtualTokenAddress: EvmAddressSchema,
    settlementAssetAddress: EvmAddressSchema,
    settlementAssetSymbol: z.literal("USDC"),
    fixedAmountsVirtual: z.array(DecimalStringSchema).min(1),
    researchSlippageBps: DecimalStringSchema,
    maximumCrossSourceDeviationBps: DecimalStringSchema,
    maximumBlockLag: z.number().int().nonnegative(),
    expirySeconds: z.number().int().positive(),
    walletState: z.literal("NOT_REQUIRED_FIXED_TEST_AMOUNTS"),
    quoteLimitsState: z.literal("UNSET"),
    economicEvidence: z.literal("POSITIVE_EV_NOT_PROVEN"),
    scenarios: z.array(QuoteResearchScenarioSchema).min(1),
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    evidenceIds: z.array(z.string().min(1)),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type BaseQuoteResearchSnapshot = z.infer<typeof BaseQuoteResearchSnapshotSchema>;
