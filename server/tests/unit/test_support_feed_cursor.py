from __future__ import annotations

from datetime import UTC, datetime

import pytest

from proliferate.server.support.feed.domain.cursor import decode_cursor, encode_cursor

_SECRET = "cursor-signing-secret"


def test_cursor_round_trip_preserves_tuple() -> None:
    completed_at = datetime(2026, 7, 13, 12, 34, 56, tzinfo=UTC)
    cursor = encode_cursor(secret=_SECRET, completed_at=completed_at, report_id="report_1")
    decoded_at, decoded_id = decode_cursor(secret=_SECRET, cursor=cursor)
    assert decoded_at == completed_at
    assert decoded_id == "report_1"


def test_cursor_is_deterministic() -> None:
    completed_at = datetime(2026, 7, 13, tzinfo=UTC)
    a = encode_cursor(secret=_SECRET, completed_at=completed_at, report_id="r")
    b = encode_cursor(secret=_SECRET, completed_at=completed_at, report_id="r")
    assert a == b


def test_cursor_rejects_tampered_payload() -> None:
    cursor = encode_cursor(
        secret=_SECRET,
        completed_at=datetime(2026, 7, 13, tzinfo=UTC),
        report_id="r",
    )
    version, body, signature = cursor.split(".")
    tampered = f"{version}.{body}x.{signature}"
    with pytest.raises(ValueError):
        decode_cursor(secret=_SECRET, cursor=tampered)


def test_cursor_rejects_wrong_secret() -> None:
    cursor = encode_cursor(
        secret=_SECRET,
        completed_at=datetime(2026, 7, 13, tzinfo=UTC),
        report_id="r",
    )
    with pytest.raises(ValueError):
        decode_cursor(secret="different-secret", cursor=cursor)


def test_cursor_rejects_wrong_version() -> None:
    cursor = encode_cursor(
        secret=_SECRET,
        completed_at=datetime(2026, 7, 13, tzinfo=UTC),
        report_id="r",
    )
    _, body, signature = cursor.split(".")
    with pytest.raises(ValueError):
        decode_cursor(secret=_SECRET, cursor=f"v2.{body}.{signature}")


def test_cursor_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        decode_cursor(secret=_SECRET, cursor="not-a-cursor")
