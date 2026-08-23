from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from virtual_risk_analysis.parquet_store import (
    open_readonly_evidence_view,
    retention_dry_run,
    write_parquet_atomic,
)


def rows() -> list[dict[str, object]]:
    return [
        {
            "event_time": "2026-08-22T05:05:06.999Z",
            "received_at": "2026-08-22T05:05:06.999Z",
            "payload": {"price": "0.7", "quantity": "10.000000000000000001"},
        },
        {
            "event_time": "2026-08-22T05:05:07.999Z",
            "received_at": "2026-08-22T05:05:08.001Z",
            "payload": {"price": "0.69", "quantity": "0"},
        },
    ]


def test_atomic_parquet_manifest_and_duckdb_readback(tmp_path: Path) -> None:
    target, checksum = write_parquet_atomic(
        tmp_path,
        source_id="binance-spot-public",
        partition_date="2026-08-22",
        hour="05",
        schema_version="1.0.0",
        ingestion_run_id="fixture-001",
        rows=rows(),
    )
    assert target.exists()
    manifest = json.loads(target.with_suffix(".manifest.json").read_text())
    assert manifest["sha256"] == checksum
    assert manifest["recordCount"] == 2

    connection = open_readonly_evidence_view(
        str(tmp_path / "source=*" / "date=*" / "hour=*" / "*.parquet")
    )
    try:
        count, zero_quantity = connection.execute(
            "SELECT count(*), count(*) FILTER "
            "(WHERE json_extract_string(payload_json, '$.quantity') = '0') "
            "FROM raw_evidence"
        ).fetchone()
    finally:
        connection.close()
    assert count == 2
    assert zero_quantity == 1
    with pytest.raises(FileExistsError):
        write_parquet_atomic(
            tmp_path,
            source_id="binance-spot-public",
            partition_date="2026-08-22",
            hour="05",
            schema_version="1.0.0",
            ingestion_run_id="fixture-001",
            rows=rows(),
        )


def test_retention_is_dry_run_only(tmp_path: Path) -> None:
    old, _ = write_parquet_atomic(
        tmp_path,
        source_id="test",
        partition_date="2025-01-01",
        hour="00",
        schema_version="1.0.0",
        ingestion_run_id="old",
        rows=rows(),
    )
    candidates = retention_dry_run(tmp_path, as_of=date(2026, 8, 22))
    assert candidates == [old]
    assert old.exists()


def test_partition_path_rejects_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Unsafe source"):
        write_parquet_atomic(
            tmp_path,
            source_id="../escape",
            partition_date="2026-08-22",
            hour="05",
            schema_version="1.0.0",
            ingestion_run_id="fixture-001",
            rows=rows(),
        )
