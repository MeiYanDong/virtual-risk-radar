import Decimal from "decimal.js";
import {
  decimal,
  isFreshAt,
  known,
  timestamp,
  unknown,
  type ConditionEvaluation,
  type ConditionState,
  type DecimalString,
  type Knowledge,
  type Timestamp,
} from "@virtual/domain";

function expiresAfter(now: Timestamp, milliseconds = 1_000): Timestamp {
  return timestamp(new Date(Date.parse(now) + milliseconds));
}

function clampedRatio(numerator: Decimal, denominator: Decimal): DecimalString {
  if (denominator.isZero()) throw new RangeError("Progress neutral and target cannot be equal");
  return decimal(Decimal.max(0, Decimal.min(1, numerator.dividedBy(denominator))));
}

export function progressDown(
  current: DecimalString,
  neutral: DecimalString,
  target: DecimalString,
): DecimalString {
  const neutralValue = new Decimal(neutral);
  const targetValue = new Decimal(target);
  if (targetValue.gte(neutralValue)) {
    throw new RangeError("Downward progress target must be below neutral");
  }
  return clampedRatio(neutralValue.minus(current), neutralValue.minus(targetValue));
}

export function progressUp(
  current: DecimalString,
  neutral: DecimalString,
  target: DecimalString,
): DecimalString {
  const neutralValue = new Decimal(neutral);
  const targetValue = new Decimal(target);
  if (targetValue.lte(neutralValue)) {
    throw new RangeError("Upward progress target must be above neutral");
  }
  return clampedRatio(new Decimal(current).minus(neutralValue), targetValue.minus(neutralValue));
}

export function durationProgress(elapsedSeconds: number, targetSeconds: number): DecimalString {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError("Elapsed duration must be non-negative");
  }
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new RangeError("Duration target must be positive");
  }
  return decimal(Decimal.min(1, new Decimal(elapsedSeconds).dividedBy(targetSeconds)));
}

export function valueAndDurationProgress(
  valueProgress: DecimalString,
  elapsedSeconds: number,
  targetSeconds: number,
): DecimalString {
  return decimal(Decimal.min(valueProgress, durationProgress(elapsedSeconds, targetSeconds)));
}

function progressFor(
  operator: "LTE" | "GTE",
  current: DecimalString,
  target: DecimalString,
): DecimalString {
  const currentValue = new Decimal(current);
  const targetValue = new Decimal(target);
  if (operator === "LTE") {
    if (currentValue.lte(targetValue)) return decimal("1");
    if (targetValue.isNegative()) {
      return progressDown(current, decimal("0"), target);
    }
    return decimal("0");
  }

  if (currentValue.gte(targetValue)) return decimal("1");
  if (targetValue.isPositive()) {
    return progressUp(current, decimal("0"), target);
  }
  const distance = targetValue.minus(currentValue);
  const denominator = Decimal.max(targetValue.abs(), new Decimal("0.000000000001"));
  return decimal(
    Decimal.max(0, Decimal.min(1, new Decimal(1).minus(distance.dividedBy(denominator)))),
  );
}

function gapFor(
  operator: "LTE" | "GTE",
  current: DecimalString,
  target: DecimalString,
): DecimalString {
  const currentValue = new Decimal(current);
  const targetValue = new Decimal(target);
  if (operator === "LTE") {
    return decimal(Decimal.max(0, currentValue.minus(targetValue)));
  }
  return decimal(Decimal.max(0, targetValue.minus(currentValue)));
}

export function directionalCondition(input: {
  conditionId: string;
  modelId: "SELL" | "REBUY";
  modelVersion: string;
  current: Knowledge<DecimalString>;
  operator: "LTE" | "GTE";
  target: DecimalString;
  now: Timestamp;
  reason: string;
}): ConditionEvaluation {
  const targetKnowledge = known(input.target, input.now, [`config:${input.modelVersion}`]);
  if (input.current.state !== "KNOWN") {
    return {
      conditionId: input.conditionId,
      modelId: input.modelId,
      modelVersion: input.modelVersion,
      rawValue: input.current,
      normalizedProgress: unknown("Current value is not known", input.now),
      targetOperator: input.operator,
      targetValue: targetKnowledge,
      gapToTarget: unknown("Gap cannot be computed without a current value", input.now),
      state: "UNKNOWN",
      observedAt: input.now,
      expiresAt: expiresAfter(input.now),
      reason: input.current.reason,
      evidenceIds: [],
    };
  }

  const fresh = isFreshAt(input.current, input.now);
  const passed =
    input.operator === "LTE"
      ? new Decimal(input.current.value).lte(input.target)
      : new Decimal(input.current.value).gte(input.target);
  const state: ConditionState = fresh ? (passed ? "PASS" : "FAIL") : "STALE";

  return {
    conditionId: input.conditionId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    rawValue: input.current,
    normalizedProgress: known(
      progressFor(input.operator, input.current.value, input.target),
      input.now,
      input.current.evidenceIds,
    ),
    targetOperator: input.operator,
    targetValue: targetKnowledge,
    gapToTarget: known(
      gapFor(input.operator, input.current.value, input.target),
      input.now,
      input.current.evidenceIds,
    ),
    state,
    observedAt: input.now,
    expiresAt: input.current.expiresAt ?? expiresAfter(input.now),
    reason: fresh ? input.reason : "Current value is stale",
    evidenceIds: input.current.evidenceIds,
  };
}

export function booleanCondition(input: {
  conditionId: string;
  modelId: "SELL" | "REBUY";
  modelVersion: string;
  value: boolean | "UNKNOWN";
  now: Timestamp;
  passReason: string;
  failReason: string;
  evidenceIds: string[];
  veto?: boolean;
}): ConditionEvaluation {
  const state: ConditionState =
    input.value === "UNKNOWN" ? "UNKNOWN" : input.value ? "PASS" : input.veto ? "VETO" : "FAIL";
  const raw =
    input.value === "UNKNOWN"
      ? unknown("Boolean evidence is unknown", input.now)
      : known(decimal(input.value ? "1" : "0"), input.now, input.evidenceIds);
  return {
    conditionId: input.conditionId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    rawValue: raw,
    normalizedProgress:
      input.value === "UNKNOWN"
        ? unknown("Progress is unknown", input.now)
        : known(decimal(input.value ? "1" : "0"), input.now, input.evidenceIds),
    targetOperator: "EQ",
    targetValue: known(decimal("1"), input.now, [`config:${input.modelVersion}`]),
    gapToTarget:
      input.value === "UNKNOWN"
        ? unknown("Gap is unknown", input.now)
        : known(decimal(input.value ? "0" : "1"), input.now, input.evidenceIds),
    state,
    observedAt: input.now,
    expiresAt: expiresAfter(input.now),
    reason:
      input.value === "UNKNOWN"
        ? "Required evidence is unknown"
        : input.value
          ? input.passReason
          : input.failReason,
    evidenceIds: input.evidenceIds,
  };
}

export function compositeCondition(input: {
  conditionId: string;
  modelId: "SELL" | "REBUY";
  modelVersion: string;
  children: ConditionEvaluation[];
  now: Timestamp;
  passReason: string;
  failReason: string;
}): ConditionEvaluation {
  const passed = input.children.filter((condition) => condition.state === "PASS").length;
  const hasUnknown = input.children.some((condition) =>
    ["UNKNOWN", "STALE"].includes(condition.state),
  );
  const allPass = passed === input.children.length;
  const state: ConditionState = allPass ? "PASS" : hasUnknown ? "UNKNOWN" : "FAIL";
  const progressValues = input.children
    .map((condition) =>
      condition.normalizedProgress.state === "KNOWN"
        ? new Decimal(condition.normalizedProgress.value)
        : undefined,
    )
    .filter((value): value is Decimal => value !== undefined);
  const progress =
    progressValues.length === input.children.length
      ? known(
          decimal(Decimal.min(...progressValues)),
          input.now,
          input.children.flatMap(currentEvidenceIdsFromCondition),
        )
      : unknown("At least one component progress is unknown", input.now);
  const evidenceIds = [...new Set(input.children.flatMap((condition) => condition.evidenceIds))];

  return {
    conditionId: input.conditionId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    rawValue: known(decimal(passed), input.now, evidenceIds),
    normalizedProgress: progress,
    targetOperator: "ALL",
    targetValue: known(decimal(input.children.length), input.now, [`config:${input.modelVersion}`]),
    gapToTarget: known(decimal(input.children.length - passed), input.now, evidenceIds),
    state,
    observedAt: input.now,
    expiresAt: expiresAfter(input.now),
    reason: allPass ? input.passReason : input.failReason,
    evidenceIds,
  };
}

function currentEvidenceIdsFromCondition(condition: ConditionEvaluation): string[] {
  return condition.evidenceIds;
}
