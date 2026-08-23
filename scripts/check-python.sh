#!/bin/sh
set -eu

if [ ! -x .venv/bin/python ]; then
  echo "Python environment missing. Run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

.venv/bin/ruff format --check python
.venv/bin/ruff check python
.venv/bin/mypy
.venv/bin/pytest

