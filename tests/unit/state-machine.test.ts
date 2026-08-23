import { readFileSync } from "node:fs";
import {
  createStageTransition,
  isRebuyTransitionAllowed,
  isSellTransitionAllowed,
  parseStateMachineSpec,
} from "@virtual/decision";
import { timestamp, type DecisionSnapshot } from "@virtual/domain";
import { describe, expect, it } from "vitest";

function spec() {
  return parseStateMachineSpec(
    JSON.parse(
      readFileSync(
        new URL("../../config/legacy-v0.2-state-machines.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

describe("machine-readable state contracts", () => {
  it("covers all states and freezes condition denominators and shadow ceiling", () => {
    const value = spec();
    expect(value.sell.requiredConditionDenominator).toBe(4);
    expect(value.rebuy.requiredConditionDenominator).toBe(5);
    expect(value.sell.validationMaximumAction).toBe("SHADOW_CANDIDATE");
    expect(value.rebuy.validationMaximumAction).toBe("SHADOW_CANDIDATE");
    expect(value.noActionIsFormalOutput).toBe(true);
  });

  it("allows declared and data-block transitions but rejects state skipping", () => {
    const value = spec();
    expect(isSellTransitionAllowed(value, "NEWS_ARMED", "SELL_PRETRIGGER")).toBe(true);
    expect(isSellTransitionAllowed(value, "SELL_CONFIRMED", "DATA_BLOCKED")).toBe(true);
    expect(isSellTransitionAllowed(value, "SELL_IDLE", "SELL_CONFIRMED")).toBe(false);
  });

  it("requires a recorded first tranche before second-tranche wait", () => {
    const value = spec();
    expect(isRebuyTransitionAllowed(value, "REBUY_TRANCHE_1", "REBUY_TRANCHE_2_WAIT")).toBe(true);
    expect(isRebuyTransitionAllowed(value, "REBUY_WAIT", "REBUY_COMPLETE")).toBe(false);
    expect(isRebuyTransitionAllowed(value, "REBUY_ARMED", "REBUY_VETOED")).toBe(true);
  });

  it("fails on a missing domain state rather than accepting an incomplete table", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../config/legacy-v0.2-state-machines.json", import.meta.url),
        "utf8",
      ),
    ) as { sell: { states: string[] } };
    raw.sell.states = raw.sell.states.filter((state) => state !== "SELL_COOLDOWN");
    expect(() => parseStateMachineSpec(raw)).toThrow("every domain stage");
  });

  it("records only declared transitions and freezes the model version", () => {
    const decision = (
      decisionId: string,
      stage: "NEWS_ARMED" | "SELL_PRETRIGGER",
      modelVersion = "0.1.0",
    ) =>
      ({
        decisionId,
        model: "SELL",
        stage,
        modelVersion,
        evidenceIds: [decisionId],
        createdAt: timestamp("2026-08-22T08:00:00.000Z"),
      }) as DecisionSnapshot;
    const transition = createStageTransition({
      previous: decision("before", "NEWS_ARMED"),
      next: decision("after", "SELL_PRETRIGGER"),
      spec: spec(),
    });
    expect(transition).toMatchObject({
      model: "SELL",
      from: "NEWS_ARMED",
      to: "SELL_PRETRIGGER",
      evidenceIds: ["before", "after"],
    });
    expect(
      createStageTransition({
        previous: decision("same-a", "NEWS_ARMED"),
        next: decision("same-b", "NEWS_ARMED"),
        spec: spec(),
      }),
    ).toBeNull();
    expect(() =>
      createStageTransition({
        previous: decision("v1", "NEWS_ARMED", "0.1.0"),
        next: decision("v2", "SELL_PRETRIGGER", "0.2.0"),
        spec: spec(),
      }),
    ).toThrow("frozen");
  });
});
