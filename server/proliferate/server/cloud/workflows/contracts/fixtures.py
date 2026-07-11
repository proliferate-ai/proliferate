"""Locate and load the shared golden contract fixtures."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_REL = Path("tests/contracts/workflows/fixtures")


@lru_cache(maxsize=1)
def fixtures_dir() -> Path:
    """Walk up from this file to the repo root and return the fixtures dir."""

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / _REL
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"could not locate {_REL} above {here}")


def load(name: str) -> Any:  # noqa: ANN401 - fixture JSON has heterogeneous shape
    return json.loads((fixtures_dir() / name).read_text(encoding="utf-8"))


def load_text(name: str) -> str:
    return (fixtures_dir() / name).read_text(encoding="utf-8")
