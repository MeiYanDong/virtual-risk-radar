import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


def load_schema(repository_root: Path, name: str) -> dict[str, Any]:
    path = repository_root / "docs" / "specs" / "generated" / f"{name}.schema.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Schema {name} must be a JSON object")
    return value


def validate_document(repository_root: Path, schema_name: str, document: object) -> None:
    schema = load_schema(repository_root, schema_name)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(document)
