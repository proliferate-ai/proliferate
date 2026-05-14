"""Cloud event payload retention decisions."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from typing import cast

LIVE_ONLY_EVENT_TYPES = frozenset(
    {
        "item_delta",
        "assistant_message_delta",
        "tool_call_delta",
        "token_delta",
        "terminal_output_delta",
        "browser_frame_delta",
        "computer_use_frame_delta",
    }
)

INLINE_SOFT_CAP_BYTES = 64 * 1024
INLINE_HARD_CAP_BYTES = 256 * 1024

RAW_BODY_REPLACEMENT = {
    "retention": "stripped",
    "reason": "raw tool bodies are not retained in cloud event sync",
}


@dataclass(frozen=True)
class PayloadPolicyDecision:
    durable: bool
    payload_json: str | None
    payload_hash: str
    payload_size_bytes: int
    payload_truncated_at_bytes: int | None


def event_is_durable(event_type: str) -> bool:
    return event_type not in LIVE_ONLY_EVENT_TYPES


def retained_payload(event_type: str, envelope: dict[str, object]) -> PayloadPolicyDecision:
    if not event_is_durable(event_type):
        return PayloadPolicyDecision(
            durable=False,
            payload_json=None,
            payload_hash=sha256(b"").hexdigest(),
            payload_size_bytes=0,
            payload_truncated_at_bytes=None,
        )
    sanitized = _strip_raw_bodies(deepcopy(envelope))
    encoded = json.dumps(sanitized, separators=(",", ":"), sort_keys=True)
    size_bytes = len(encoded.encode("utf-8"))
    if size_bytes <= INLINE_HARD_CAP_BYTES:
        return PayloadPolicyDecision(
            durable=True,
            payload_json=encoded,
            payload_hash=sha256(encoded.encode("utf-8")).hexdigest(),
            payload_size_bytes=size_bytes,
            payload_truncated_at_bytes=None,
        )
    truncated = encoded.encode("utf-8")[:INLINE_HARD_CAP_BYTES].decode(
        "utf-8",
        errors="ignore",
    )
    return PayloadPolicyDecision(
        durable=True,
        payload_json=json.dumps(
            {
                "type": event_type,
                "payload": truncated,
                "payloadTruncated": True,
                "payloadOriginalBytes": size_bytes,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        payload_hash=sha256(encoded.encode("utf-8")).hexdigest(),
        payload_size_bytes=size_bytes,
        payload_truncated_at_bytes=INLINE_HARD_CAP_BYTES,
    )


def _strip_raw_bodies(value: object) -> object:
    if isinstance(value, dict):
        sanitized: dict[str, object] = {}
        for key, child in cast("dict[object, object]", value).items():
            if not isinstance(key, str):
                continue
            if key in {"rawInput", "rawOutput", "raw_input", "raw_output"}:
                sanitized[key] = RAW_BODY_REPLACEMENT
            else:
                sanitized[key] = _strip_raw_bodies(child)
        return sanitized
    if isinstance(value, list):
        return [_strip_raw_bodies(child) for child in value]
    return value
