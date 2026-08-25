import { z } from "zod";
import { DecimalStringSchema } from "./decimal";
import { HashSchema } from "./evidence";
import { TimestampSchema } from "./knowledge";
import { AssetSchema } from "./observations";

export const V3SourceIdSchema = z.enum(["techflow-public-newsletter", "binance-spot-public"]);
export type V3SourceId = z.infer<typeof V3SourceIdSchema>;

export const V3SourceHealthSchema = z
  .object({
    sourceId: V3SourceIdSchema,
    label: z.string().min(1),
    category: z.enum(["NEWS", "MARKET"]),
    capabilityState: z.enum(["PLANNED", "TESTED", "VERIFIED_CURRENT", "UNSUPPORTED"]),
    status: z.enum(["WARMING_UP", "HEALTHY", "DEGRADED", "STALE", "ERROR", "UNSUPPORTED"]),
    transport: z.enum(["PUBLIC_WEBPAGE", "SPOT_WEBSOCKET"]),
    endpoint: z.string().min(1),
    lastAttemptAt: TimestampSchema.nullable(),
    lastSuccessAt: TimestampSchema.nullable(),
    dataAgeMs: z.number().int().nonnegative().nullable(),
    messagesReceived: z.number().int().nonnegative(),
    uniqueItems: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    gaps: z.number().int().nonnegative(),
    reconnects: z.number().int().nonnegative(),
    errorCode: z.string().min(1).nullable(),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type V3SourceHealth = z.infer<typeof V3SourceHealthSchema>;

export const V3MacroEventTypeSchema = z.enum([
  "MONETARY_MACRO",
  "TRADE_SANCTIONS",
  "GEOPOLITICS",
  "FINANCIAL_STABILITY",
  "ENERGY_SUPPLY",
  "CRYPTO_POLICY",
  "OTHER",
  "UNKNOWN",
]);
export type V3MacroEventType = z.infer<typeof V3MacroEventTypeSchema>;

export const V3NewsItemSchema = z
  .object({
    observationId: z.string().min(1),
    sourceId: z.literal("techflow-public-newsletter"),
    sourceItemId: z.string().regex(/^\d+$/),
    sourceUrl: z.url(),
    originalUrl: z.url().nullable(),
    headline: z.string().min(1),
    bodyExcerpt: z.string(),
    sourceAttribution: z.string().nullable(),
    categories: z.array(z.string().min(1)),
    sourceOccurredAt: TimestampSchema.nullable(),
    receivedAt: TimestampSchema,
    accessedAt: TimestampSchema,
    updatedAt: TimestampSchema.nullable(),
    revision: z.number().int().nonnegative(),
    rawTextHash: HashSchema,
    eventType: V3MacroEventTypeSchema,
    entities: z.array(z.string().min(1)),
    countries: z.array(z.string().min(1)),
    direction: z.enum(["RISK_OFF", "RISK_ON", "NEUTRAL", "UNKNOWN"]),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "SYSTEMIC", "UNKNOWN"]),
    scheduledState: z.enum(["SCHEDULED", "UNSCHEDULED", "UNKNOWN"]),
    macroRelevant: z.boolean(),
    classificationReason: z.string().min(1),
    schemaVersion: z.literal("3.0.0"),
  })
  .strict();
export type V3NewsItem = z.infer<typeof V3NewsItemSchema>;

export const V3NewsAuditCheckSchema = z
  .object({
    id: z.enum(["MACRO_RELEVANCE", "RISK_DIRECTION", "IMPACT_SEVERITY", "OBSERVATION_WINDOW"]),
    state: z.enum(["PASS", "FAIL", "REVIEW_REQUIRED", "NOT_APPLICABLE"]),
    label: z.string().min(1),
    current: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type V3NewsAuditCheck = z.infer<typeof V3NewsAuditCheckSchema>;

export const V3NewsAuditJudgmentSchema = z
  .object({
    outcome: z.enum(["ENTERED_RISK_OBSERVATION", "NOT_TRIGGERED", "REVIEW_REQUIRED"]),
    summary: z.string().min(1),
    checks: z.array(V3NewsAuditCheckSchema).length(4),
    judgedAt: TimestampSchema,
    observationWindowEndsAt: TimestampSchema.nullable(),
    ruleVersion: z.literal("news-gate-v1"),
    modelVersion: z.string().min(1),
    configVersion: z.string().min(1),
  })
  .strict();
export type V3NewsAuditJudgment = z.infer<typeof V3NewsAuditJudgmentSchema>;

export const V3NewsAuditRecordSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    recordId: z.string().regex(/^news-audit-[0-9]+-r\d+-[0-9a-f]{12}$/),
    recordHash: HashSchema,
    item: V3NewsItemSchema,
    judgment: V3NewsAuditJudgmentSchema,
  })
  .strict();
export type V3NewsAuditRecord = z.infer<typeof V3NewsAuditRecordSchema>;

export const V3MarketTickSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("AGG_TRADE"),
      sourceId: z.literal("binance-spot-public"),
      observationId: z.string().min(1),
      asset: AssetSchema,
      symbol: z.string().min(1),
      aggregateTradeId: z.number().int().nonnegative(),
      price: DecimalStringSchema,
      quantity: DecimalStringSchema,
      quoteNotional: DecimalStringSchema,
      takerSide: z.enum(["BUY", "SELL"]),
      eventTime: TimestampSchema,
      receivedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("BOOK_TICKER"),
      sourceId: z.literal("binance-spot-public"),
      observationId: z.string().min(1),
      asset: AssetSchema,
      symbol: z.string().min(1),
      updateId: z.number().int().nonnegative(),
      bidPrice: DecimalStringSchema,
      bidQuantity: DecimalStringSchema,
      askPrice: DecimalStringSchema,
      askQuantity: DecimalStringSchema,
      midPrice: DecimalStringSchema,
      eventTime: TimestampSchema,
      receivedAt: TimestampSchema,
    })
    .strict(),
]);
export type V3MarketTick = z.infer<typeof V3MarketTickSchema>;

export const V3ConditionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    state: z.enum(["PASS", "FAIL", "UNKNOWN", "STALE"]),
    current: z.string().min(1),
    target: z.string().min(1),
    gap: z.string().min(1),
    progress: z.number().min(0).max(1).nullable(),
    durationSeconds: z.number().int().nonnegative().nullable(),
    source: V3SourceIdSchema,
    dataAgeMs: z.number().int().nonnegative().nullable(),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type V3Condition = z.infer<typeof V3ConditionSchema>;

export const V3DecisionPanelSchema = z
  .object({
    model: z.enum(["SELL", "REBUY"]),
    stage: z.enum([
      "NO_ACTION",
      "NEWS_ARMED",
      "MARKET_ARMED",
      "SELL_READY",
      "REBUY_WAIT",
      "REBUY_READY",
      "DATA_UNAVAILABLE",
      "UNKNOWN",
    ]),
    output: z.enum(["NO_ACTION", "WATCH", "SHADOW_CANDIDATE", "CEX_REFERENCE_READY"]),
    outputBasis: z.literal("CEX_REFERENCE"),
    passed: z.number().int().min(0).max(4),
    required: z.literal(4),
    conditions: z.array(V3ConditionSchema).length(4),
    nextGap: z.string().min(1),
    extremeMarketFallback: z.enum(["NOT_USED", "NOT_CALIBRATED", "UNKNOWN"]),
    sellContext: z.enum(["NONE", "SHADOW_REFERENCE", "USER_RECORDED"]),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type V3DecisionPanel = z.infer<typeof V3DecisionPanelSchema>;

export const V3AssetMarketStateSchema = z
  .object({
    asset: AssetSchema,
    symbol: z.string().min(1),
    price: DecimalStringSchema.nullable(),
    return60s: DecimalStringSchema.nullable(),
    dataAgeMs: z.number().int().nonnegative().nullable(),
    freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]),
  })
  .strict();
export type V3AssetMarketState = z.infer<typeof V3AssetMarketStateSchema>;

export const V3TimelineEventSchema = z
  .object({
    eventId: z.string().min(1),
    at: TimestampSchema,
    kind: z.enum(["SOURCE", "NEWS", "MARKET", "SELL", "REBUY", "GAP", "SYSTEM"]),
    message: z.string().min(1),
    evidence: z.string().min(1),
  })
  .strict();
export type V3TimelineEvent = z.infer<typeof V3TimelineEventSchema>;

export const V3DashboardStateSchema = z
  .object({
    schemaVersion: z.literal("3.0.0"),
    mode: z.enum(["REPLAY", "SHADOW", "LIVE_READ_ONLY"]),
    asOf: TimestampSchema,
    evidenceLevel: z.enum(["REPOSITORY_RECORD", "TESTED", "VERIFIED_CURRENT"]),
    economicEvidence: z.literal("POSITIVE_EV_NOT_PROVEN"),
    outputBasis: z.literal("CEX_REFERENCE"),
    source: z.enum(["WARMUP_FIXTURE", "LIVE_TWO_SOURCE_RUNTIME", "V3_REPLAY"]),
    boundaryNotice: z.string().min(1),
    sources: z
      .object({
        techflow: V3SourceHealthSchema,
        binance: V3SourceHealthSchema,
      })
      .strict(),
    latestMacroEvent: V3NewsItemSchema.nullable(),
    market: z.array(V3AssetMarketStateSchema).length(4),
    sell: V3DecisionPanelSchema,
    rebuy: V3DecisionPanelSchema,
    timeline: z.array(V3TimelineEventSchema),
  })
  .strict();
export type V3DashboardState = z.infer<typeof V3DashboardStateSchema>;
