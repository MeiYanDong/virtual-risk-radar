import { z } from "zod";

const stage = z.enum([
  "NO_ACTION",
  "NEWS_ARMED",
  "MARKET_ARMED",
  "SELL_READY",
  "REBUY_WAIT",
  "REBUY_READY",
  "DATA_UNAVAILABLE",
  "UNKNOWN",
]);

const transition = z
  .object({
    from: z.union([stage, z.literal("*")]),
    to: stage,
    guard: z.string().min(1),
  })
  .strict();

export const ActiveStateMachineSpecSchema = z
  .object({
    schemaVersion: z.literal("3.0.0"),
    modelVersion: z.literal("0.3.0"),
    outputBasis: z.literal("CEX_REFERENCE"),
    sell: z
      .object({
        initial: z.literal("NO_ACTION"),
        states: z.tuple([
          z.literal("NO_ACTION"),
          z.literal("NEWS_ARMED"),
          z.literal("MARKET_ARMED"),
          z.literal("SELL_READY"),
          z.literal("DATA_UNAVAILABLE"),
          z.literal("UNKNOWN"),
        ]),
        conditionIds: z.tuple([
          z.literal("S1-MACRO-SHOCK"),
          z.literal("S2-CROSS-ASSET-DRAWDOWN"),
          z.literal("S3-VIRTUAL-RELATIVE-WEAKNESS"),
          z.literal("S4-VIRTUAL-SELL-PRESSURE"),
        ]),
        requiredConditionDenominator: z.literal(4),
        confirmationRule: z.literal("ALL_FOUR_PASS"),
        extremeMarketFallback: z.literal("NOT_CALIBRATED"),
        transitions: z.array(transition).min(1),
      })
      .strict(),
    rebuy: z
      .object({
        initial: z.literal("NO_ACTION"),
        states: z.tuple([
          z.literal("NO_ACTION"),
          z.literal("REBUY_WAIT"),
          z.literal("REBUY_READY"),
          z.literal("DATA_UNAVAILABLE"),
          z.literal("UNKNOWN"),
        ]),
        conditionIds: z.tuple([
          z.literal("B1-NO-NEW-MACRO-ESCALATION"),
          z.literal("B2-CROSS-ASSET-NO-NEW-LOW"),
          z.literal("B3-VIRTUAL-RELATIVE-RECOVERY"),
          z.literal("B4-SELL-PRESSURE-NORMALIZED"),
        ]),
        requiredConditionDenominator: z.literal(4),
        confirmationRule: z.literal("ALL_FOUR_PASS_AND_SELL_CONTEXT"),
        transitions: z.array(transition).min(1),
      })
      .strict(),
    execution: z
      .object({
        maximumOutput: z.literal("SHADOW_CANDIDATE"),
        signing: z.literal("UNSUPPORTED"),
        broadcast: z.literal("UNSUPPORTED"),
        walletRead: z.literal("UNSUPPORTED"),
        rpc: z.literal("UNSUPPORTED"),
        dexQuote: z.literal("UNSUPPORTED"),
      })
      .strict(),
    noActionIsFormalOutput: z.literal(true),
  })
  .strict();

export type ActiveStateMachineSpec = z.infer<typeof ActiveStateMachineSpecSchema>;

export function parseActiveStateMachineSpec(input: unknown): Readonly<ActiveStateMachineSpec> {
  return Object.freeze(ActiveStateMachineSpecSchema.parse(input));
}
