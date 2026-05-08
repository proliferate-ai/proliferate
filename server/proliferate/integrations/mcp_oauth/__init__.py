from __future__ import annotations

from proliferate.integrations.mcp_oauth.clients import register_client
from proliferate.integrations.mcp_oauth.discovery import (
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
)
from proliferate.integrations.mcp_oauth.errors import McpOAuthProviderError
from proliferate.integrations.mcp_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
    TokenResponse,
)
from proliferate.integrations.mcp_oauth.tokens import exchange_token, refresh_token
from proliferate.integrations.mcp_oauth.urls import (
    build_authorization_url,
    code_challenge,
    normalize_resource_url,
    random_urlsafe,
)

__all__ = [
    "AuthorizationServerMetadata",
    "McpOAuthProviderError",
    "ProtectedResourceMetadata",
    "RegisteredOAuthClient",
    "TokenResponse",
    "build_authorization_url",
    "code_challenge",
    "discover_authorization_server_metadata",
    "discover_protected_resource_metadata",
    "exchange_token",
    "normalize_resource_url",
    "random_urlsafe",
    "refresh_token",
    "register_client",
]
