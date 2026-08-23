import Decimal from "decimal.js";
import {
  decimal,
  unknown,
  type DecimalString,
  type Knowledge,
  type Timestamp,
} from "@virtual/domain";

export type EconomicEvidenceState = "POSITIVE_EV_NOT_PROVEN" | "PASS" | "FAIL" | "UNKNOWN";

function positive(value: DecimalString, label: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isPositive()) throw new RangeError(`${label} must be positive`);
  return parsed;
}

export function effectiveDexSellPrice(input: {
  virtualIn: DecimalString;
  settlementOut: DecimalString;
  totalCostsSettlement: DecimalString;
}): DecimalString {
  const netOut = new Decimal(input.settlementOut).minus(input.totalCostsSettlement);
  if (netOut.isNegative()) throw new RangeError("Sell costs cannot exceed settlement output");
  return decimal(netOut.dividedBy(positive(input.virtualIn, "VIRTUAL input")));
}

export function effectiveDexBuyPrice(input: {
  settlementIn: DecimalString;
  totalCostsSettlement: DecimalString;
  virtualOut: DecimalString;
}): DecimalString {
  const grossIn = new Decimal(input.settlementIn).plus(input.totalCostsSettlement);
  return decimal(grossIn.dividedBy(positive(input.virtualOut, "VIRTUAL output")));
}

export function roundTripTokenQuantityDelta(input: {
  virtualSold: DecimalString;
  virtualRebought: DecimalString;
}): DecimalString {
  return decimal(new Decimal(input.virtualRebought).minus(input.virtualSold));
}

export type EconomicGateResult = {
  state: EconomicEvidenceState;
  lowerConfidenceBound: Knowledge<DecimalString>;
  reason: string;
};

export function evaluateConservativeEconomicGate(input: {
  sampleCount: number;
  minimumHistoricalEvents: number;
  meanTokenDelta: DecimalString;
  standardDeviationTokenDelta: DecimalString;
  zScore: DecimalString;
  decisionMarginTokenDelta: DecimalString;
  parameterSelectionSeparatedFromHoldout: boolean;
  shadowDays: number;
  minimumShadowDays: number;
  sufficientRiskWindows: boolean;
  asOf: Timestamp;
}): EconomicGateResult {
  if (
    input.sampleCount < input.minimumHistoricalEvents ||
    !input.parameterSelectionSeparatedFromHoldout ||
    input.shadowDays < input.minimumShadowDays ||
    !input.sufficientRiskWindows
  ) {
    return {
      state: "POSITIVE_EV_NOT_PROVEN",
      lowerConfidenceBound: unknown(
        "Historical holdout and real-time Shadow gates are incomplete",
        input.asOf,
      ),
      reason: "Economic evidence cannot pass before both validation phases complete",
    };
  }
  if (!Number.isInteger(input.sampleCount) || input.sampleCount <= 1) {
    return {
      state: "UNKNOWN",
      lowerConfidenceBound: unknown("Sample count is invalid", input.asOf),
      reason: "A confidence bound requires at least two valid samples",
    };
  }
  const standardDeviation = new Decimal(input.standardDeviationTokenDelta);
  if (standardDeviation.isNegative()) {
    return {
      state: "UNKNOWN",
      lowerConfidenceBound: unknown("Standard deviation cannot be negative", input.asOf),
      reason: "Economic sample statistics are invalid",
    };
  }
  const standardError = standardDeviation.dividedBy(new Decimal(input.sampleCount).sqrt());
  const lowerBound = new Decimal(input.meanTokenDelta).minus(
    new Decimal(input.zScore).times(standardError),
  );
  const lowerConfidenceBound = decimal(lowerBound);
  const passed = lowerBound.gt(input.decisionMarginTokenDelta);
  return {
    state: passed ? "PASS" : "FAIL",
    lowerConfidenceBound: {
      state: "KNOWN",
      value: lowerConfidenceBound,
      observedAt: input.asOf,
      evidenceIds: ["held-out-economic-evaluation"],
    },
    reason: passed
      ? "Conservative token-delta lower bound exceeds the predefined decision margin"
      : "Conservative token-delta lower bound does not exceed the decision margin",
  };
}
