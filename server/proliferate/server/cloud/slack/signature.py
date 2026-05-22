"""Slack request signature verification."""

from __future__ import annotations

import hashlib
import hmac
import time

from proliferate.constants.slack import SLACK_SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS
from proliferate.server.cloud.errors import CloudApiError


def verify_slack_signature(
    *,
    signing_secret: str,
    body: bytes,
    timestamp_header: str | None,
    signature_header: str | None,
    now_seconds: int | None = None,
) -> None:
    if not signing_secret:
        raise CloudApiError(
            "slack_signing_secret_unconfigured",
            "Slack signing secret is not configured.",
            status_code=503,
        )
    if not timestamp_header or not signature_header:
        raise CloudApiError(
            "slack_signature_missing",
            "Slack signature headers are required.",
            status_code=401,
        )
    try:
        timestamp = int(timestamp_header)
    except ValueError as exc:
        raise CloudApiError(
            "slack_signature_timestamp_invalid",
            "Slack signature timestamp is invalid.",
            status_code=401,
        ) from exc
    current = now_seconds if now_seconds is not None else int(time.time())
    if abs(current - timestamp) > SLACK_SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS:
        raise CloudApiError(
            "slack_signature_timestamp_expired",
            "Slack signature timestamp is outside the accepted window.",
            status_code=401,
        )
    signed = b"v0:" + str(timestamp).encode("utf-8") + b":" + body
    digest = hmac.new(signing_secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    expected = f"v0={digest}"
    if not hmac.compare_digest(expected, signature_header):
        raise CloudApiError(
            "slack_signature_invalid",
            "Slack signature is invalid.",
            status_code=401,
        )
