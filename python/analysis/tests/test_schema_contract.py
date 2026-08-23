import json
from pathlib import Path

from virtual_risk_analysis.schema_contract import load_schema, validate_document

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_python_validates_the_same_default_config_schema() -> None:
    config_path = REPOSITORY_ROOT / "config" / "default.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    validate_document(REPOSITORY_ROOT, "system-config", config)


def test_active_and_legacy_schemas_have_stable_identifiers() -> None:
    active_schema = load_schema(REPOSITORY_ROOT, "v3-news-item")
    assert active_schema["$id"] == ("https://virtual-risk.local/schema/v3-news-item.v1.json")

    legacy_schema = load_schema(REPOSITORY_ROOT, "legacy-v0.2-decision-snapshot")
    assert legacy_schema["$id"] == (
        "https://virtual-risk.local/schema/legacy-v0.2-decision-snapshot.v1.json"
    )


def test_python_validates_the_same_source_and_state_machine_contracts() -> None:
    for schema_name, relative_path in (
        ("source-registry", "config/source-registry.json"),
        ("state-machine-spec", "config/state-machines.json"),
    ):
        document = json.loads((REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8"))
        validate_document(REPOSITORY_ROOT, schema_name, document)


def test_python_validates_every_historical_news_observation() -> None:
    observations = json.loads(
        (
            REPOSITORY_ROOT / "tests" / "fixtures" / "2026-08-22" / "news-observations.json"
        ).read_text(encoding="utf-8")
    )
    assert len(observations) == 8
    for observation in observations:
        validate_document(REPOSITORY_ROOT, "legacy-v0.2-news-observation", observation)
