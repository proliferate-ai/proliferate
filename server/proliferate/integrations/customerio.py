"""Customer.io tracking service."""

import httpx

from proliferate.config import settings

CIO_BASE = "https://track.customer.io/api/v1"


async def identify_user(user_id: str, email: str, **attrs: str) -> None:
    if not settings.customerio_site_id:
        return
    async with httpx.AsyncClient() as client:
        await client.put(
            f"{CIO_BASE}/customers/{user_id}",
            auth=(settings.customerio_site_id, settings.customerio_api_key),
            json={"email": email, **attrs},
        )


async def track_event(user_id: str, event: str, **data: str) -> None:
    if not settings.customerio_site_id:
        return
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{CIO_BASE}/customers/{user_id}/events",
            auth=(settings.customerio_site_id, settings.customerio_api_key),
            json={"name": event, "data": data},
        )
