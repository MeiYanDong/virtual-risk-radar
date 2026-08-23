import { z } from "zod";
import { DecimalStringSchema } from "./decimal";
import { HashSchema } from "./evidence";
import { knowledgeSchema, TimestampSchema } from "./knowledge";

export const AssetSchema = z.enum(["BTC", "ETH", "SOL", "VIRTUAL"]);
export type Asset = z.infer<typeof AssetSchema>;

export const NewsObservationSchema = z
  .object({
    observationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceItemId: z.string().min(1),
    sourceUrl: z.url(),
    sourceTier: z.enum(["T0", "T1", "T2", "T3", "T4"]),
    headline: z.string().min(1),
    language: z.string().min(2),
    revision: z.number().int().nonnegative(),
    ingestionMethod: z.enum(["LIVE_ADAPTER", "HISTORICAL_FIXTURE", "MANUAL_REFERENCE"]),
    sourceOccurredAt: knowledgeSchema(TimestampSchema),
    sourceOccurredAtPrecision: z.enum(["MILLISECOND", "SECOND", "MINUTE", "UNKNOWN"]),
    receivedAt: TimestampSchema,
    accessedAt: TimestampSchema,
    rawTextHash: HashSchema,
    claimFingerprint: knowledgeSchema(z.string().min(1)),
    credibilityState: z.enum(["VERIFIED", "CORROBORATED", "UNVERIFIED", "DISPUTED", "UNKNOWN"]),
    entities: z.array(z.string().min(1)),
    schemaVersion: z.string().min(1),
  })
  .strict();
export type NewsObservation = z.infer<typeof NewsObservationSchema>;

export const NewsEventTypeSchema = z.enum([
  "MACRO",
  "GEOPOLITICS",
  "REGULATION",
  "INFRASTRUCTURE",
  "SECURITY",
  "TOKEN",
  "LIQUIDITY",
  "RUMOR",
  "OTHER",
  "UNKNOWN",
]);
export type NewsEventType = z.infer<typeof NewsEventTypeSchema>;

export const NewsEventClusterSchema = z
  .object({
    clusterId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    claimFingerprint: z.string().min(1),
    eventType: NewsEventTypeSchema,
    factConfidence: z.enum(["VERIFIED", "CORROBORATED", "UNVERIFIED", "DISPUTED", "UNKNOWN"]),
    marketSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "SYSTEMIC", "UNKNOWN"]),
    attentionState: z.enum(["QUIET", "WATCH", "TRENDING", "SATURATED", "UNKNOWN"]),
    firstReceivedAt: TimestampSchema,
    lastUpdatedAt: TimestampSchema,
    officialConfirmationAt: knowledgeSchema(TimestampSchema),
    sourceIds: z.array(z.string().min(1)).min(1),
    independentSourceCount: z.number().int().nonnegative(),
    amplificationCount: z.number().int().nonnegative(),
    observationIds: z.array(z.string().min(1)).min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type NewsEventCluster = z.infer<typeof NewsEventClusterSchema>;

export const MarketObservationSchema = z
  .object({
    observationId: z.string().min(1),
    sourceId: z.string().min(1),
    instrumentId: z.string().min(1),
    asset: AssetSchema,
    quoteAsset: z.string().min(1),
    venueType: z.enum(["SPOT", "FUTURES", "DEX", "OTHER"]),
    marketRole: z.enum(["PRICE_REFERENCE", "ORDER_FLOW_REFERENCE"]),
    observationKind: z.enum(["TRADE", "AGGREGATE_TRADE", "KLINE_CLOSE", "BEST_BID_ASK"]),
    eventTime: TimestampSchema,
    receivedAt: TimestampSchema,
    price: DecimalStringSchema,
    quantity: knowledgeSchema(DecimalStringSchema),
    takerSide: z.enum(["BUY", "SELL", "UNKNOWN"]),
    sequence: knowledgeSchema(z.string().min(1)),
    schemaVersion: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type MarketObservation = z.infer<typeof MarketObservationSchema>;

export const DerivativeObservationSchema = z
  .object({
    observationId: z.string().min(1),
    sourceId: z.string().min(1),
    instrumentId: z.string().min(1),
    observedAt: TimestampSchema,
    receivedAt: TimestampSchema,
    openInterestContracts: knowledgeSchema(DecimalStringSchema),
    openInterestUsd: knowledgeSchema(DecimalStringSchema),
    takerBuySellRatio: knowledgeSchema(DecimalStringSchema),
    liquidationUsd: knowledgeSchema(DecimalStringSchema),
    fundingRate: knowledgeSchema(DecimalStringSchema),
    schemaVersion: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type DerivativeObservation = z.infer<typeof DerivativeObservationSchema>;

const assetDecimalKnowledge = z.record(AssetSchema, knowledgeSchema(DecimalStringSchema));

export const DataHealthSchema = z
  .object({
    state: z.enum(["PASS", "DEGRADED", "BLOCKED", "UNKNOWN"]),
    staleSources: z.array(z.string().min(1)),
    gapSources: z.array(z.string().min(1)),
    clockDriftMs: knowledgeSchema(DecimalStringSchema),
    futureDataDetected: z.boolean(),
    observedAt: TimestampSchema,
  })
  .strict();
export type DataHealth = z.infer<typeof DataHealthSchema>;

export const FeatureSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    asOf: TimestampSchema,
    modelVersion: z.string().min(1),
    formulaVersion: z.string().min(1),
    parameterVersion: z.string().min(1),
    return60s: assetDecimalKnowledge,
    maxDrawdown60s: assetDecimalKnowledge,
    robustSigma60s: assetDecimalKnowledge,
    virtualTakerBuyNotional60s: knowledgeSchema(DecimalStringSchema),
    virtualTakerSellNotional60s: knowledgeSchema(DecimalStringSchema),
    virtualTakerBuySellRatio60s: knowledgeSchema(DecimalStringSchema),
    virtualNetTakerFlow60s: knowledgeSchema(DecimalStringSchema),
    virtualOrderFlowZScore60s: knowledgeSchema(DecimalStringSchema),
    virtualExcessReturn60s: knowledgeSchema(DecimalStringSchema),
    virtualSellPressureSeconds: knowledgeSchema(z.number().int().nonnegative()),
    virtualOrderFlowRecoverySeconds: knowledgeSchema(z.number().int().nonnegative()),
    broadMarketStabilitySeconds: knowledgeSchema(z.number().int().nonnegative()),
    marketShockBreadth: knowledgeSchema(z.number().int().min(0).max(3)),
    broadMarketVolumeAnomaly: knowledgeSchema(DecimalStringSchema),
    riskArmedAt: knowledgeSchema(TimestampSchema),
    oiBaselineContracts: knowledgeSchema(DecimalStringSchema),
    oiContractsChangeFromBaselinePct: knowledgeSchema(DecimalStringSchema),
    eventRunningLow: knowledgeSchema(DecimalStringSchema),
    secondsSinceLastEventLow: knowledgeSchema(z.number().int().nonnegative()),
    newsRiskContext: z.enum(["NEWS_ARMED", "NO_NEWS", "UNKNOWN"]),
    permanentDamage: z.enum(["PASS", "FAIL", "UNKNOWN", "UNKNOWN_REVIEW_REQUIRED"]),
    sourceCoverage: z.record(z.string().min(1), knowledgeSchema(DecimalStringSchema)),
    freshnessByFeature: z.record(
      z.string().min(1),
      z.enum(["FRESH", "STALE", "UNKNOWN", "UNSUPPORTED", "ERROR"]),
    ),
    dataHealth: DataHealthSchema,
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type FeatureSnapshot = z.infer<typeof FeatureSnapshotSchema>;
