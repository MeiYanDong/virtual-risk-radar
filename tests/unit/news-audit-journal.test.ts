import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateNewsAuditJudgment } from "@virtual/decision";
import { timestamp } from "@virtual/domain";
import { normalizeTechFlowItem } from "@virtual/news";
import { NewsAuditJournal } from "@virtual/storage";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function record(id: number, receivedAt: string, revision = 0, abstract = "普通项目新闻") {
  const received = timestamp(receivedAt);
  const item = normalizeTechFlowItem({
    item: {
      id,
      title: `新闻 ${id}`,
      abstract,
      source: "fixture",
      url: `https://example.com/${id}`,
      created_at: receivedAt,
      updated_at: receivedAt,
      category: { id: 1, name: "fixture" },
      content_categories: [],
    },
    receivedAt: received,
    accessedAt: received,
    revision,
    bodyExcerptCharacters: 600,
  });
  return {
    item,
    judgment: evaluateNewsAuditJudgment({
      item,
      now: received,
      armWindowSeconds: 7_200,
      modelVersion: "0.3.0",
      configVersion: "0.3.2",
    }),
  };
}

describe("private append-only news audit journal", () => {
  it("is idempotent, preserves revisions, restarts, and uses 0600 permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-news-audit-"));
    directories.push(directory);
    const path = join(directory, "audit.jsonl");
    const now = new Date("2026-08-23T10:00:00.000Z");
    const journal = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    const first = record(8001, "2026-08-23T09:00:00.000Z");
    const revised = record(8001, "2026-08-23T09:05:00.000Z", 1, "内容已经修改");

    await journal.append(first);
    await journal.append(first);
    await journal.append(revised);
    await journal.flush();
    expect(await journal.list()).toHaveLength(2);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const restarted = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    expect((await restarted.list()).map(({ item }) => item.revision)).toEqual([0, 1]);
  });

  it("removes records older than the configured 180-day retention window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-news-retention-"));
    directories.push(directory);
    const path = join(directory, "audit.jsonl");
    let now = new Date("2026-08-23T10:00:00.000Z");
    const journal = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    await journal.append(record(8002, "2026-02-25T10:00:00.000Z"));
    expect(await journal.list()).toHaveLength(1);

    now = new Date("2026-08-25T10:00:00.001Z");
    await journal.append(record(8003, "2026-08-25T10:00:00.000Z"));
    expect((await journal.list()).map(({ item }) => item.sourceItemId)).toEqual(["8003"]);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("rejects a changed judgment for the same immutable news revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-news-immutable-"));
    directories.push(directory);
    const path = join(directory, "audit.jsonl");
    const now = new Date("2026-08-23T10:00:00.000Z");
    const journal = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    const first = record(8005, "2026-08-23T09:00:00.000Z");
    await journal.append(first);

    await expect(
      journal.append({
        ...first,
        judgment: {
          ...first.judgment,
          summary: "这不是首次接收时生成的原始判断",
        },
      }),
    ).rejects.toThrow("Immutable news audit judgment conflict");
    expect(await journal.list()).toHaveLength(1);
  });

  it("fails visibly when persisted audit content no longer matches its record hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "virtual-news-corrupt-"));
    directories.push(directory);
    const path = join(directory, "audit.jsonl");
    const now = new Date("2026-08-23T10:00:00.000Z");
    const journal = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    await journal.append(record(8004, "2026-08-23T09:00:00.000Z"));
    await journal.flush();
    const persisted = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    persisted["recordHash"] = `sha256:${"0".repeat(64)}`;
    await writeFile(path, `${JSON.stringify(persisted)}\n`, "utf8");
    await chmod(path, 0o600);

    const corrupted = new NewsAuditJournal(path, { retentionDays: 180, now: () => now });
    await expect(corrupted.list()).rejects.toThrow("hash mismatch");
  });
});
