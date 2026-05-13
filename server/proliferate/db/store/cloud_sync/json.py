"""JSON helpers for cloud sync stores."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence


JsonObject = Mapping[str, object]


def encode_object(value: JsonObject | None) -> str:
    return json.dumps(dict(value or {}), sort_keys=True, separators=(",", ":"))


def encode_array(value: Sequence[object] | None) -> str:
    return json.dumps(list(value or ()), sort_keys=True, separators=(",", ":"))


def decode_object(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    decoded = json.loads(value)
    return decoded if isinstance(decoded, dict) else {}


def decode_array(value: str | None) -> list[object]:
    if not value:
        return []
    decoded = json.loads(value)
    return decoded if isinstance(decoded, list) else []
