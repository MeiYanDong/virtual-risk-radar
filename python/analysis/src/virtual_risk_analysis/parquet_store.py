"""Atomic, append-by-new-file Parquet evidence storage and read-only DuckDB views."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Iterable, Mapping
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import duckdb

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")


def _segment(value: str, label: str) -> str:
    if not _SAFE_SEGMENT.fullmatch(value):
        raise ValueError(f"Unsafe {label} partition segment")
    return value


def _atomic_text(path: Path, content: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def write_parquet_atomic(
    root: Path,
    *,
    source_id: str,
    partition_date: str,
    hour: str,
    schema_version: str,
    ingestion_run_id: str,
    rows: Iterable[Mapping[str, Any]],
) -> tuple[Path, str]:
    """Write a new immutable Parquet part, fsync it, then atomically publish it."""
    source = _segment(source_id, "source")
    day = date.fromisoformat(partition_date).isoformat()
    hour_value = _segment(hour, "hour")
    if not re.fullmatch(r"(?:[01]\d|2[0-3])", hour_value):
        raise ValueError("Hour must be 00 through 23")
    version = _segment(schema_version, "schema version")
    run_id = _segment(ingestion_run_id, "ingestion run ID")
    materialized = list(rows)
    if not materialized:
        raise ValueError("An empty Parquet part is not evidence")

    partition = root / f"source={source}" / f"date={day}" / f"hour={hour_value}"
    partition.mkdir(parents=True, exist_ok=True)
    target = partition / f"run={run_id}.parquet"
    manifest = partition / f"run={run_id}.manifest.json"
    if target.exists() or manifest.exists():
        raise FileExistsError("An immutable ingestion run already exists")

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=partition)
    os.close(descriptor)
    temporary = Path(temporary_name)
    temporary.unlink()
    connection = duckdb.connect(":memory:")
    try:
        connection.execute(
            """
            CREATE TABLE raw_evidence (
              source_id VARCHAR NOT NULL,
              event_time TIMESTAMPTZ NOT NULL,
              received_at TIMESTAMPTZ NOT NULL,
              schema_version VARCHAR NOT NULL,
              ingestion_run_id VARCHAR NOT NULL,
              payload_json JSON NOT NULL,
              payload_hash VARCHAR NOT NULL
            )
            """
        )
        values: list[tuple[str, str, str, str, str, str, str]] = []
        for row in materialized:
            event_time = str(row["event_time"])
            received_at = str(row["received_at"])
            payload_json = json.dumps(
                row["payload"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            payload_hash = f"sha256:{hashlib.sha256(payload_json.encode()).hexdigest()}"
            values.append(
                (
                    source,
                    event_time,
                    received_at,
                    version,
                    run_id,
                    payload_json,
                    payload_hash,
                )
            )
        connection.executemany("INSERT INTO raw_evidence VALUES (?, ?, ?, ?, ?, ?, ?)", values)
        escaped = str(temporary).replace("'", "''")
        connection.execute(f"COPY raw_evidence TO '{escaped}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    finally:
        connection.close()

    try:
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        checksum = f"sha256:{hashlib.sha256(temporary.read_bytes()).hexdigest()}"
        os.replace(temporary, target)
        _atomic_text(
            manifest,
            json.dumps(
                {
                    "sourceId": source,
                    "date": day,
                    "hour": hour_value,
                    "schemaVersion": version,
                    "ingestionRunId": run_id,
                    "recordCount": len(materialized),
                    "file": target.name,
                    "sha256": checksum,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
        )
        return target, checksum
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def open_readonly_evidence_view(parquet_glob: str) -> Any:
    """Return an in-memory DuckDB connection with a read-only raw_evidence view."""
    connection = duckdb.connect(":memory:")
    escaped = parquet_glob.replace("'", "''")
    connection.execute(
        f"CREATE VIEW raw_evidence AS SELECT * FROM read_parquet('{escaped}', union_by_name=true)"
    )
    return connection


def retention_dry_run(root: Path, *, as_of: date, retention_days: int = 180) -> list[Path]:
    """List old Parquet parts without deleting anything."""
    if retention_days <= 0:
        raise ValueError("Retention days must be positive")
    cutoff = as_of - timedelta(days=retention_days)
    candidates: list[Path] = []
    for path in root.glob("source=*/date=*/hour=*/run=*.parquet"):
        date_segment = next((part for part in path.parts if part.startswith("date=")), None)
        if date_segment is None:
            continue
        try:
            partition_day = date.fromisoformat(date_segment.removeprefix("date="))
        except ValueError:
            continue
        if partition_day < cutoff:
            candidates.append(path)
    return sorted(candidates)
