import Decimal from "decimal.js";
import {
  decimal,
  known,
  timestamp,
  unknown,
  type DecimalString,
  type DerivativeObservation,
  type Knowledge,
  type Timestamp,
} from "@virtual/domain";

export class ConsecutiveConditionTracker {
  readonly #evidenceIds = new Set<string>();
  #heldSince: Timestamp | undefined;
  #lastObservedAt: Timestamp | undefined;

  observe(input: {
    state: boolean | "UNKNOWN" | "STALE" | "ERROR";
    observedAt: Timestamp;
    evidenceIds: string[];
  }): void {
    if (
      this.#lastObservedAt !== undefined &&
      Date.parse(input.observedAt) < Date.parse(this.#lastObservedAt)
    ) {
      throw new RangeError("Condition tracker cannot observe time backwards");
    }
    this.#lastObservedAt = input.observedAt;
    if (input.state !== true) {
      this.#heldSince = undefined;
      this.#evidenceIds.clear();
      return;
    }
    this.#heldSince ??= input.observedAt;
    for (const evidenceId of input.evidenceIds) this.#evidenceIds.add(evidenceId);
  }

  durationAt(asOf: Timestamp): Knowledge<number> {
    if (this.#heldSince === undefined) {
      return unknown("Condition is not continuously true", asOf);
    }
    if (Date.parse(asOf) < Date.parse(this.#heldSince)) {
      throw new RangeError("Condition duration cannot query future-held state");
    }
    return known(Math.floor((Date.parse(asOf) - Date.parse(this.#heldSince)) / 1_000), asOf, [
      ...this.#evidenceIds,
    ]);
  }
}

export class RunningLowTracker {
  readonly #startedAt: Timestamp;
  #low?: DecimalString;
  #lastLowAt?: Timestamp;
  readonly #evidenceIds = new Set<string>();

  constructor(startedAt: Timestamp) {
    this.#startedAt = startedAt;
  }

  observe(input: { price: DecimalString; receivedAt: Timestamp; evidenceIds: string[] }): void {
    if (Date.parse(input.receivedAt) < Date.parse(this.#startedAt)) return;
    if (
      this.#lastLowAt !== undefined &&
      Date.parse(input.receivedAt) < Date.parse(this.#lastLowAt)
    ) {
      throw new RangeError("Running low cannot consume data before its current low observation");
    }
    if (this.#low === undefined || new Decimal(input.price).lt(this.#low)) {
      this.#low = input.price;
      this.#lastLowAt = input.receivedAt;
      this.#evidenceIds.clear();
      for (const evidenceId of input.evidenceIds) this.#evidenceIds.add(evidenceId);
    }
  }

  snapshot(asOf: Timestamp): {
    low: Knowledge<DecimalString>;
    secondsSinceLastLow: Knowledge<number>;
  } {
    if (this.#low === undefined || this.#lastLowAt === undefined) {
      return {
        low: unknown("No event price is visible after risk arm", asOf),
        secondsSinceLastLow: unknown("No event low exists", asOf),
      };
    }
    if (Date.parse(asOf) < Date.parse(this.#lastLowAt)) {
      throw new RangeError("Running low cannot be queried before the last observed low");
    }
    const evidenceIds = [...this.#evidenceIds];
    return {
      low: known(this.#low, this.#lastLowAt, evidenceIds),
      secondsSinceLastLow: known(
        Math.floor((Date.parse(asOf) - Date.parse(this.#lastLowAt)) / 1_000),
        asOf,
        evidenceIds,
      ),
    };
  }
}

export type FrozenOiBaseline = {
  riskEventId: string;
  riskRevision: number;
  riskArmedAt: Timestamp;
  baseline: Knowledge<DecimalString>;
};

export function freezeOiBaseline(input: {
  riskEventId: string;
  riskRevision: number;
  riskArmedAt: Timestamp;
  observations: DerivativeObservation[];
  freshnessSeconds: number;
}): FrozenOiBaseline {
  const armedAtMs = Date.parse(input.riskArmedAt);
  const eligible = input.observations
    .filter((observation) => {
      const observedAtMs = Date.parse(observation.observedAt);
      return (
        observedAtMs <= armedAtMs &&
        armedAtMs - observedAtMs <= input.freshnessSeconds * 1_000 &&
        observation.openInterestContracts.state === "KNOWN" &&
        Date.parse(observation.receivedAt) <= armedAtMs
      );
    })
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
  const latest = eligible[0];
  const baseline =
    latest?.openInterestContracts.state === "KNOWN"
      ? known(
          latest.openInterestContracts.value,
          latest.openInterestContracts.observedAt,
          [latest.observationId, ...latest.evidenceIds],
          latest.openInterestContracts.expiresAt,
        )
      : unknown("No fresh pre-arm OI contracts snapshot exists", input.riskArmedAt);
  return {
    riskEventId: input.riskEventId,
    riskRevision: input.riskRevision,
    riskArmedAt: input.riskArmedAt,
    baseline,
  };
}

export function secondsAfter(value: Timestamp, seconds: number): Timestamp {
  return timestamp(new Date(Date.parse(value) + seconds * 1_000));
}

export function decimalSeconds(value: number): DecimalString {
  return decimal(value);
}
