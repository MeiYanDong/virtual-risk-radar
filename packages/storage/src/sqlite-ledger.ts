import { DatabaseSync } from "node:sqlite";
import { LedgerEventSchema, type LedgerEvent } from "./ledger";

const MIGRATION_001 = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS ledger_events (
  event_id TEXT PRIMARY KEY,
  parent_event_id TEXT REFERENCES ledger_events(event_id),
  event_type TEXT NOT NULL,
  ingestion_sequence INTEGER NOT NULL UNIQUE CHECK (ingestion_sequence > 0),
  source TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  event_time TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  evidence_level TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_update
BEFORE UPDATE ON ledger_events
BEGIN SELECT RAISE(ABORT, 'append-only ledger forbids UPDATE'); END;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_delete
BEFORE DELETE ON ledger_events
BEGIN SELECT RAISE(ABORT, 'append-only ledger forbids DELETE'); END;

CREATE TABLE IF NOT EXISTS config_versions (
  config_hash TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE IF NOT EXISTS adapter_status_events (
  status_event_id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE IF NOT EXISTS evidence_index (
  evidence_id TEXT PRIMARY KEY,
  ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
  evidence_level TEXT NOT NULL,
  payload_hash TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS decision_snapshots (
  decision_id TEXT PRIMARY KEY,
  ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE IF NOT EXISTS state_transitions (
  transition_id TEXT PRIMARY KEY,
  ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
  model_id TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS operator_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
  confirmation_type TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE IF NOT EXISTS shadow_position_events (
  position_event_id TEXT PRIMARY KEY,
  ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
  chain_profile_id TEXT NOT NULL,
  position_state TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;
`;

function rowToEvent(row: Record<string, unknown>): LedgerEvent {
  return LedgerEventSchema.parse({
    eventId: row["event_id"],
    ...(row["parent_event_id"] === null ? {} : { parentEventId: row["parent_event_id"] }),
    eventType: row["event_type"],
    ingestionSequence: row["ingestion_sequence"],
    source: row["source"],
    schemaVersion: row["schema_version"],
    eventTime: row["event_time"],
    observedAt: row["observed_at"],
    payloadHash: row["payload_hash"],
    evidenceLevel: row["evidence_level"],
    payload: JSON.parse(String(row["payload_json"])) as unknown,
  });
}

export class SqliteAppendOnlyLedger {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(MIGRATION_001);
    this.#database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(1, new Date().toISOString());
  }

  append(input: LedgerEvent): LedgerEvent {
    const event = LedgerEventSchema.parse(input);
    const latest = this.#database
      .prepare("SELECT COALESCE(MAX(ingestion_sequence), 0) AS sequence FROM ledger_events")
      .get() as { sequence: number };
    if (event.ingestionSequence !== latest.sequence + 1) {
      throw new Error(
        `Ledger sequence must be contiguous; expected ${latest.sequence + 1} received ${event.ingestionSequence}`,
      );
    }
    if (Date.parse(event.eventTime) > Date.parse(event.observedAt)) {
      throw new Error("eventTime cannot be later than observedAt");
    }
    this.#database
      .prepare(
        `INSERT INTO ledger_events (
          event_id, parent_event_id, event_type, ingestion_sequence, source, schema_version,
          event_time, observed_at, payload_hash, evidence_level, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.parentEventId ?? null,
        event.eventType,
        event.ingestionSequence,
        event.source,
        event.schemaVersion,
        event.eventTime,
        event.observedAt,
        event.payloadHash,
        event.evidenceLevel,
        JSON.stringify(event.payload),
      );
    return structuredClone(event);
  }

  list(): readonly LedgerEvent[] {
    const rows = this.#database
      .prepare("SELECT * FROM ledger_events ORDER BY ingestion_sequence")
      .all() as Record<string, unknown>[];
    return Object.freeze(rows.map(rowToEvent));
  }

  close(): void {
    this.#database.close();
  }
}

export const sqliteMigration001 = MIGRATION_001;
