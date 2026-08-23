import { mkdtemp, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashSchema, timestamp } from "@virtual/domain";
import {
  AppendOnlyLedger,
  FileAppendOnlyLedger,
  latencyMilliseconds,
  SqliteAppendOnlyLedger,
  TypedEventBus,
  type LedgerEvent,
  ledgerEvent,
} from "@virtual/storage";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const payloadHash = HashSchema.parse(`sha256:${"0".repeat(64)}`);

function event(sequence: number, eventId: string, parentEventId?: string): LedgerEvent {
  return ledgerEvent({
    eventId,
    ...(parentEventId === undefined ? {} : { parentEventId }),
    eventType: parentEventId === undefined ? "SOURCE_OBSERVED" : "CORRECTION_APPENDED",
    ingestionSequence: sequence,
    source: "test",
    schemaVersion: "1.0.0",
    eventTime: timestamp("2026-08-22T08:00:00.000Z"),
    observedAt: timestamp("2026-08-22T08:00:01.000Z"),
    payloadHash,
    evidenceLevel: "TESTED",
    payload: { value: sequence },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("append-only ledger", () => {
  it("requires contiguous sequences and explicit correction events", () => {
    const ledger = new AppendOnlyLedger();
    ledger.append(event(1, "event-1"));
    ledger.append(event(2, "event-2", "event-1"));

    expect(ledger.list()).toHaveLength(2);
    expect(ledger.list()[0]?.payload).toEqual({ value: 1 });
    expect(() => ledger.append(event(4, "event-4"))).toThrow("expected 3");
    expect(() => ledger.append(event(3, "event-1"))).toThrow("Duplicate");
    expect(() => ledger.append(event(3, "event-3", "missing"))).toThrow("Unknown parent");
  });

  it("rejects evidence that claims it was observed before it happened", () => {
    const invalid = {
      ...event(1, "future-event"),
      eventTime: timestamp("2026-08-22T08:00:02.000Z"),
      observedAt: timestamp("2026-08-22T08:00:01.000Z"),
    };
    expect(() => new AppendOnlyLedger().append(invalid)).toThrow(
      "eventTime cannot be later than observedAt",
    );
  });

  it("returns clones so callers cannot rewrite stored evidence", () => {
    const ledger = new AppendOnlyLedger([event(1, "event-1")]);
    const returned = ledger.list()[0];
    if (returned === undefined) throw new Error("Missing event");
    Object.assign(returned.payload, { value: 999 });
    expect(ledger.list()[0]?.payload).toEqual({ value: 1 });
  });

  it("persists one JSONL record per fsynced append and can reopen it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-ledger-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ledger.jsonl");
    const ledger = await FileAppendOnlyLedger.open(path);
    await ledger.append(event(1, "event-1"));
    await ledger.append(event(2, "event-2", "event-1"));

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const reopened = await FileAppendOnlyLedger.open(path);
    expect(reopened.list().map((item) => item.eventId)).toEqual(["event-1", "event-2"]);
  });

  it("persists an immutable SQLite ledger with update/delete triggers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-sqlite-ledger-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ledger.sqlite");
    const ledger = new SqliteAppendOnlyLedger(path);
    ledger.append(event(1, "event-1"));
    ledger.append(event(2, "event-2", "event-1"));
    expect(ledger.list().map(({ eventId }) => eventId)).toEqual(["event-1", "event-2"]);
    ledger.close();

    const raw = new DatabaseSync(path);
    expect(() =>
      raw.exec("UPDATE ledger_events SET source = 'mutated' WHERE event_id = 'event-1'"),
    ).toThrow("forbids UPDATE");
    expect(() => raw.exec("DELETE FROM ledger_events WHERE event_id = 'event-1'")).toThrow(
      "forbids DELETE",
    );
    raw.close();
  });

  it("restores event sequence and separates wall time from monotonic time", () => {
    type Events = { observed: { id: string } };
    const bus = new TypedEventBus<Events>(41);
    const seen: number[] = [];
    const unsubscribe = bus.subscribe("observed", ({ ingestionSequence }) => {
      seen.push(ingestionSequence);
    });
    const envelope = bus.publish("observed", { id: "one" });
    unsubscribe();
    bus.publish("observed", { id: "two" });
    expect(envelope.ingestionSequence).toBe(42);
    expect(envelope.monotonicMilliseconds).toBeGreaterThanOrEqual(0);
    expect(seen).toEqual([42]);
    expect(bus.latestSequence()).toBe(43);
  });

  it("measures each ingestion latency segment without hiding negative clocks", () => {
    expect(
      latencyMilliseconds({
        sourceOccurredAt: "2026-08-22T08:00:00.000Z",
        receivedAt: "2026-08-22T08:00:00.100Z",
        normalizedAt: "2026-08-22T08:00:00.125Z",
        decidedAt: "2026-08-22T08:00:00.150Z",
      }),
    ).toEqual({ sourceToReceive: 100, receiveToNormalize: 25, normalizeToDecision: 25 });
    expect(() =>
      latencyMilliseconds({
        sourceOccurredAt: "2026-08-22T08:00:01.000Z",
        receivedAt: "2026-08-22T08:00:00.000Z",
        normalizedAt: "2026-08-22T08:00:00.000Z",
        decidedAt: "2026-08-22T08:00:00.000Z",
      }),
    ).toThrow("monotonic");
  });
});
