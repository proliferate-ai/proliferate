"""Pure invocation identity rules: scalar arguments and canonical JSON.

RFC 8785 canonicalization is the replay identity for workflow invocations —
whitespace and key order never matter, values always do. It also rejects
non-portable numbers (non-finite floats, integers outside the I-JSON safe
range), which is the argument-portability gate for gen-2 invocations.
"""

from __future__ import annotations

from typing import cast

import rfc8785

ScalarValue = str | bool | int | float
type CanonicalJsonValue = (
    None
    | bool
    | int
    | float
    | str
    | list[CanonicalJsonValue]
    | tuple[CanonicalJsonValue, ...]
    | dict[str, CanonicalJsonValue]
)


def canonical_json(value: object) -> str:
    return rfc8785.dumps(cast(CanonicalJsonValue, value)).decode("utf-8")
