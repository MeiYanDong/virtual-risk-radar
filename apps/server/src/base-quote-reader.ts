import { timestamp, type BaseQuoteResearchSnapshot, type Timestamp } from "@virtual/domain";
import type { QuoteResearchJournal } from "@virtual/storage";

export type QuoteResearchRecorderStats = {
  startedAt: Timestamp;
  attempts: number;
  successes: number;
  errors: number;
  passSnapshots: number;
  partialSnapshots: number;
  blockedSnapshots: number;
  scenariosObserved: number;
  aggregatorKnown: number;
  canonicalPoolKnown: number;
  crossChecksPassed: number;
  crossChecksStale: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  lastSuccessAt: Timestamp | null;
  lastErrorAt: Timestamp | null;
  lastErrorReason: string | null;
};

type QuoteResearchReader = {
  snapshot(): Promise<BaseQuoteResearchSnapshot>;
};

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? null;
}

export class RecordingBaseQuoteResearchReader {
  readonly #reader: QuoteResearchReader;
  readonly #journal: QuoteResearchJournal;
  readonly #minimumRefreshMs: number;
  readonly #startedAt = timestamp(new Date());
  readonly #latencies: number[] = [];
  #lastSnapshot: BaseQuoteResearchSnapshot | undefined;
  #lastAttemptStartedAtMs = Number.NEGATIVE_INFINITY;
  #inFlight: Promise<BaseQuoteResearchSnapshot> | undefined;
  #attempts = 0;
  #successes = 0;
  #errors = 0;
  #passSnapshots = 0;
  #partialSnapshots = 0;
  #blockedSnapshots = 0;
  #scenariosObserved = 0;
  #aggregatorKnown = 0;
  #canonicalPoolKnown = 0;
  #crossChecksPassed = 0;
  #crossChecksStale = 0;
  #lastSuccessAt: Timestamp | null = null;
  #lastErrorAt: Timestamp | null = null;
  #lastErrorReason: string | null = null;

  constructor(input: {
    reader: QuoteResearchReader;
    journal: QuoteResearchJournal;
    minimumRefreshMs?: number;
  }) {
    this.#reader = input.reader;
    this.#journal = input.journal;
    this.#minimumRefreshMs = input.minimumRefreshMs ?? 3_000;
    if (!Number.isFinite(this.#minimumRefreshMs) || this.#minimumRefreshMs < 0) {
      throw new RangeError("minimumRefreshMs must be non-negative");
    }
  }

  async snapshot(): Promise<BaseQuoteResearchSnapshot> {
    const now = Date.now();
    if (
      this.#lastSnapshot !== undefined &&
      now - this.#lastAttemptStartedAtMs < this.#minimumRefreshMs &&
      Date.parse(this.#lastSnapshot.expiresAt) > now
    ) {
      return structuredClone(this.#lastSnapshot);
    }
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = undefined;
    });
    return structuredClone(await this.#inFlight);
  }

  async #refresh(): Promise<BaseQuoteResearchSnapshot> {
    this.#attempts += 1;
    this.#lastAttemptStartedAtMs = Date.now();
    const startedAt = performance.now();
    try {
      const snapshot = await this.#reader.snapshot();
      const latencyMs = performance.now() - startedAt;
      await this.#journal.append({ snapshot, latencyMs });
      this.#lastSnapshot = structuredClone(snapshot);
      this.#successes += 1;
      this.#latencies.push(latencyMs);
      if (snapshot.quoteState === "PASS") this.#passSnapshots += 1;
      if (snapshot.quoteState === "PARTIAL") this.#partialSnapshots += 1;
      if (snapshot.quoteState === "BLOCKED") this.#blockedSnapshots += 1;
      this.#scenariosObserved += snapshot.scenarios.length;
      this.#aggregatorKnown += snapshot.scenarios.filter(
        ({ aggregator }) => aggregator.state === "KNOWN",
      ).length;
      this.#canonicalPoolKnown += snapshot.scenarios.filter(
        ({ canonicalPool }) => canonicalPool.state === "KNOWN",
      ).length;
      this.#crossChecksPassed += snapshot.scenarios.filter(
        ({ crossCheckState }) => crossCheckState === "PASS",
      ).length;
      this.#crossChecksStale += snapshot.scenarios.filter(
        ({ crossCheckState }) => crossCheckState === "STALE",
      ).length;
      this.#lastSuccessAt = timestamp(new Date());
      this.#lastErrorReason = null;
      return snapshot;
    } catch (error) {
      this.#errors += 1;
      this.#lastErrorAt = timestamp(new Date());
      this.#lastErrorReason = error instanceof Error ? error.message : "Unknown quote error";
      throw error;
    }
  }

  stats(): QuoteResearchRecorderStats {
    return {
      startedAt: this.#startedAt,
      attempts: this.#attempts,
      successes: this.#successes,
      errors: this.#errors,
      passSnapshots: this.#passSnapshots,
      partialSnapshots: this.#partialSnapshots,
      blockedSnapshots: this.#blockedSnapshots,
      scenariosObserved: this.#scenariosObserved,
      aggregatorKnown: this.#aggregatorKnown,
      canonicalPoolKnown: this.#canonicalPoolKnown,
      crossChecksPassed: this.#crossChecksPassed,
      crossChecksStale: this.#crossChecksStale,
      latencyP50Ms: percentile(this.#latencies, 0.5),
      latencyP95Ms: percentile(this.#latencies, 0.95),
      latencyP99Ms: percentile(this.#latencies, 0.99),
      lastSuccessAt: this.#lastSuccessAt,
      lastErrorAt: this.#lastErrorAt,
      lastErrorReason: this.#lastErrorReason,
    };
  }
}
