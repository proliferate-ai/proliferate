from __future__ import annotations

from collections.abc import Mapping

import httpx

from proliferate.config import settings


async def post_anonymous_telemetry_payload(payload: Mapping[str, object]) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            settings.anonymous_telemetry_endpoint,
            json=dict(payload),
        )
        response.raise_for_status()
