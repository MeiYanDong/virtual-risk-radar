import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timestamp } from "@virtual/domain";
import { V3ShadowJournal } from "@virtual/storage";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function journalPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "virtual-v3-journal-"));
  directories.push(directory);
  return join(directory, "nested", "shadow.jsonl");
}

describe("v0.3 append-only Shadow journal", () => {
  it("serializes concurrent appends, fsyncs a private file, and resumes sequence", async () => {
    const path = await journalPath();
    const journal = new V3ShadowJournal(path);
    await Promise.all([
      journal.append({
        kind: "RUNTIME_START",
        recordedAt: timestamp("2026-08-23T10:00:00.000Z"),
        payload: { sources: 2 },
      }),
      journal.append({
        kind: "SOURCE_SNAPSHOT",
        recordedAt: timestamp("2026-08-23T10:00:10.000Z"),
        payload: { healthy: true },
      }),
    ]);
    await journal.flush();
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const resumed = new V3ShadowJournal(path);
    const third = await resumed.append({
      kind: "RUNTIME_STOP",
      recordedAt: timestamp("2026-08-23T10:00:20.000Z"),
      payload: { reason: "test" },
    });
    expect(third.sequence).toBe(3);
    expect((await resumed.list()).map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
  });

  it("rejects a tampered payload instead of accepting an unauditable history", async () => {
    const path = await journalPath();
    const journal = new V3ShadowJournal(path);
    await journal.append({
      kind: "RUNTIME_START",
      recordedAt: timestamp("2026-08-23T10:00:00.000Z"),
      payload: { sources: 2 },
    });
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace('"sources":2', '"sources":3'), "utf8");
    const reopened = new V3ShadowJournal(path);
    await expect(reopened.list()).rejects.toThrow("payload hash mismatch");
  });
});
