import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BaseQuoteResearchSnapshotSchema,
  timestamp,
  TimestampSchema,
  type BaseQuoteResearchSnapshot,
  type Timestamp,
} from "@virtual/domain";
import { z } from "zod";

export const QuoteResearchJournalRecordSchema = z
  .object({
    recordId: z.string().regex(/^quote-record-[0-9a-f]{24}$/),
    recordedAt: TimestampSchema,
    latencyMs: z.number().finite().nonnegative(),
    snapshot: BaseQuoteResearchSnapshotSchema,
  })
  .strict();
export type QuoteResearchJournalRecord = z.infer<typeof QuoteResearchJournalRecordSchema>;

function recordId(snapshotId: string, recordedAt: Timestamp): string {
  const digest = createHash("sha256")
    .update(`${snapshotId}:${recordedAt}`)
    .digest("hex")
    .slice(0, 24);
  return `quote-record-${digest}`;
}

export class QuoteResearchJournal {
  readonly #records: QuoteResearchJournalRecord[];
  readonly #recordIds: Set<string>;

  private constructor(
    readonly path: string,
    records: QuoteResearchJournalRecord[],
  ) {
    this.#records = records;
    this.#recordIds = new Set(records.map(({ recordId: id }) => id));
    if (this.#recordIds.size !== records.length) {
      throw new Error("Quote research journal contains duplicate record IDs");
    }
  }

  static async open(path: string): Promise<QuoteResearchJournal> {
    let content = "";
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => QuoteResearchJournalRecordSchema.parse(JSON.parse(line)));
    return new QuoteResearchJournal(path, records);
  }

  async append(input: {
    snapshot: BaseQuoteResearchSnapshot;
    latencyMs: number;
    recordedAt?: Timestamp;
  }): Promise<QuoteResearchJournalRecord> {
    const recordedAt = input.recordedAt ?? timestamp(new Date());
    const record = QuoteResearchJournalRecordSchema.parse({
      recordId: recordId(input.snapshot.snapshotId, recordedAt),
      recordedAt,
      latencyMs: input.latencyMs,
      snapshot: input.snapshot,
    });
    if (this.#recordIds.has(record.recordId)) {
      throw new Error(`Duplicate quote research journal record: ${record.recordId}`);
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const handle = await open(this.path, "a", 0o600);
    try {
      await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const stored = structuredClone(record);
    this.#records.push(stored);
    this.#recordIds.add(stored.recordId);
    return structuredClone(stored);
  }

  list(): readonly QuoteResearchJournalRecord[] {
    return Object.freeze(this.#records.map((record) => structuredClone(record)));
  }
}
