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
from uuid import UUID, uuid4

_TOKEN_VERSION = "v1"
_SIGNING_DOMAIN = b"proliferate.integration-gateway.execution-session"
_UUID_BODY_LENGTH = 22
_SHA256_SIGNATURE_LENGTH = 43
_BASE64URL_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def mint_execution_session_token(*, secret: str, runtime_worker_id: UUID) -> str:
    """Mint an opaque MCP session token bound to ``runtime_worker_id``."""
    if not secret:
        raise ValueError("Execution-session signing secret must not be empty.")

    session_id = uuid4()
    body = _b64encode(session_id.bytes)
    signature = _b64encode(
        _sign(
            secret=secret,
            runtime_worker_id=runtime_worker_id,
            session_id=session_id,
        )
    )
    return f"{_TOKEN_VERSION}.{body}.{signature}"


def verify_execution_session_token(
    *,
    secret: str,
    runtime_worker_id: UUID,
    token: str,
) -> UUID | None:
    """Return the trusted session UUID, or ``None`` when ``token`` is invalid."""
    if not secret or not isinstance(token, str):
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
        )
    )
    if not hmac.compare_digest(signature, expected_signature):
        return None
    return session_id


def _sign(*, secret: str, runtime_worker_id: UUID, session_id: UUID) -> bytes:
    message = b"\0".join(
        (
            _SIGNING_DOMAIN,
            _TOKEN_VERSION.encode("ascii"),
            runtime_worker_id.bytes,
            session_id.bytes,
        )
    )
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()


def _is_canonical_segment(value: str, *, expected_length: int) -> bool:
    return len(value) == expected_length and all(char in _BASE64URL_ALPHABET for char in value)


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)
