from __future__ import annotations

from typing import Any

import httpx

from proliferate.integrations.slack.errors import SlackWebhookError


async def post_incoming_webhook(
    *,
    webhook_url: str,
    text: str,
    blocks: list[dict[str, Any]] | None = None,
) -> None:
    payload: dict[str, Any] = {"text": text}
    if blocks:
        payload["blocks"] = blocks

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(webhook_url, json=payload)
    except httpx.HTTPError as exc:
        raise SlackWebhookError(f"Slack webhook request failed: {exc}") from exc

    body = response.text.strip()
    if response.status_code != 200 or body.lower() != "ok":
        raise SlackWebhookError(f"Slack webhook returned {response.status_code}: {body[:300]}")
