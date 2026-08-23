import { timestamp } from "@virtual/domain";
import { V3ShadowJournalRecordSchema, type V3ShadowJournalRecord } from "@virtual/storage";
import { describe, expect, it } from "vitest";
import { summarizeV3Shadow } from "../../scripts/report-v3-shadow";

function record(
  sequence: number,
  kind: V3ShadowJournalRecord["kind"],
  recordedAt: string,
  payload: Record<string, unknown> = {},
): V3ShadowJournalRecord {
  return V3ShadowJournalRecordSchema.parse({
    schemaVersion: "3.0.0",
    sequence,
    recordId: `v3-shadow-${sequence}-${sequence.toString(16).padStart(16, "0")}`,
    kind,
    recordedAt,
    payloadHash: `sha256:${"0".repeat(64)}`,
    payload,
  });
}

describe("v0.3 Shadow progress reporting", () => {
  it("counts only contiguous source snapshots and never auto-passes elapsed validation", () => {
    const report = summarizeV3Shadow(
      [
        record(1, "RUNTIME_START", "2026-08-23T10:00:00.000Z"),
        record(2, "SOURCE_SNAPSHOT", "2026-08-23T10:00:10.000Z", { soak: { ok: true } }),
        record(3, "SOURCE_SNAPSHOT", "2026-08-23T10:00:20.000Z", { soak: { ok: true } }),
        record(4, "SOURCE_SNAPSHOT", "2026-08-23T10:02:00.000Z", { soak: { ok: true } }),
      ],
      timestamp("2026-08-23T10:02:01.000Z"),
    );
    expect(report["latestSession"]).toMatchObject({
      status: "IN_PROGRESS",
      elapsedMs: 121_000,
      elapsedRequirementMet: false,
      acceptanceStatus: "IN_PROGRESS",
    });
    expect(report["shadowValidation"]).toMatchObject({
      contiguousObservedMs: 10_000,
      elapsedRequirementMet: false,
      conclusion: "IN_PROGRESS",
    });
  });

  it("marks an unclosed but stale session as stopped instead of pretending it still runs", () => {
    const report = summarizeV3Shadow(
      [record(1, "RUNTIME_START", "2026-08-23T10:00:00.000Z")],
      timestamp("2026-08-23T10:01:00.000Z"),
    );
    expect(report["latestSession"]).toMatchObject({ status: "STOPPED_OR_STALE" });
  });
});
