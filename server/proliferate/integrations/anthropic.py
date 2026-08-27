from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class AnthropicIntegrationError(Exception):
    status_code: int
    message: str

    def __str__(self) -> str:
        return self.message


_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
# Subscription OAuth credentials ride the Authorization header (never
# x-api-key) and require the OAuth beta flag.
_OAUTH_BETA = "oauth-2025-04-20"
# The cheapest current model — the probe pays one output token for headers.
_USAGE_PROBE_MODEL = "claude-haiku-4-5"


async def probe_subscription_usage(
    *,
    oauth_token: str,
    timeout_seconds: float = 15.0,
) -> tuple[int, dict[str, str]]:
    """One-token ``/v1/messages`` request under a subscription OAuth token.

    The agent_auth seat usage probe (flow 5's soft signal) calls this for the
    response's ``anthropic-ratelimit-unified-*`` headers; the body is never
    returned. Secret hygiene: ``oauth_token`` exists in the request headers
    only — it is never logged here (this module logs nothing) and never
    appears in an exception (transport failures raise a status-only error;
    HTTP error statuses do NOT raise, because a 429's headers still carry the
    utilization the caller wants).

    Returns ``(http_status, headers)`` with header names lower-cased.
    """
    payload = {
        "model": _USAGE_PROBE_MODEL,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "."}],
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                _MESSAGES_URL,
                headers={
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": _OAUTH_BETA,
                    "content-type": "application/json",
                    "authorization": f"Bearer {oauth_token}",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        # Deliberately message-free of request detail: an httpx transport
        # error's text names the URL at most, never headers, and this wrapper
        # adds nothing that could carry the token.
        raise AnthropicIntegrationError(
            status_code=599,
            message="Anthropic usage probe failed before a response arrived.",
        ) from exc
    return response.status_code, {
        key.lower(): value for key, value in response.headers.items()
    }


async def generate_message_text(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 64,
    temperature: float = 0.2,
) -> str:
    payload = {
        "model": model,
        "system": system_prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                "x-api-key": api_key,
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise AnthropicIntegrationError(
            status_code=response.status_code,
            message=response.text or "Anthropic request failed.",
        )

    payload = response.json()
    content = payload.get("content", [])
    text_parts = [
        block.get("text", "").strip()
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    text = "\n".join(part for part in text_parts if part)
    if not text:
        raise AnthropicIntegrationError(
            status_code=502,
            message="Anthropic response did not contain text content.",
        )
    return text
