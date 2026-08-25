# Storage contract

## SQLite control plane

`ledger_events` is append-only and protected by database triggers that reject `UPDATE` and
`DELETE`. Related tables retain configuration versions, adapter status events, evidence indexes,
decision snapshots, state transitions, operator confirmations, and Shadow position events. The
Node 22 built-in SQLite API is currently experimental, so this implementation is local-tested but
must be re-reviewed before production deployment.

## Parquet evidence plane

Partition layout:

```text
source=<source_id>/date=<UTC YYYY-MM-DD>/hour=<UTC HH>/run=<ingestion_run_id>.parquet
```

Each part contains source ID, event time, receive time, schema version, ingestion run ID, canonical
JSON payload, and payload SHA-256. A checksummed manifest is published beside the part. Writers use
a same-directory temporary file, `fsync`, and atomic rename. Existing run IDs are immutable.

DuckDB opens the Parquet collection through a read-only view. Retention defaults to 180 days and
only produces a dry-run candidate list; deletion requires separate operational authorization.

## v0.3.2 local TechFlow audit journal

`data/runtime/v3-news-audit-v0.3.2.jsonl` is a local `0600` append-only audit of every TechFlow list
item actually emitted by the active cursor after audit capture was enabled. Each line contains the
normalized item, at most 600 excerpt characters, four deterministic checks, the immutable outcome,
rule/model/config versions, and a canonical record hash. Repeated identical revisions are
idempotent; a changed judgment for the same record ID fails closed. Content revisions append new
records and remain queryable from the item detail API.

Retention is 180 days from `judgedAt`. Pruning writes a same-directory `0600` temporary file and
atomically renames it; complete article bodies are never stored. Runtime data remains Git ignored.
The journal cannot reconstruct items missed while the process was offline or while the public item
was outside the visible list.
