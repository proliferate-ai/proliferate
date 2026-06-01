"""Stripe webhook signature verification and event construction."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

from proliferate.config import settings
from proliferate.integrations.stripe.errors import StripeIntegrationError
from proliferate.integrations.stripe.models import StripeSignature, StripeWebhookEvent

STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300


def construct_webhook_event(
    *,
    payload: bytes,
    signature_header: str | None,
    secret: str | None = None,
    now: int | None = None,
) -> StripeWebhookEvent:
    webhook_secret = settings.stripe_webhook_secret if secret is None else secret
    if not webhook_secret:
        raise StripeIntegrationError(
            "stripe_webhook_unconfigured",
            "Stripe webhook secret is not configured.",
            status_code=503,
        )
    verify_webhook_signature(
        payload=payload,
        signature_header=signature_header,
        secret=webhook_secret,
        now=now,
    )
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise StripeIntegrationError(
            "stripe_webhook_invalid_json",
            "Stripe webhook payload is not valid JSON.",
            status_code=400,
        ) from exc
    if not isinstance(event, dict):
        raise StripeIntegrationError(
            "stripe_webhook_invalid_event",
            "Stripe webhook payload must be an event object.",
            status_code=400,
        )

    event_id = event.get("id")
    event_type = event.get("type")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise StripeIntegrationError(
            "stripe_webhook_invalid_event",
            "Stripe webhook payload is missing an event id or type.",
            status_code=400,
        )
    livemode = event.get("livemode")
    data = event.get("data")
    data_object: Any = data.get("object") if isinstance(data, dict) else None
    return StripeWebhookEvent(
        event_id=event_id,
        event_type=event_type,
        livemode=livemode if isinstance(livemode, bool) else None,
        payload=event,
        data_object=data_object if isinstance(data_object, dict) else {},
    )


def verify_webhook_signature(
    *,
    payload: bytes,
    signature_header: str | None,
    secret: str,
    now: int | None = None,
) -> None:
    signature = parse_signature_header(signature_header)
    current_time = int(time.time()) if now is None else now
    if abs(current_time - signature.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS:
        raise StripeIntegrationError(
            "stripe_webhook_stale_signature",
            "Stripe webhook signature timestamp is outside the allowed tolerance.",
            status_code=401,
        )
    signed_payload = str(signature.timestamp).encode("ascii") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signature.signatures):
        raise StripeIntegrationError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature is invalid.",
            status_code=401,
        )


def parse_signature_header(signature_header: str | None) -> StripeSignature:
    if not signature_header:
        raise StripeIntegrationError(
            "stripe_webhook_missing_signature",
            "Stripe webhook signature header is missing.",
            status_code=401,
        )
    fields: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        key, separator, value = item.partition("=")
        if not separator:
            continue
        fields.setdefault(key, []).append(value)
    timestamps = fields.get("t") or []
    signatures = tuple(value for value in fields.get("v1", []) if value)
    try:
        timestamp = int(timestamps[0])
    except (IndexError, ValueError) as exc:
        raise StripeIntegrationError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature timestamp is invalid.",
            status_code=401,
        ) from exc
    if not signatures:
        raise StripeIntegrationError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature does not include a v1 signature.",
            status_code=401,
        )
    return StripeSignature(timestamp=timestamp, signatures=signatures)
