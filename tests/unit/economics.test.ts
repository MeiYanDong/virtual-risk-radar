import {
  durationProgress,
  effectiveDexBuyPrice,
  effectiveDexSellPrice,
  evaluateConservativeEconomicGate,
  progressDown,
  progressUp,
  roundTripTokenQuantityDelta,
  valueAndDurationProgress,
} from "@virtual/decision";
import { decimal, timestamp } from "@virtual/domain";
import { describe, expect, it } from "vitest";

const NOW = timestamp("2026-08-22T08:00:00.000Z");

describe("progress and economic first principles", () => {
  it("computes directional and duration completion without calling it probability", () => {
    expect(progressDown(decimal("-0.025"), decimal("0"), decimal("-0.05"))).toBe("0.5");
    expect(progressUp(decimal("0.55"), decimal("0"), decimal("1.1"))).toBe("0.5");
    expect(durationProgress(15, 30)).toBe("0.5");
    expect(valueAndDurationProgress(decimal("0.8"), 15, 30)).toBe("0.5");
    expect(() => progressDown(decimal("0"), decimal("0"), decimal("1"))).toThrow();
  });

  it("keeps DEX sell, buy and token-delta units explicit", () => {
    expect(
      effectiveDexSellPrice({
        virtualIn: decimal("100"),
        settlementOut: decimal("75"),
        totalCostsSettlement: decimal("1"),
      }),
    ).toBe("0.74");
    expect(
      effectiveDexBuyPrice({
        settlementIn: decimal("74"),
        totalCostsSettlement: decimal("1"),
        virtualOut: decimal("110"),
      }),
    ).toBe("0.68181818181818181818");
    expect(
      roundTripTokenQuantityDelta({
        virtualSold: decimal("100"),
        virtualRebought: decimal("110"),
      }),
    ).toBe("10");
  });

  it("cannot prove economics before 30 events and 14-day Shadow", () => {
    const blocked = evaluateConservativeEconomicGate({
      sampleCount: 29,
      minimumHistoricalEvents: 30,
      meanTokenDelta: decimal("10"),
      standardDeviationTokenDelta: decimal("1"),
      zScore: decimal("1.96"),
      decisionMarginTokenDelta: decimal("0"),
      parameterSelectionSeparatedFromHoldout: true,
      shadowDays: 14,
      minimumShadowDays: 14,
      sufficientRiskWindows: true,
      asOf: NOW,
    });
    expect(blocked.state).toBe("POSITIVE_EV_NOT_PROVEN");
    expect(blocked.lowerConfidenceBound.state).toBe("UNKNOWN");
  });

  it("returns pass or fail only after all predeclared validation gates complete", () => {
    const common = {
      sampleCount: 30,
      minimumHistoricalEvents: 30,
      standardDeviationTokenDelta: decimal("1"),
      zScore: decimal("1.96"),
      decisionMarginTokenDelta: decimal("0"),
      parameterSelectionSeparatedFromHoldout: true,
      shadowDays: 14,
      minimumShadowDays: 14,
      sufficientRiskWindows: true,
      asOf: NOW,
    };
    expect(
      evaluateConservativeEconomicGate({ ...common, meanTokenDelta: decimal("1") }).state,
    ).toBe("PASS");
    expect(
      evaluateConservativeEconomicGate({ ...common, meanTokenDelta: decimal("0") }).state,
    ).toBe("FAIL");
  });
});
