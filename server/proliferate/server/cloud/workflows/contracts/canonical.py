"""RFC 8785 (JCS) canonical JSON + SHA-256 content hashing for the workflow
contract spine (WS1).

The workflow feature spec requires `planHash`, `bindingHash`, and
`checkpointContentHash` to be a SHA-256 over the RFC 8785 canonical JSON of the
structure, excluding only the hash field itself. This module implements the JCS
subset the workflow contracts actually use: objects, arrays, strings, booleans,
null, and finite integers. Non-integer floats are rejected on purpose — no
hashed contract surface carries one, and allowing platform-dependent float
formatting would break cross-language byte agreement with the TypeScript and
Rust implementations.

The canonical byte sequence produced here is intentionally identical to the one
produced by the TypeScript implementation in
`apps/packages/product-domain/src/workflows/contracts/canonical.ts`.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


class CanonicalizationError(ValueError):
    """A value cannot be represented in the canonical JSON subset."""


def _canon(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        # ensure_ascii=False matches JS JSON.stringify escaping for the ASCII
        # content used by these contracts (quote, backslash, control chars).
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):  # pragma: no cover - handled above
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalizationError("non-finite number is not canonicalizable")
        if value.is_integer():
            return str(int(value))
        raise CanonicalizationError(
            "non-integer float is not permitted in canonical contract content"
        )
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canon(item) for item in value) + "]"
    if isinstance(value, dict):
        # Sort by Unicode code point of the key, matching the TS implementation.
        parts = []
        for key in sorted(value.keys()):
            if not isinstance(key, str):
                raise CanonicalizationError("object keys must be strings")
            parts.append(
                json.dumps(key, ensure_ascii=False, separators=(",", ":"))
                + ":"
                + _canon(value[key])
            )
        return "{" + ",".join(parts) + "}"
    raise CanonicalizationError(f"unsupported type in canonical JSON: {type(value)!r}")


def canonicalize(value: Any) -> bytes:
    """Return the RFC 8785 canonical JSON byte sequence for ``value``."""

    return _canon(value).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_hash(value: Any) -> str:
    """`sha256:<lowercase hex>` over the canonical JSON of ``value``."""

    return "sha256:" + sha256_hex(canonicalize(value))


def hash_excluding(value: dict[str, Any], field: str) -> str:
    """Content hash of a mapping with a single top-level ``field`` removed.

    Used for `planHash`/`bindingHash`, which hash the whole structure minus the
    hash field itself.
    """

    reduced = {k: v for k, v in value.items() if k != field}
    return content_hash(reduced)
