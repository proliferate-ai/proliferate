"""Versioned authenticated opaque cursor for the support feed.

The cursor wraps the ``(completed_at, id)`` order tuple and is authenticated
with an HMAC so a tampered or forged cursor is rejected. It is pure: the signing
secret is passed in by the caller. Decoding raises :class:`ValueError` on any
malformed, mis-versioned, or tampered value; the service translates that into a
product error.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime

_CURSOR_VERSION = "v1"


def encode_cursor(*, secret: str, completed_at: datetime, report_id: str) -> str:
    payload = {
        "v": _CURSOR_VERSION,
        "c": _to_iso(completed_at),
        "i": report_id,
    }
    body = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64encode(_sign(secret, body))
    return f"{_CURSOR_VERSION}.{body}.{signature}"


def decode_cursor(*, secret: str, cursor: str) -> tuple[datetime, str]:
    parts = cursor.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed support feed cursor.")
    version, body, signature = parts
    if version != _CURSOR_VERSION:
        raise ValueError("Unsupported support feed cursor version.")
    expected_signature = _b64encode(_sign(secret, body))
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("Support feed cursor signature mismatch.")
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Corrupt support feed cursor payload.") from exc
    if not isinstance(payload, dict) or payload.get("v") != _CURSOR_VERSION:
        raise ValueError("Corrupt support feed cursor payload.")
    completed_raw = payload.get("c")
    report_id = payload.get("i")
    if not isinstance(completed_raw, str) or not isinstance(report_id, str):
        raise ValueError("Corrupt support feed cursor payload.")
    return _from_iso(completed_raw), report_id


def _sign(secret: str, body: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _from_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed
