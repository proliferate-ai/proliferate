"""RFC 8785 (JCS) canonical JSON serialization and SHA-256 digests.

This module is pure: it takes already-parsed JSON values (``None``, ``bool``,
``int``/``float``, ``str``, ``list``, ``dict``) and produces the canonical byte
string an RFC 8785 serializer would emit, plus its SHA-256 hex digest. It has a
Rust and TypeScript twin; the shared golden fixtures under
``fixtures/contracts/workflow-run/`` are the cross-language correctness fence.

The only subtle part is number formatting. RFC 8785 §3.2.2.3 requires the
ECMAScript ``Number::toString`` algorithm, which differs from Python's ``repr``
for exponent thresholds (e.g. ``1e21`` -> ``"1e+21"`` but ``1e20`` ->
``"100000000000000000000"``). ``_ecmascript_number`` implements that algorithm
directly so the bytes match ``JSON.stringify`` in TypeScript and Rust's twin.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

__all__ = [
    "canonical_json",
    "canonical_bytes",
    "sha256_hex",
    "digest",
    "bundle_digest",
    "runtime_payload_digest",
]

# JSON integer literals beyond the IEEE-754 exact-integer range parse to
# different values in JavaScript (silent rounding) than in Python (exact big
# integers), so their canonical bytes could never agree across languages.
# Each language rejects them wherever its parser preserves the exact value:
# Python for every ``int`` (this guard), Rust for literals fitting
# ``i64``/``u64``. JavaScript — and Rust for literals overflowing ``u64``/
# ``i64`` — has already rounded to a double post-parse and canonicalizes that
# double, byte-identically across the two. This module is the strict gate at
# the Cloud write boundary, so such literals never reach a stored payload.
_MAX_SAFE_INTEGER = 2**53


def canonical_json(value: object) -> str:
    """Serialize a JSON value to its RFC 8785 canonical string form."""

    return _serialize(value)


def canonical_bytes(value: object) -> bytes:
    """Serialize a JSON value to canonical UTF-8 bytes."""

    return canonical_json(value).encode("utf-8")


def sha256_hex(value: object) -> str:
    """SHA-256 hex digest over the canonical UTF-8 bytes of ``value``."""

    return hashlib.sha256(canonical_bytes(value)).hexdigest()


# ``digest`` is the public name delivery/AnyHarness code reaches for; it is an
# alias for ``sha256_hex`` and keeps call sites reading as "the digest of X".
digest = sha256_hex


# ``bundleDigest`` (PR2 design §6.3) covers ONLY the immutable logical content
# of a resolved run bundle. The wire wrapper (``contractVersion``, ``runId``)
# is transport identity, not logical content: two invocations with identical
# logical content share a bundle digest regardless of run identity.
_BUNDLE_DIGEST_FIELDS = ("definition", "arguments", "resolvedStages", "resolvedPlacement")


def bundle_digest(bundle: dict[str, object]) -> str:
    """``bundleDigest``: SHA-256 over ONLY the §6.3-covered bundle members.

    Accepts the full resolved bundle object and selects exactly ``definition``,
    ``arguments``, ``resolvedStages``, and ``resolvedPlacement``, so no call
    site can accidentally widen the digest to the wire wrapper.
    """

    if not isinstance(bundle, dict):
        raise TypeError("bundle_digest expects the resolved bundle object.")
    missing = [field for field in _BUNDLE_DIGEST_FIELDS if field not in bundle]
    if missing:
        raise ValueError(
            f"Resolved bundle is missing digest-covered fields: {', '.join(missing)}."
        )
    return sha256_hex({field: bundle[field] for field in _BUNDLE_DIGEST_FIELDS})


def runtime_payload_digest(payload: dict[str, object]) -> str:
    """``runtimePayloadDigest``: SHA-256 over ONLY the immutable ``run`` object.

    The delivery wire body is ``{run, control}`` plus the ``expectedDataEpoch``
    transport precondition. The epoch and the per-attempt monotonic ``control``
    object are excluded so a replay carrying updated cancellation state keeps
    the digest of the first fixed payload.
    """

    if not isinstance(payload, dict):
        raise TypeError("runtime_payload_digest expects the delivery payload object.")
    if "run" not in payload:
        raise ValueError("Delivery payload is missing the digest-covered 'run' object.")
    return sha256_hex(payload["run"])


def _serialize(value: object) -> str:
    if value is None:
        return "null"
    # ``bool`` is a subclass of ``int`` — check it first.
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return _serialize_string(value)
    if isinstance(value, int):
        return _ecmascript_number(value)
    if isinstance(value, float):
        return _ecmascript_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        return _serialize_object(value)
    raise TypeError(f"Cannot canonicalize value of type {type(value)!r}.")


def _serialize_object(value: dict[object, object]) -> str:
    members = []
    for key in _sorted_keys(value):
        members.append(_serialize_string(key) + ":" + _serialize(value[key]))
    return "{" + ",".join(members) + "}"


def _sorted_keys(value: dict[object, object]) -> list[str]:
    keys: list[str] = []
    for key in value:
        if not isinstance(key, str):
            raise TypeError("Canonical JSON object keys must be strings.")
        keys.append(key)
    # RFC 8785 sorts keys by their UTF-16 code units, which is what a default
    # JavaScript ``Array.prototype.sort`` on the keys produces.
    keys.sort(key=lambda item: item.encode("utf-16-be"))
    return keys


def _serialize_string(value: str) -> str:
    # Lone surrogates (which ``json.loads`` happily produces from ``\uXXXX``
    # escapes) have no UTF-8 canonical bytes and are rejected in every
    # language, so no digest exists for them anywhere. Checking here covers
    # both member values and object keys.
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError(
            "Cannot canonicalize a string containing lone surrogates."
        ) from error
    # Python's ``json.dumps`` with ``ensure_ascii=False`` applies exactly the
    # RFC 8785 / ``JSON.stringify`` minimal escaping: the two mandatory escapes
    # (``"`` and ``\``), the short control escapes (\b \t \n \f \r), and
    # ``\u00xx`` for the remaining C0 controls, with every other code point
    # emitted as raw UTF-8.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _ecmascript_number(value: float | int) -> str:
    """Render a finite number per ECMAScript ``Number::toString`` (RFC 8785)."""

    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("Cannot canonicalize a non-finite number.")
        if value == 0.0:
            # Both +0 and -0 serialize to "0".
            return "0"
    else:
        if value == 0:
            return "0"
        if abs(value) > _MAX_SAFE_INTEGER:
            raise ValueError(
                "Cannot canonicalize an integer outside the IEEE-754 exact "
                f"range (|value| > 2**53): {value!r}."
            )

    negative = value < 0
    # ``Decimal(repr(x))`` recovers the shortest round-tripping decimal digits
    # Python computed; for ints ``repr`` is exact. From those digits we derive
    # the ECMAScript ``s`` (digit string) and ``n`` (position) variables.
    as_tuple = Decimal(repr(abs(value))).as_tuple()
    digits = "".join(str(component) for component in as_tuple.digits)
    exponent = int(as_tuple.exponent)

    # Strip trailing zeros to obtain the minimal digit string ``s`` while
    # tracking the power-of-ten exponent so the value is unchanged.
    stripped = digits.rstrip("0")
    if stripped == "":
        stripped = "0"
    exponent += len(digits) - len(stripped)
    s = stripped
    k = len(s)
    n = k + exponent

    body = _ecmascript_body(s, k, n)
    return f"-{body}" if negative else body


def _ecmascript_body(s: str, k: int, n: int) -> str:
    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    exponent = n - 1
    sign = "+" if exponent >= 0 else "-"
    magnitude = f"{abs(exponent)}"
    if k == 1:
        return f"{s}e{sign}{magnitude}"
    return f"{s[0]}.{s[1:]}e{sign}{magnitude}"
