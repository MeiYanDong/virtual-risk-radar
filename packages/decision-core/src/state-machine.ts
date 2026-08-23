import {
  ChainActionStateSchema,
  RebuyStageSchema,
  SellStageSchema,
  type RebuyStage,
  type SellStage,
} from "@virtual/domain";
import { z } from "zod";

const sellTransitionSchema = z
  .object({ from: SellStageSchema, to: SellStageSchema, guard: z.string().min(1) })
  .strict();
const rebuyTransitionSchema = z
  .object({ from: RebuyStageSchema, to: RebuyStageSchema, guard: z.string().min(1) })
  .strict();
const machineCommon = {
  requiredConditionDenominator: z.number().int().positive(),
  hardGates: z.array(z.string().min(1)),
  validationMaximumAction: z.literal("SHADOW_CANDIDATE"),
};

export const StateMachineSpecSchema = z
  .object({
    schemaVersion: z.string().min(1),
    modelVersion: z.string().min(1),
    sell: z
      .object({
        initial: z.literal("SELL_IDLE"),
        states: z.array(SellStageSchema),
        transitions: z.array(sellTransitionSchema),
        globalTransitions: z.array(
          z
            .object({ from: z.literal("*"), to: SellStageSchema, guard: z.string().min(1) })
            .strict(),
        ),
        ...machineCommon,
      })
      .strict(),
    rebuy: z
      .object({
        initial: z.literal("REBUY_INACTIVE"),
        states: z.array(RebuyStageSchema),
        transitions: z.array(rebuyTransitionSchema),
        globalTransitions: z.array(
          z
            .object({ from: z.literal("*"), to: RebuyStageSchema, guard: z.string().min(1) })
            .strict(),
        ),
        ...machineCommon,
      })
      .strict(),
    chainActionStates: z.array(ChainActionStateSchema),
    noActionIsFormalOutput: z.literal(true),
  })
  .strict();

export type StateMachineSpec = z.infer<typeof StateMachineSpecSchema>;

export function parseStateMachineSpec(input: unknown): StateMachineSpec {
  const spec = StateMachineSpecSchema.parse(input);
  const sellStates = new Set(spec.sell.states);
  const rebuyStates = new Set(spec.rebuy.states);
  if (sellStates.size !== SellStageSchema.options.length) {
    throw new Error("Sell state table must define every domain stage exactly once");
  }
  if (rebuyStates.size !== RebuyStageSchema.options.length) {
    throw new Error("Rebuy state table must define every domain stage exactly once");
  }
  return spec;
}

export function isSellTransitionAllowed(
  spec: StateMachineSpec,
  from: SellStage,
  to: SellStage,
): boolean {
  if (from === to) return true;
  return (
    spec.sell.transitions.some((transition) => transition.from === from && transition.to === to) ||
    spec.sell.globalTransitions.some((transition) => transition.to === to)
  );
}

export function isRebuyTransitionAllowed(
  spec: StateMachineSpec,
  from: RebuyStage,
  to: RebuyStage,
): boolean {
  if (from === to) return true;
  return (
    spec.rebuy.transitions.some((transition) => transition.from === from && transition.to === to) ||
    spec.rebuy.globalTransitions.some((transition) => transition.to === to)
  );
}
