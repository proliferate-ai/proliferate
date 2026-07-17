from __future__ import annotations

from uuid import UUID

import pytest

from proliferate.server.cloud.integration_gateway.domain import execution_session
from proliferate.server.cloud.integration_gateway.domain.execution_session import (
    mint_execution_session_token,
    verify_execution_session_token,
)

_SECRET = "test-signing-secret"
_WORKER_ID = UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
_OTHER_WORKER_ID = UUID("ffffffff-1111-4222-8333-444444444444")
_SESSION_ID = UUID("12345678-1234-4234-9234-123456789abc")
_TOKEN = "v1.EjRWeBI0QjSSNBI0VniavA.lsgwBDu4ArLmu3v8iSa4P5lXrHxQvUvTCCp4didILog"


def _mint_fixed_token(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(execution_session, "uuid4", lambda: _SESSION_ID)
    return mint_execution_session_token(secret=_SECRET, runtime_worker_id=_WORKER_ID)


def test_mint_and_verify_round_trip_is_versioned_and_deterministic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = _mint_fixed_token(monkeypatch)

    assert token == _TOKEN
    assert (
        verify_execution_session_token(
            secret=_SECRET,
            runtime_worker_id=_WORKER_ID,
            token=token,
        )
        == _SESSION_ID
    )


def test_verification_rejects_cross_worker_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    token = _mint_fixed_token(monkeypatch)

    assert (
        verify_execution_session_token(
            secret=_SECRET,
            runtime_worker_id=_OTHER_WORKER_ID,
            token=token,
        )
        is None
    )


def test_verification_rejects_wrong_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    token = _mint_fixed_token(monkeypatch)

    assert (
        verify_execution_session_token(
            secret="different-secret",
            runtime_worker_id=_WORKER_ID,
            token=token,
        )
        is None
    )


@pytest.mark.parametrize(
    "token",
    [
        "",
        "not-a-token",
        "v1.only-two-parts",
        f"{_TOKEN}.extra",
        _TOKEN.replace("v1.", "v2.", 1),
        _TOKEN.replace("EjRWeBI0QjSSNBI0VniavA", "EjRWeBI0QjSSNBI0Vniav="),
        _TOKEN.replace("EjRWeBI0QjSSNBI0VniavA", "EjRWeBI0QjSSNBI0Vniav!"),
        f"{_TOKEN}=",
    ],
)
def test_verification_strictly_rejects_malformed_tokens(token: str) -> None:
    assert (
        verify_execution_session_token(
            secret=_SECRET,
            runtime_worker_id=_WORKER_ID,
            token=token,
        )
        is None
    )


def test_verification_rejects_tampered_body_and_signature() -> None:
    version, body, signature = _TOKEN.split(".")
    tampered_body = f"{version}.{body[:-1]}B.{signature}"
    tampered_signature = f"{version}.{body}.{signature[:-1]}A"

    for token in (tampered_body, tampered_signature):
        assert (
            verify_execution_session_token(
                secret=_SECRET,
                runtime_worker_id=_WORKER_ID,
                token=token,
            )
            is None
        )


def test_verification_rejects_non_uuid4_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        execution_session,
        "uuid4",
        lambda: UUID("12345678-1234-1234-9234-123456789abc"),
    )
    token = mint_execution_session_token(secret=_SECRET, runtime_worker_id=_WORKER_ID)

    assert (
        verify_execution_session_token(
            secret=_SECRET,
            runtime_worker_id=_WORKER_ID,
            token=token,
        )
        is None
    )


def test_empty_secret_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(execution_session, "uuid4", lambda: _SESSION_ID)
    with pytest.raises(ValueError, match="must not be empty"):
        mint_execution_session_token(secret="", runtime_worker_id=_WORKER_ID)

    assert (
        verify_execution_session_token(
            secret="",
            runtime_worker_id=_WORKER_ID,
            token=_TOKEN,
        )
        is None
    )


def test_non_string_token_fails_closed() -> None:
    assert (
        verify_execution_session_token(
            secret=_SECRET,
            runtime_worker_id=_WORKER_ID,
            token=None,  # type: ignore[arg-type]
        )
        is None
    )
