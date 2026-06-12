"""Shared AnyHarness runtime protocol helpers."""

from __future__ import annotations


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def response_preview(text: str, *, max_chars: int = 240) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[:max_chars]}..."


def rejected_response_message(action: str, status_code: int, text: str) -> str:
    preview = response_preview(text)
    suffix = f" Response: {preview}" if preview else ""
    return f"Cloud runtime failed to {action} (status {status_code}).{suffix}"
