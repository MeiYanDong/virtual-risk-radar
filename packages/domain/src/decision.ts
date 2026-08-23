import { z } from "zod";
import { DecimalStringSchema } from "./decimal";
import { knowledgeSchema, TimestampSchema } from "./knowledge";
import { DataHealthSchema } from "./observations";

export const DecisionModeSchema = z.enum(["REPLAY", "SHADOW", "LIVE_READ_ONLY"]);
export type DecisionMode = z.infer<typeof DecisionModeSchema>;

export const SellStageSchema = z.enum([
  "SELL_IDLE",
  "NEWS_ARMED",
  "MARKET_ARMED",
  "SELL_PRETRIGGER",
  "SELL_CONFIRMED",
  "SELL_COOLDOWN",
  "REBUY_WAIT",
  "DATA_BLOCKED",
]);
export type SellStage = z.infer<typeof SellStageSchema>;

export const RebuyStageSchema = z.enum([
  "REBUY_INACTIVE",
  "REBUY_WAIT",
  "REBUY_ARMED",
  "REBUY_TRANCHE_1",
  "REBUY_TRANCHE_2_WAIT",
  "REBUY_COMPLETE",
  "REBUY_VETOED",
]);
export type RebuyStage = z.infer<typeof RebuyStageSchema>;

export const ConditionStateSchema = z.enum(["PASS", "FAIL", "UNKNOWN", "STALE", "VETO"]);
export type ConditionState = z.infer<typeof ConditionStateSchema>;

export const ConditionEvaluationSchema = z
  .object({
    conditionId: z.string().min(1),
    modelId: z.enum(["SELL", "REBUY"]),
    modelVersion: z.string().min(1),
    rawValue: knowledgeSchema(DecimalStringSchema),
    normalizedProgress: knowledgeSchema(DecimalStringSchema),
    targetOperator: z.enum(["LTE", "GTE", "EQ", "ALL", "NONE"]),
    targetValue: knowledgeSchema(DecimalStringSchema),
    gapToTarget: knowledgeSchema(DecimalStringSchema),
    state: ConditionStateSchema,
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type ConditionEvaluation = z.infer<typeof ConditionEvaluationSchema>;

export const ChainActionStateSchema = z.enum([
  "SIGNAL_NOT_READY",
  "QUOTE_PENDING",
  "ACTIONABLE_WITH_EVIDENCE",
  "SHADOW_CANDIDATE",
  "BLOCKED_DATA",
  "BLOCKED_IDENTITY",
  "BLOCKED_COST",
  "BLOCKED_LIQUIDITY",
  "UNSUPPORTED",
  "UNKNOWN",
]);
export type ChainActionState = z.infer<typeof ChainActionStateSchema>;

export const ChainQuoteSchema = z
  .object({
    quoteId: z.string().min(1),
    chainProfileId: z.string().min(1),
    walletProfileId: z.string().min(1),
    side: z.enum(["SELL_VIRTUAL", "BUY_VIRTUAL"]),
    amountIn: DecimalStringSchema,
    expectedOut: DecimalStringSchema,
    minimumOut: DecimalStringSchema,
    priceImpactBps: DecimalStringSchema,
    totalCostPct: DecimalStringSchema,
    routeFees: DecimalStringSchema,
    estimatedGas: DecimalStringSchema,
    gasCurrency: z.string().min(1),
    effectivePrice: DecimalStringSchema,
    routeId: z.string().min(1),
    blockNumber: z.string().regex(/^\d+$/),
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    simulationState: z.enum(["PASS", "FAIL", "UNKNOWN", "UNSUPPORTED"]),
    identityState: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    routeState: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    walletBalanceState: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type ChainQuote = z.infer<typeof ChainQuoteSchema>;

export const ChainExecutabilitySchema = z
  .object({
    chainProfileId: z.string().min(1),
    actionState: ChainActionStateSchema,
    quote: knowledgeSchema(ChainQuoteSchema),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type ChainExecutability = z.infer<typeof ChainExecutabilitySchema>;

export const DecisionSnapshotSchema = z
  .object({
    decisionId: z.string().min(1),
    mode: DecisionModeSchema,
    model: z.enum(["SELL", "REBUY"]),
    stage: z.union([SellStageSchema, RebuyStageSchema]),
    stageEnteredAt: TimestampSchema,
    conditions: z.array(ConditionEvaluationSchema),
    passedRequiredCount: z.number().int().nonnegative(),
    requiredCount: z.number().int().nonnegative(),
    hardGates: z.array(ConditionEvaluationSchema),
    chainExecutability: z.array(ChainExecutabilitySchema),
    recommendedAction: z.enum([
      "NO_ACTION",
      "WATCH",
      "SHADOW_SELL_TRANCHE_1",
      "SHADOW_SELL_TRANCHE_2",
      "SHADOW_REBUY_TRANCHE_1",
      "SHADOW_REBUY_TRANCHE_2",
      "SELL_TRANCHE_1",
      "SELL_TRANCHE_2",
      "PREPARE_REBUY_QUOTE",
      "REBUY_TRANCHE_1",
      "REBUY_TRANCHE_2",
      "BLOCKED",
      "VETOED",
    ]),
    recommendedFractionOfTacticalSleeve: DecimalStringSchema,
    absoluteAmount: knowledgeSchema(DecimalStringSchema),
    dataHealth: DataHealthSchema,
    economicEvidence: z.enum(["POSITIVE_EV_NOT_PROVEN", "PASS", "FAIL", "UNKNOWN"]),
    modelVersion: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
    createdAt: TimestampSchema,
  })
  .strict();
export type DecisionSnapshot = z.infer<typeof DecisionSnapshotSchema>;
