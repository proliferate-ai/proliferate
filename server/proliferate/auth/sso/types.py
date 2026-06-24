"""Shared SSO auth types."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class SsoScope(StrEnum):
    DEPLOYMENT = "deployment"
    ORGANIZATION = "organization"


class SsoProtocol(StrEnum):
    OIDC = "oidc"
    SAML = "saml"


class SsoStatus(StrEnum):
    DRAFT = "draft"
    ENABLED = "enabled"
    DISABLED = "disabled"


class SsoLoginPolicy(StrEnum):
    OPTIONAL = "optional"
    REQUIRED = "required"


class SsoJitPolicy(StrEnum):
    DISABLED = "disabled"
    EXISTING_USER = "existing_user"
    CREATE_MEMBER = "create_member"


DEPLOYMENT_SSO_CONNECTION_KEY = "deployment"
DEFAULT_OIDC_SCOPES = ("openid", "email", "profile")


@dataclass(frozen=True)
class SsoConnectionSnapshot:
    id: UUID | None
    scope: SsoScope
    organization_id: UUID | None
    connection_key: str
    protocol: SsoProtocol
    status: SsoStatus
    display_name: str
    login_policy: SsoLoginPolicy
    jit_policy: SsoJitPolicy
    default_role: str
    allowed_domains: tuple[str, ...]
    oidc_issuer_url: str | None
    oidc_discovery_url: str | None
    oidc_authorization_endpoint: str | None
    oidc_token_endpoint: str | None
    oidc_jwks_uri: str | None
    oidc_userinfo_endpoint: str | None
    oidc_client_id: str | None
    oidc_client_secret: str | None
    oidc_client_secret_configured: bool
    oidc_scopes: tuple[str, ...]
    oidc_token_endpoint_auth_method: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class VerifiedSsoIdentity:
    provider_subject: str
    email: str | None
    email_verified: bool
    display_name: str | None
    avatar_url: str | None
    claims: dict[str, object]


def sso_connection_key(*, scope: SsoScope, connection_id: UUID | None) -> str:
    if scope == SsoScope.DEPLOYMENT:
        return DEPLOYMENT_SSO_CONNECTION_KEY
    if connection_id is None:
        raise ValueError("organization SSO connection requires a connection id")
    return f"organization:{connection_id}"
