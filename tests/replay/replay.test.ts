import { timestamp } from "@virtual/domain";
import {
  createReplayManifest,
  DeterministicReplay,
  replayManifestReport,
  type ReplayEvent,
} from "@virtual/replay";
import { describe, expect, it } from "vitest";

const events: ReplayEvent[] = [
  {
    eventId: "late-source-early-receive",
    sourceOccurredAt: timestamp("2026-08-22T08:00:00.000Z"),
    receivedAt: timestamp("2026-08-22T08:00:02.000Z"),
    ingestionSequence: 2,
    kind: "MARKET",
    payload: { price: "0.9" },
  },
  {
    eventId: "future-news",
    sourceOccurredAt: timestamp("2026-08-22T08:00:01.000Z"),
    receivedAt: timestamp("2026-08-22T08:00:05.000Z"),
    ingestionSequence: 3,
    kind: "NEWS",
    payload: { claim: "received later" },
  },
  {
    eventId: "first",
    sourceOccurredAt: timestamp("2026-08-22T07:59:59.000Z"),
    receivedAt: timestamp("2026-08-22T08:00:01.000Z"),
    ingestionSequence: 1,
    kind: "MARKET",
    payload: { price: "1" },
  },
];

describe("deterministic replay", () => {
  it("exposes only events received at or before the virtual clock", () => {
    const replay = new DeterministicReplay(events);
    const observedIds: string[][] = [];
    replay.runUntil(timestamp("2026-08-22T08:00:02.000Z"), (_event, context) => {
      observedIds.push(context.observedEvents.map((item) => item.eventId));
      expect(context.observedEvents.some((item) => item.eventId === "future-news")).toBe(false);
    });

    expect(observedIds).toEqual([["first"], ["first", "late-source-early-receive"]]);
    expect(replay.pendingCount()).toBe(1);
  });

  it("produces the same event order for incremental and batch replay", () => {
    const incremental = new DeterministicReplay(events);
    const incrementalOrder: string[] = [];
    incremental.runUntil(timestamp("2026-08-22T08:00:02.000Z"), (event) => {
      incrementalOrder.push(event.eventId);
    });
    incremental.runUntil(timestamp("2026-08-22T08:00:05.000Z"), (event) => {
      incrementalOrder.push(event.eventId);
    });

    const batch = new DeterministicReplay(events);
    const batchOrder: string[] = [];
    batch.runAll((event) => batchOrder.push(event.eventId));
    expect(incrementalOrder).toEqual(batchOrder);
  });

  it("refuses duplicate ingestion sequences and backwards time", () => {
    const duplicate = structuredClone(events);
    const second = duplicate[1];
    if (second === undefined) throw new Error("Missing second replay event");
    duplicate[1] = { ...second, ingestionSequence: 1 };
    expect(() => new DeterministicReplay(duplicate)).toThrow("sequences must be unique");

    const replay = new DeterministicReplay(events);
    replay.runUntil(timestamp("2026-08-22T08:00:02.000Z"), () => undefined);
    expect(() => replay.runUntil(timestamp("2026-08-22T08:00:01.000Z"), () => undefined)).toThrow(
      "cannot move backwards",
    );
  });

  it("uses ingestion sequence as the stable tie-breaker", () => {
    const first = events[0];
    const second = events[2];
    if (first === undefined || second === undefined) throw new Error("Missing fixture events");
    const tied: ReplayEvent[] = [
      {
        ...first,
        eventId: "sequence-2",
        ingestionSequence: 2,
        receivedAt: timestamp("2026-08-22T08:00:02.000Z"),
      },
      {
        ...second,
        eventId: "sequence-1",
        ingestionSequence: 1,
        receivedAt: timestamp("2026-08-22T08:00:02.000Z"),
      },
    ];
    const replay = new DeterministicReplay(tied);
    const order: string[] = [];
    replay.runAll((event) => order.push(event.eventId));
    expect(order).toEqual(["sequence-1", "sequence-2"]);
  });

  it("supports pause, resume, speed, seek, and step without result drift", () => {
    const replay = new DeterministicReplay(events, timestamp("2026-08-22T08:00:00.000Z"));
    replay.setSpeed(2);
    replay.resume();
    expect(replay.advanceWallTime(1_000, () => undefined)).toBe(2);
    replay.pause();
    expect(replay.advanceWallTime(10_000, () => undefined)).toBe(0);
    replay.seek(timestamp("2026-08-22T08:00:00.000Z"));
    expect(replay.observedEvents()).toHaveLength(0);
    expect(replay.step(() => undefined)).toBe(1);
    replay.resume();
    replay.runAll(() => undefined);
    expect(replay.observedEvents().map(({ eventId }) => eventId)).toEqual([
      "first",
      "late-source-early-receive",
      "future-news",
    ]);
  });

  it("creates stable input/config/model manifests and a readable report", () => {
    const input = {
      events,
      configHash: `sha256:${"a".repeat(64)}`,
      modelVersion: "sell-rebuy-v1",
      adapterVersions: { news: "1.0.0", market: "1.0.0" },
    };
    const first = createReplayManifest(input);
    const second = createReplayManifest({ ...input, events: [...events].reverse() });
    expect(first).toEqual(second);
    expect(replayManifestReport(first)).toContain(first.inputHash);
  });
});
