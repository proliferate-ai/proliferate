from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class AnthropicIntegrationError(Exception):
    status_code: int
    message: str

    def __str__(self) -> str:
        return self.message


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
