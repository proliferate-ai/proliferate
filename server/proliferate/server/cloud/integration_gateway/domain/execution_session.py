"""Authenticated opaque session identifiers for the integration gateway MCP surface.

The MCP session identifier is minted by the control plane and authenticated with
an HMAC that binds it to one exact runtime worker.  Callers must treat the token
as opaque.  Verification is pure: the signing secret is supplied by the caller,
and every malformed, mis-versioned, forged, or cross-worker token fails closed.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
from dataclasses import dataclass
from uuid import UUID, uuid4

_TOKEN_VERSION = "v2"
_SIGNING_DOMAIN = b"proliferate.integration-gateway.execution-session"
_UUID_BODY_LENGTH = 22
_SHA256_SIGNATURE_LENGTH = 43
_BASE64URL_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
_IDENTITY_ALPHABET = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.:"
)


@dataclass(frozen=True)
class ExecutionSessionIdentity:
    """Control-plane-authenticated runtime launch identity for one MCP session."""

    gateway_session_id: UUID
    workspace_id: str | None
    anyharness_session_id: str | None

    @property
    def is_action_capable(self) -> bool:
        return self.workspace_id is not None and self.anyharness_session_id is not None


def mint_execution_session_token(
    *,
    secret: str,
    runtime_worker_id: UUID,
    workspace_id: str | None = None,
    anyharness_session_id: str | None = None,
) -> str:
    """Mint an opaque MCP session token bound to ``runtime_worker_id``."""
    if not secret:
        raise ValueError("Execution-session signing secret must not be empty.")
    _validate_launch_identity(workspace_id, anyharness_session_id)

    session_id = uuid4()
    body = _b64encode(session_id.bytes)
    signature = _b64encode(
        _sign(
            secret=secret,
            runtime_worker_id=runtime_worker_id,
            session_id=session_id,
            workspace_id=workspace_id,
            anyharness_session_id=anyharness_session_id,
        )
    )
    return f"{_TOKEN_VERSION}.{body}.{signature}"


def verify_execution_session_token(
    *,
    secret: str,
    runtime_worker_id: UUID,
    token: str,
    workspace_id: str | None = None,
    anyharness_session_id: str | None = None,
) -> UUID | None:
    """Return the trusted session UUID, or ``None`` when ``token`` is invalid."""
    if not secret or not isinstance(token, str):
        return None
    try:
        _validate_launch_identity(workspace_id, anyharness_session_id)
    except ValueError:
        return None

    parts = token.split(".")
    if len(parts) != 3:
        return None
    version, body, signature = parts
    if version != _TOKEN_VERSION:
        return None
    if not _is_canonical_segment(body, expected_length=_UUID_BODY_LENGTH):
        return None
    if not _is_canonical_segment(signature, expected_length=_SHA256_SIGNATURE_LENGTH):
        return None

    try:
        session_bytes = _b64decode(body)
        if len(session_bytes) != 16 or _b64encode(session_bytes) != body:
            return None
        session_id = UUID(bytes=session_bytes)
    except (ValueError, binascii.Error):
        return None
    if session_id.version != 4:
        return None

    expected_signature = _b64encode(
        _sign(
            secret=secret,
            runtime_worker_id=runtime_worker_id,
            session_id=session_id,
            workspace_id=workspace_id,
            anyharness_session_id=anyharness_session_id,
        )
    )
    if not hmac.compare_digest(signature, expected_signature):
        return None
    return session_id


def _sign(
    *,
    secret: str,
    runtime_worker_id: UUID,
    session_id: UUID,
    workspace_id: str | None,
    anyharness_session_id: str | None,
) -> bytes:
    message = b"".join(
        _length_prefixed(value)
        for value in (
            _SIGNING_DOMAIN,
            _TOKEN_VERSION.encode("ascii"),
            runtime_worker_id.bytes,
            session_id.bytes,
            (workspace_id or "").encode("utf-8"),
            (anyharness_session_id or "").encode("utf-8"),
        )
    )
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()


def _validate_launch_identity(
    workspace_id: str | None,
    anyharness_session_id: str | None,
) -> None:
    if (workspace_id is None) != (anyharness_session_id is None):
        raise ValueError("Workspace and AnyHarness session identity must be supplied together.")
    for label, value in (
        ("workspace", workspace_id),
        ("AnyHarness session", anyharness_session_id),
    ):
        if value is None:
            continue
        if not 1 <= len(value) <= 255 or any(char not in _IDENTITY_ALPHABET for char in value):
            raise ValueError(f"{label} identity is malformed.")


def _length_prefixed(value: bytes) -> bytes:
    return len(value).to_bytes(4, "big") + value


def _is_canonical_segment(value: str, *, expected_length: int) -> bool:
    return len(value) == expected_length and all(char in _BASE64URL_ALPHABET for char in value)


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)
