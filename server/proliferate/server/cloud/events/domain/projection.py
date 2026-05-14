"""Pure helpers for Cloud session/transcript projections."""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast


def event_type(envelope: Mapping[str, object]) -> str:
    event = envelope.get("event")
    if isinstance(event, dict):
        value = cast("Mapping[str, object]", event).get("type")
        if isinstance(value, str) and value:
            return value
    return "unknown"


def source_kind_for_event(event: Mapping[str, object]) -> str:
    kind = _transcript_item(event).get("kind")
    if kind == "user_message":
        return "user"
    if kind in {"assistant_message", "reasoning", "plan", "proposed_plan"}:
        return "assistant"
    if kind == "tool_invocation":
        return "tool"
    return "system"


def transcript_item_id(envelope: Mapping[str, object]) -> str | None:
    item_id = envelope.get("itemId")
    if isinstance(item_id, str) and item_id:
        return item_id
    item = _transcript_item(envelope.get("event"))
    for key in ("messageId", "toolCallId", "promptId"):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    seq = envelope.get("seq")
    if isinstance(seq, int):
        return f"seq:{seq}"
    return None


def transcript_item_payload(event: Mapping[str, object]) -> dict[str, object]:
    return _transcript_item(event)


def transcript_item_text(item: Mapping[str, object]) -> str | None:
    parts = item.get("contentParts")
    if not isinstance(parts, list):
        return None
    text_parts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") in {"text", "reasoning"} and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
    return "".join(text_parts) if text_parts else None


def _transcript_item(event: object) -> dict[str, object]:
    if not isinstance(event, dict):
        return {}
    item = cast("Mapping[str, object]", event).get("item")
    return cast("dict[str, object]", item) if isinstance(item, dict) else {}
