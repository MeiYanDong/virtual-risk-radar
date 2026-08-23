import { open, readFile } from "node:fs/promises";
import {
  type EvidenceLevel,
  EvidenceLevelSchema,
  type Hash,
  HashSchema,
  type Timestamp,
  TimestampSchema,
} from "@virtual/domain";
import { z } from "zod";

export const LedgerEventTypeSchema = z.enum([
  "SOURCE_OBSERVED",
  "SOURCE_GAP_DETECTED",
  "NEWS_CLUSTER_CREATED",
  "FEATURE_SNAPSHOT_CREATED",
  "CONDITION_EVALUATED",
  "STAGE_CHANGED",
  "QUOTE_REQUESTED",
  "QUOTE_OBSERVED",
  "QUOTE_EXPIRED",
  "DECISION_CREATED",
  "NOTIFICATION_SENT",
  "OPERATOR_ACKNOWLEDGED",
  "OPERATOR_MARKED_EXECUTED",
  "SHADOW_FILL_CREATED",
  "MODEL_VERSION_CHANGED",
  "CONFIG_CHANGED",
  "CORRECTION_APPENDED",
]);
export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;

export const LedgerEventSchema = z
  .object({
    eventId: z.string().min(1),
    parentEventId: z.string().min(1).optional(),
    eventType: LedgerEventTypeSchema,
    ingestionSequence: z.number().int().positive(),
    source: z.string().min(1),
    schemaVersion: z.string().min(1),
    eventTime: TimestampSchema,
    observedAt: TimestampSchema,
    payloadHash: HashSchema,
    evidenceLevel: EvidenceLevelSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

function cloneEvent(event: LedgerEvent): LedgerEvent {
  return structuredClone(event);
}

export class AppendOnlyLedger {
  readonly #events: LedgerEvent[] = [];
  readonly #ids = new Set<string>();

  constructor(initialEvents: LedgerEvent[] = []) {
    for (const event of initialEvents) this.append(event);
  }

  append(input: LedgerEvent): LedgerEvent {
    const event = LedgerEventSchema.parse(input);
    if (this.#ids.has(event.eventId)) {
      throw new Error(`Duplicate ledger event id: ${event.eventId}`);
    }
    const expectedSequence = this.#events.length + 1;
    if (event.ingestionSequence !== expectedSequence) {
      throw new Error(
        "Ledger sequence must be contiguous; expected " +
          expectedSequence +
          " received " +
          event.ingestionSequence,
      );
    }
    if (Date.parse(event.eventTime) > Date.parse(event.observedAt)) {
      throw new Error("eventTime cannot be later than observedAt");
    }
    if (event.parentEventId !== undefined && !this.#ids.has(event.parentEventId)) {
      throw new Error(`Unknown parent ledger event: ${event.parentEventId}`);
    }

    const stored = cloneEvent(event);
    this.#events.push(stored);
    this.#ids.add(stored.eventId);
    return cloneEvent(stored);
  }

  list(): readonly LedgerEvent[] {
    return Object.freeze(this.#events.map(cloneEvent));
  }

  latestSequence(): number {
    return this.#events.length;
  }
}

export class FileAppendOnlyLedger {
  readonly #memory: AppendOnlyLedger;

  private constructor(
    readonly path: string,
    initialEvents: LedgerEvent[],
  ) {
    this.#memory = new AppendOnlyLedger(initialEvents);
  }

  static async open(path: string): Promise<FileAppendOnlyLedger> {
    let content = "";
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const events = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line)));
    return new FileAppendOnlyLedger(path, events);
  }

  async append(event: LedgerEvent): Promise<LedgerEvent> {
    const stored = this.#memory.append(event);
    const handle = await open(this.path, "a", 0o600);
    try {
      await handle.appendFile(`${JSON.stringify(stored)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return stored;
  }

  list(): readonly LedgerEvent[] {
    return this.#memory.list();
  }
}

export function ledgerEvent(input: {
  eventId: string;
  parentEventId?: string;
  eventType: LedgerEventType;
  ingestionSequence: number;
  source: string;
  schemaVersion: string;
  eventTime: Timestamp;
  observedAt: Timestamp;
  payloadHash: Hash;
  evidenceLevel: EvidenceLevel;
  payload: Record<string, unknown>;
}): LedgerEvent {
  return LedgerEventSchema.parse(input);
}
