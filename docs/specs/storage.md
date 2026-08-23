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
