"""Signed Slack OAuth state helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from uuid import UUID

from proliferate.config import settings
from proliferate.server.cloud.errors import CloudApiError

SLACK_OAUTH_STATE_TTL_SECONDS = 600


def create_oauth_state(*, organization_id: UUID, actor_user_id: UUID) -> str:
    payload = {
        "organizationId": str(organization_id),
        "actorUserId": str(actor_user_id),
        "expiresAt": int(time.time()) + SLACK_OAUTH_STATE_TTL_SECONDS,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = _sign(payload_bytes)
    return _b64(payload_bytes) + "." + _b64(signature)


def parse_oauth_state(value: str) -> tuple[UUID, UUID]:
    try:
        payload_part, signature_part = value.split(".", 1)
        payload_bytes = _unb64(payload_part)
        signature = _unb64(signature_part)
    except (ValueError, TypeError) as exc:
        raise CloudApiError(
            "slack_oauth_state_invalid",
            "OAuth state is invalid.",
            status_code=400,
        ) from exc
    if not hmac.compare_digest(_sign(payload_bytes), signature):
        raise CloudApiError(
            "slack_oauth_state_invalid",
            "OAuth state is invalid.",
            status_code=400,
        )
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
        organization_id = UUID(str(payload["organizationId"]))
        actor_user_id = UUID(str(payload["actorUserId"]))
        expires_at = int(payload["expiresAt"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CloudApiError(
            "slack_oauth_state_invalid",
            "OAuth state is invalid.",
            status_code=400,
        ) from exc
    if expires_at < int(time.time()):
        raise CloudApiError(
            "slack_oauth_state_expired",
            "OAuth state has expired.",
            status_code=400,
        )
    return organization_id, actor_user_id


def _sign(payload: bytes) -> bytes:
    secret = settings.cloud_secret_key.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).digest()


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("utf-8"))
