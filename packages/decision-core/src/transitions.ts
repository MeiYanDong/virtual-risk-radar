import { createHash } from "node:crypto";
import type { DecisionSnapshot, RebuyStage, SellStage, Timestamp } from "@virtual/domain";
import {
  isRebuyTransitionAllowed,
  isSellTransitionAllowed,
  type StateMachineSpec,
} from "./state-machine";

export type StageTransition = {
  transitionId: string;
  model: "SELL" | "REBUY";
  from: SellStage | RebuyStage;
  to: SellStage | RebuyStage;
  occurredAt: Timestamp;
  modelVersion: string;
  decisionId: string;
  evidenceIds: string[];
};

export function createStageTransition(input: {
  previous: DecisionSnapshot;
  next: DecisionSnapshot;
  spec: StateMachineSpec;
}): StageTransition | null {
  if (input.previous.model !== input.next.model) {
    throw new Error("A decision cycle cannot transition between SELL and REBUY models");
  }
  if (input.previous.modelVersion !== input.next.modelVersion) {
    throw new Error("Model version is frozen inside one decision cycle");
  }
  if (input.previous.stage === input.next.stage) return null;
  const allowed =
    input.next.model === "SELL"
      ? isSellTransitionAllowed(
          input.spec,
          input.previous.stage as SellStage,
          input.next.stage as SellStage,
        )
      : isRebuyTransitionAllowed(
          input.spec,
          input.previous.stage as RebuyStage,
          input.next.stage as RebuyStage,
        );
  if (!allowed) {
    throw new Error(
      `Undefined ${input.next.model} transition ${input.previous.stage} -> ${input.next.stage}`,
    );
  }
  const identity = `${input.next.model}:${input.previous.decisionId}:${input.next.decisionId}`;
  return {
    transitionId: `transition-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
    model: input.next.model,
    from: input.previous.stage,
    to: input.next.stage,
    occurredAt: input.next.createdAt,
    modelVersion: input.next.modelVersion,
    decisionId: input.next.decisionId,
    evidenceIds: [...new Set([...input.previous.evidenceIds, ...input.next.evidenceIds])],
  };
}
