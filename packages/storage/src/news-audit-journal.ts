import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  HashSchema,
  V3NewsAuditJudgmentSchema,
  V3NewsAuditRecordSchema,
  V3NewsItemSchema,
  type V3NewsAuditJudgment,
  type V3NewsAuditRecord,
  type V3NewsItem,
} from "@virtual/domain";

export type NewsAuditJournalInput = {
  item: V3NewsItem;
  judgment: V3NewsAuditJudgment;
};

export type NewsAuditJournalOptions = {
  retentionDays: number;
  now?: () => Date;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function digest(value: unknown) {
  return HashSchema.parse(
    `sha256:${createHash("sha256")
      .update(JSON.stringify(canonicalize(value)))
      .digest("hex")}`,
  );
}

function recordFrom(input: NewsAuditJournalInput): V3NewsAuditRecord {
  const item = V3NewsItemSchema.parse(input.item);
  const judgment = V3NewsAuditJudgmentSchema.parse(input.judgment);
  const recordId = `news-audit-${item.sourceItemId}-r${item.revision}-${item.rawTextHash.slice(-12)}`;
  return V3NewsAuditRecordSchema.parse({
    schemaVersion: "1.0.0",
    recordId,
    recordHash: digest({ item, judgment }),
    item,
    judgment,
  });
}

function verifyRecord(record: V3NewsAuditRecord): void {
  if (record.recordHash !== digest({ item: record.item, judgment: record.judgment })) {
    throw new Error(`News audit journal hash mismatch: ${record.recordId}`);
  }
}

export class NewsAuditJournal {
  readonly #records: V3NewsAuditRecord[] = [];
  readonly #ids = new Set<string>();
  readonly #ready: Promise<void>;
  readonly #options: NewsAuditJournalOptions;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    readonly path: string,
    options: NewsAuditJournalOptions,
  ) {
    if (!Number.isInteger(options.retentionDays) || options.retentionDays <= 0) {
      throw new Error("News audit retentionDays must be a positive integer");
    }
    this.#options = options;
    this.#ready = this.#load();
  }

  append(input: NewsAuditJournalInput): Promise<V3NewsAuditRecord> {
    let result: V3NewsAuditRecord | undefined;
    const operation = this.#tail.then(async () => {
      await this.#ready;
      const record = recordFrom(input);
      const existing = this.#records.find(({ recordId }) => recordId === record.recordId);
      if (existing !== undefined) {
        if (existing.recordHash !== record.recordHash) {
          throw new Error(
            `Immutable news audit judgment conflict: ${record.recordId}; create a separate replay result instead`,
          );
        }
        result = structuredClone(existing);
        return;
      }
      const retained = this.#retainedAt((this.#options.now ?? (() => new Date()))());
      const pruned = retained.length !== this.#records.length;
      if (pruned) {
        retained.push(record);
        await this.#rewrite(retained);
        this.#replace(retained);
      } else {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const handle = await open(this.path, "a", 0o600);
        try {
          await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await chmod(this.path, 0o600);
        this.#records.push(structuredClone(record));
        this.#ids.add(record.recordId);
      }
      result = structuredClone(record);
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.then(() => {
      if (result === undefined) throw new Error("News audit append completed without a record");
      return result;
    });
  }

  async list(): Promise<readonly V3NewsAuditRecord[]> {
    await this.flush();
    return Object.freeze(this.#records.map((record) => structuredClone(record)));
  }

  async flush(): Promise<void> {
    await this.#ready;
    await this.#tail;
  }

  #retainedAt(now: Date): V3NewsAuditRecord[] {
    const cutoff = now.getTime() - this.#options.retentionDays * 86_400_000;
    return this.#records
      .filter(({ judgment }) => Date.parse(judgment.judgedAt) >= cutoff)
      .map((record) => structuredClone(record));
  }

  async #load(): Promise<void> {
    let content = "";
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parsed = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => V3NewsAuditRecordSchema.parse(JSON.parse(line)));
    for (const record of parsed) {
      verifyRecord(record);
      if (this.#ids.has(record.recordId)) {
        throw new Error(`Duplicate news audit record: ${record.recordId}`);
      }
      this.#ids.add(record.recordId);
      this.#records.push(structuredClone(record));
    }
    const retained = this.#retainedAt((this.#options.now ?? (() => new Date()))());
    if (retained.length !== this.#records.length) {
      await this.#rewrite(retained);
      this.#replace(retained);
    } else if (this.#records.length > 0) {
      await chmod(this.path, 0o600);
    }
  }

  async #rewrite(records: readonly V3NewsAuditRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(
      temporaryPath,
      records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }

  #replace(records: readonly V3NewsAuditRecord[]): void {
    this.#records.splice(
      0,
      this.#records.length,
      ...records.map((record) => structuredClone(record)),
    );
    this.#ids.clear();
    for (const record of this.#records) this.#ids.add(record.recordId);
  }
}
