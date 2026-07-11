"""RFC 8785 (JCS) canonical JSON + SHA-256 content hashing for the workflow
contract spine (WS1, float fix WS1-follow-up).

The workflow feature spec requires `planHash`, `bindingHash`, and
`checkpointContentHash` to be a SHA-256 over the RFC 8785 canonical JSON of the
structure, excluding only the hash field itself. This module implements the JCS
subset the workflow contracts actually use: objects, arrays, strings, booleans,
null, and numbers (finite integers and finite non-integer floats). NaN and
Infinity remain rejected — RFC 8785 has no representation for them.

Number serialization follows RFC 8785 §3.2.2.3, which mandates the ECMAScript
`Number::toString` algorithm (ECMA-262, "ToString Applied to the Number Type"):
the shortest decimal digit string that round-trips to the same IEEE 754
double, placed with a decimal point or switched to exponential notation purely
as a function of the decimal exponent — never the language's native
float-repr formatting. Python's `repr(float)` already produces the shortest
round-trip digit sequence (guaranteed since CPython 3.1), but its *placement*
rules differ from ECMAScript's in several ways this module corrects for:

  * Python never emits exponential notation until ~1e16/1e17 and switches back
    to fixed notation below that threshold going small; ECMAScript's
    thresholds are exact: exponential for a decimal-point position `n` with
    `n > 21` or `n <= -6` (RFC 8785 / ECMA-262 steps 6-9), fixed notation
    otherwise.
  * Python always appends `.0` to an integral float's repr (`"2.0"`);
    ECMAScript drops it (`"2"`).
  * IEEE754 negative zero: ECMAScript's `Number::toString(-0)` is `"0"` (no
    sign), which Python's `repr(-0.0)` (`"-0.0"`) does not give for free.

`_decimal_digits_and_n` extracts the (digit-string, decimal-exponent) pair from
`repr()` via `decimal.Decimal` (which parses the repr text digit-for-digit,
with no rounding) and strips only the trailing zero `repr()` adds to
distinguish floats from ints; `_es_number_to_string` then re-renders those
digits using the ECMA-262 placement rules verbatim. This has been fuzz-verified
against Node's native `String()` (the ECMA-262 reference behavior) across
~200k random IEEE 754 doubles plus edge cases (0, -0, 1e21, 1e-6, 1e-7, 2.0,
min/max double, min subnormal) with zero mismatches — see the WS1-follow-up
(float canonicalization) execution log.

The canonical byte sequence produced here is intentionally identical to the one
produced by the TypeScript implementation in
`apps/packages/product-domain/src/workflows/contracts/canonical.ts` (which gets
this for free: JS's own `String()` on a finite number already *is* the
ECMA-262 `Number::toString` algorithm).
"""

from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal
from typing import Any


class CanonicalizationError(ValueError):
    """A value cannot be represented in the canonical JSON subset."""


def _decimal_digits_and_n(magnitude: float) -> tuple[str, int]:
    """Shortest round-trip digit string ``s`` and decimal exponent ``n`` for a
    finite, strictly positive float, such that the value equals
    ``int(s) * 10 ** (n - len(s))`` (RFC 8785 §3.2.2.3 / ECMA-262 notation).

    ``repr()`` already gives the shortest digit sequence that round-trips to
    this float; ``Decimal(repr(magnitude))`` parses that text back into exact
    digits + exponent with no further rounding. The only correction needed is
    stripping the trailing zero ``repr()`` adds to mark a float as
    non-integral (e.g. ``repr(100.0) == "100.0"``), which is not part of the
    *significant* digit count RFC 8785 cares about.
    """

    _sign, digits, exponent = Decimal(repr(magnitude)).as_tuple()
    digit_list = list(digits)
    while len(digit_list) > 1 and digit_list[-1] == 0:
        digit_list.pop()
        exponent += 1
    s = "".join(str(d) for d in digit_list)
    n = exponent + len(s)
    return s, n


def _es_number_to_string(value: float) -> str:
    """RFC 8785 §3.2.2.3 number serialization (ECMA-262 ``Number::toString``).

    ``value`` must already be checked finite by the caller.
    """

    if value == 0:
        # Covers both +0.0 and -0.0: IEEE754 -0 == 0, and ES Number::toString
        # renders both as "0" (no sign).
        return "0"
    negative = value < 0
    s, n = _decimal_digits_and_n(-value if negative else value)
    k = len(s)
    if k <= n <= 21:
        out = s + "0" * (n - k)
    elif 0 < n <= 21:
        out = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + s
    else:
        exp = n - 1
        exp_sign = "+" if exp >= 0 else "-"
        if k == 1:
            out = s + "e" + exp_sign + str(abs(exp))
        else:
            out = s[0] + "." + s[1:] + "e" + exp_sign + str(abs(exp))
    return "-" + out if negative else out


def _canon(value: Any) -> str:  # noqa: ANN401 - canonical JSON accepts any JSON value
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
        return _es_number_to_string(value)
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


def canonicalize(value: Any) -> bytes:  # noqa: ANN401 - public JSON contract boundary
    """Return the RFC 8785 canonical JSON byte sequence for ``value``."""

    return _canon(value).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_hash(value: Any) -> str:  # noqa: ANN401 - public JSON contract boundary
    """`sha256:<lowercase hex>` over the canonical JSON of ``value``."""

    return "sha256:" + sha256_hex(canonicalize(value))


def hash_excluding(value: dict[str, Any], field: str) -> str:
    """Content hash of a mapping with a single top-level ``field`` removed.

    Used for `planHash`/`bindingHash`, which hash the whole structure minus the
    hash field itself.
    """

    reduced = {k: v for k, v in value.items() if k != field}
    return content_hash(reduced)
