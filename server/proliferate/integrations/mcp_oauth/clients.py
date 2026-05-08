from __future__ import annotations

from datetime import UTC, datetime

import httpx

from proliferate.integrations.mcp_oauth.errors import McpOAuthProviderError
from proliferate.integrations.mcp_oauth.models import (
    AuthorizationServerMetadata,
    RegisteredOAuthClient,
)


async def register_client(
    metadata: AuthorizationServerMetadata,
    redirect_uri: str,
) -> RegisteredOAuthClient:
    if not metadata.registration_endpoint:
        raise McpOAuthProviderError(
            "registration_failed",
            "This OAuth provider does not support dynamic client registration.",
        )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            metadata.registration_endpoint,
            json={
                "client_name": "Proliferate",
                "application_type": "web",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": _registration_token_auth_method(metadata),
            },
        )
        response.raise_for_status()
        payload = response.json()
    return RegisteredOAuthClient(
        client_id=str(payload["client_id"]),
        client_secret=payload.get("client_secret"),
        client_secret_expires_at=_client_secret_expires_at(
            payload.get("client_secret_expires_at")
        ),
        token_endpoint_auth_method=payload.get("token_endpoint_auth_method"),
        registration_client_uri=payload.get("registration_client_uri"),
        registration_access_token=payload.get("registration_access_token"),
    )


def _registration_token_auth_method(metadata: AuthorizationServerMetadata) -> str:
    supported = metadata.token_endpoint_auth_methods_supported
    if not supported:
        return "none"
    for method in ("none", "client_secret_post", "client_secret_basic"):
        if method in supported:
            return method
    raise McpOAuthProviderError(
        "unsupported_client_auth",
        "OAuth provider does not support a client authentication method Proliferate can use.",
    )


def _client_secret_expires_at(value: object) -> datetime | None:
    if isinstance(value, int) and value > 0:
        return datetime.fromtimestamp(value, tz=UTC)
    return None
