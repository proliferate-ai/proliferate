from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class ProtectedResourceMetadata:
    authorization_servers: tuple[str, ...]
    resource: str | None
    challenged_scope: str | None


@dataclass(frozen=True)
class AuthorizationServerMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None
    token_endpoint_auth_methods_supported: tuple[str, ...]


@dataclass(frozen=True)
class RegisteredOAuthClient:
    client_id: str
    client_secret: str | None
    client_secret_expires_at: datetime | None
    token_endpoint_auth_method: str | None
    registration_client_uri: str | None
    registration_access_token: str | None


@dataclass(frozen=True)
class TokenResponse:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    # ``None`` means the provider omitted scope metadata. An explicit empty
    # value remains ``()`` so exact policies can distinguish the two cases.
    scopes: tuple[str, ...] | None
