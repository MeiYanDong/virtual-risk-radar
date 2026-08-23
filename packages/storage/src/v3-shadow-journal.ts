import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HashSchema, TimestampSchema, timestamp, type Timestamp } from "@virtual/domain";
import { z } from "zod";

export const V3ShadowJournalRecordSchema = z
  .object({
    schemaVersion: z.literal("3.0.0"),
    sequence: z.number().int().positive(),
    recordId: z.string().regex(/^v3-shadow-\d+-[0-9a-f]{16}$/),
    kind: z.enum([
      "RUNTIME_START",
      "RUNTIME_STOP",
      "SOURCE_SNAPSHOT",
      "NEWS_OBSERVED",
      "MARKET_GAP",
      "SELL_STAGE_CHANGED",
      "REBUY_STAGE_CHANGED",
      "SHADOW_SELL_CREATED",
    ]),
    recordedAt: TimestampSchema,
    payloadHash: HashSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type V3ShadowJournalRecord = z.infer<typeof V3ShadowJournalRecordSchema>;
export type V3ShadowJournalInput = Pick<V3ShadowJournalRecord, "kind" | "payload"> & {
  recordedAt?: Timestamp;
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

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export class V3ShadowJournal {
  readonly #records: V3ShadowJournalRecord[] = [];
  readonly #ready: Promise<void>;
  #tail: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {
    this.#ready = this.#load();
  }

  append(input: V3ShadowJournalInput): Promise<V3ShadowJournalRecord> {
    const operation = this.#tail.then(async () => {
      await this.#ready;
      const recordedAt = input.recordedAt ?? timestamp(new Date());
      const payload = canonicalize(structuredClone(input.payload)) as Record<string, unknown>;
      const payloadDigest = digest(payload);
      const sequence = this.#records.length + 1;
      const record = V3ShadowJournalRecordSchema.parse({
        schemaVersion: "3.0.0",
        sequence,
        recordId: `v3-shadow-${sequence}-${digest({ sequence, kind: input.kind, recordedAt, payloadDigest }).slice(0, 16)}`,
        kind: input.kind,
        recordedAt,
        payloadHash: `sha256:${payloadDigest}`,
        payload,
      });
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
      return structuredClone(record);
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async flush(): Promise<void> {
    await this.#ready;
    await this.#tail;
  }

  async list(): Promise<readonly V3ShadowJournalRecord[]> {
    await this.flush();
    return Object.freeze(this.#records.map((record) => structuredClone(record)));
  }

  async #load(): Promise<void> {
    let content = "";
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => V3ShadowJournalRecordSchema.parse(JSON.parse(line)));
    const ids = new Set<string>();
    records.forEach((record, index) => {
      if (record.sequence !== index + 1) {
        throw new Error(`V3 shadow journal sequence gap at ${index + 1}`);
      }
      if (ids.has(record.recordId))
        throw new Error(`Duplicate V3 shadow record ${record.recordId}`);
      if (`sha256:${digest(record.payload)}` !== record.payloadHash) {
        throw new Error(`V3 shadow journal payload hash mismatch at ${record.sequence}`);
      }
      ids.add(record.recordId);
    });
    this.#records.push(...records.map((record) => structuredClone(record)));
  }
}
