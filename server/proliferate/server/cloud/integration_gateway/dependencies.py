"""Auth for the integration gateway: AnyHarness bearer token -> owner grant."""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.errors import CloudApiError


def _bearer_token_from_request(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Missing or malformed gateway bearer token.",
            status_code=401,
        )
    return token.strip()


async def require_integration_gateway_grant(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationGatewayGrant:
    """Resolve the AnyHarness gateway token to its owning worker's identity.

    The token proves "I am an authorized runtime for worker W"; Cloud derives
    the owning user/org and uses that to decide which integration accounts are
    visible.
    """
    token = _bearer_token_from_request(request)
    grant = await runtime_workers_store.get_grant_by_gateway_token_hash(
        db,
        token_hash=runtime_workers_store.hash_gateway_token(token),
    )
    if grant is None:
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Gateway token is invalid or revoked.",
            status_code=401,
        )
    return grant
