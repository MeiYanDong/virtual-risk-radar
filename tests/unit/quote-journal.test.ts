import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BaseQuoteResearchSnapshotSchema,
  QuoteProviderObservationSchema,
  timestamp,
} from "@virtual/domain";
import { QuoteResearchJournal } from "@virtual/storage";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingBaseQuoteResearchReader } from "../../apps/server/src/base-quote-reader";

const temporaryDirectories: string[] = [];

function providerObservation(providerKind: "AGGREGATOR" | "CANONICAL_POOL") {
  const since = "2026-08-22T12:00:00.000Z";
  const expiresAt = "2099-08-22T12:00:05.000Z";
  const unknownValue = { state: "UNKNOWN", reason: "fixture", since };
  return QuoteProviderObservationSchema.parse({
    observationId: `quote-${providerKind.toLowerCase()}`,
    providerId: providerKind === "AGGREGATOR" ? "velora" : "uniswap-v3",
    providerKind,
    chainProfileId: "base-mainnet-virtual-usdc-research-v1",
    side: "SELL_VIRTUAL",
    tokenInAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    tokenOutAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amountIn: "1000",
    expectedOut: "700",
    researchMinimumOut: "696.5",
    effectivePrice: "0.7",
    priceImpactBps: unknownValue,
    relativeSizeImpactBps: unknownValue,
    protocolFeeBps: unknownValue,
    routeFeesSettlement: unknownValue,
    totalCostPct: unknownValue,
    estimatedGasUsd: unknownValue,
    routeId: `${providerKind.toLowerCase()}:fixture`,
    poolAddresses: ["0x529d2863a1521d0b57db028168fde2e97120017c"],
    blockNumber: "123",
    blockLag: 0,
    observedAt: since,
    expiresAt,
    freshnessState: "FRESH",
    evidenceIds: ["quote-fixture"],
  });
}

function snapshot(
  snapshotId = "quote-snapshot-fixture",
  input: {
    quoteState?: "PASS" | "PARTIAL" | "BLOCKED";
    crossCheckState?: "PASS" | "FAIL" | "UNKNOWN" | "STALE";
    providersKnown?: boolean;
    expiresAt?: string;
  } = {},
) {
  const since = "2026-08-22T12:00:00.000Z";
  const expiresAt = input.expiresAt ?? "2099-08-22T12:00:05.000Z";
  const providerKnowledge = (providerKind: "AGGREGATOR" | "CANONICAL_POOL") =>
    input.providersKnown === true
      ? {
          state: "KNOWN" as const,
          value: providerObservation(providerKind),
          observedAt: since,
          expiresAt,
          evidenceIds: ["quote-fixture"],
        }
      : { state: "UNKNOWN" as const, reason: "fixture", since };
  return BaseQuoteResearchSnapshotSchema.parse({
    snapshotId,
    purpose: "RESEARCH_ONLY",
    chainProfileId: "base-mainnet-virtual-usdc-research-v1",
    networkScope: "eip155:8453",
    quoteState: input.quoteState ?? "BLOCKED",
    identityState: "PASS",
    virtualTokenAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    settlementAssetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    settlementAssetSymbol: "USDC",
    fixedAmountsVirtual: ["1000"],
    researchSlippageBps: "50",
    maximumCrossSourceDeviationBps: "100",
    maximumBlockLag: 2,
    expirySeconds: 5,
    walletState: "NOT_REQUIRED_FIXED_TEST_AMOUNTS",
    quoteLimitsState: "UNSET",
    economicEvidence: "POSITIVE_EV_NOT_PROVEN",
    scenarios: [
      {
        scenarioId: "base-sell-1000-virtual",
        amountInVirtual: "1000",
        aggregator: providerKnowledge("AGGREGATOR"),
        canonicalPool: providerKnowledge("CANONICAL_POOL"),
        crossSourceDeviationBps:
          input.crossCheckState === "PASS" || input.crossCheckState === "STALE"
            ? {
                state: "KNOWN",
                value: "10",
                observedAt: since,
                expiresAt,
                evidenceIds: ["quote-fixture"],
              }
            : { state: "UNKNOWN", reason: "fixture", since },
        crossCheckState: input.crossCheckState ?? "UNKNOWN",
        crossCheckReason: "Fixture has no live provider",
      },
    ],
    observedAt: "2026-08-22T12:00:00.000Z",
    expiresAt,
    evidenceIds: ["quote-fixture"],
    limitations: ["Research only"],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("quote research evidence recording", () => {
  it("fsyncs schema-validated snapshots to a private append-only JSONL journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-journal-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "quotes.jsonl");
    const journal = await QuoteResearchJournal.open(path);
    await journal.append({ snapshot: snapshot(), latencyMs: 12.5 });

    const reopened = await QuoteResearchJournal.open(path);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0]).toMatchObject({
      latencyMs: 12.5,
      snapshot: { purpose: "RESEARCH_ONLY", walletState: "NOT_REQUIRED_FIXED_TEST_AMOUNTS" },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects duplicate records both before append and while reopening evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-duplicate-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "quotes.jsonl");
    const journal = await QuoteResearchJournal.open(path);
    const recordedAt = timestamp("2026-08-22T12:00:01.000Z");
    await journal.append({ snapshot: snapshot(), latencyMs: 5, recordedAt });

    await expect(
      journal.append({ snapshot: snapshot(), latencyMs: 5, recordedAt }),
    ).rejects.toThrow("Duplicate quote research journal record");

    const line = await readFile(path, "utf8");
    await writeFile(path, `${line}${line}`, { mode: 0o600 });
    await expect(QuoteResearchJournal.open(path)).rejects.toThrow("contains duplicate record IDs");
  });

  it("deduplicates concurrent reads, records once, and exposes measured coverage stats", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-recorder-"));
    temporaryDirectories.push(directory);
    const journal = await QuoteResearchJournal.open(join(directory, "quotes.jsonl"));
    let calls = 0;
    const recorder = new RecordingBaseQuoteResearchReader({
      reader: {
        snapshot: async () => {
          calls += 1;
          await Promise.resolve();
          return snapshot();
        },
      },
      journal,
      minimumRefreshMs: 10_000,
    });

    await Promise.all([recorder.snapshot(), recorder.snapshot(), recorder.snapshot()]);
    await recorder.snapshot();
    expect(calls).toBe(1);
    expect(journal.list()).toHaveLength(1);
    expect(recorder.stats()).toMatchObject({
      attempts: 1,
      successes: 1,
      errors: 0,
      blockedSnapshots: 1,
      scenariosObserved: 1,
      crossChecksPassed: 0,
      lastSuccessAt: expect.any(String),
    });
  });

  it("counts pass, partial, blocked, provider, pass, and stale scenario branches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-stats-"));
    temporaryDirectories.push(directory);
    const journal = await QuoteResearchJournal.open(join(directory, "quotes.jsonl"));
    const queue = [
      snapshot("pass-snapshot", {
        quoteState: "PASS",
        crossCheckState: "PASS",
        providersKnown: true,
      }),
      snapshot("partial-snapshot", {
        quoteState: "PARTIAL",
        crossCheckState: "STALE",
        providersKnown: true,
      }),
      snapshot("blocked-snapshot"),
    ];
    const recorder = new RecordingBaseQuoteResearchReader({
      reader: {
        snapshot: async () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("No fixture snapshot left");
          return next;
        },
      },
      journal,
      minimumRefreshMs: 0,
    });

    expect(recorder.stats()).toMatchObject({
      attempts: 0,
      latencyP50Ms: null,
      latencyP95Ms: null,
      latencyP99Ms: null,
    });
    await recorder.snapshot();
    await recorder.snapshot();
    await recorder.snapshot();
    expect(recorder.stats()).toMatchObject({
      attempts: 3,
      successes: 3,
      passSnapshots: 1,
      partialSnapshots: 1,
      blockedSnapshots: 1,
      scenariosObserved: 3,
      aggregatorKnown: 2,
      canonicalPoolKnown: 2,
      crossChecksPassed: 1,
      crossChecksStale: 1,
      latencyP50Ms: expect.any(Number),
      latencyP95Ms: expect.any(Number),
      latencyP99Ms: expect.any(Number),
    });
  });

  it("refreshes an expired cache and rejects invalid refresh intervals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-expiry-"));
    temporaryDirectories.push(directory);
    const journal = await QuoteResearchJournal.open(join(directory, "quotes.jsonl"));
    let calls = 0;
    const recorder = new RecordingBaseQuoteResearchReader({
      reader: {
        snapshot: async () => {
          calls += 1;
          return snapshot(`expired-${calls}`, { expiresAt: "2026-08-22T12:00:05.000Z" });
        },
      },
      journal,
      minimumRefreshMs: 10_000,
    });
    await recorder.snapshot();
    await recorder.snapshot();
    expect(calls).toBe(2);
    expect(
      () =>
        new RecordingBaseQuoteResearchReader({
          reader: { snapshot: async () => snapshot() },
          journal,
          minimumRefreshMs: -1,
        }),
    ).toThrow("non-negative");
  });

  it("does not hide reader errors or count them as stored quote evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-error-"));
    temporaryDirectories.push(directory);
    const journal = await QuoteResearchJournal.open(join(directory, "quotes.jsonl"));
    const recorder = new RecordingBaseQuoteResearchReader({
      reader: { snapshot: async () => Promise.reject(new Error("provider unavailable")) },
      journal,
    });

    await expect(recorder.snapshot()).rejects.toThrow("provider unavailable");
    expect(journal.list()).toHaveLength(0);
    expect(recorder.stats()).toMatchObject({
      attempts: 1,
      successes: 0,
      errors: 1,
      lastErrorReason: "provider unavailable",
    });
  });

  it("classifies a non-Error rejection without fabricating provider detail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-quote-unknown-error-"));
    temporaryDirectories.push(directory);
    const journal = await QuoteResearchJournal.open(join(directory, "quotes.jsonl"));
    const recorder = new RecordingBaseQuoteResearchReader({
      reader: { snapshot: async () => Promise.reject("opaque rejection") },
      journal,
    });
    await expect(recorder.snapshot()).rejects.toBe("opaque rejection");
    expect(recorder.stats().lastErrorReason).toBe("Unknown quote error");
  });
});
