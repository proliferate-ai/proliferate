"""Env-backed deployment SSO configuration."""

from __future__ import annotations

from fastapi import HTTPException

from proliferate.auth.sso.policy import normalize_domains
from proliferate.auth.sso.types import (
    DEFAULT_OIDC_SCOPES,
    DEPLOYMENT_SSO_CONNECTION_KEY,
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoLoginPolicy,
    SsoProtocol,
    SsoScope,
    SsoStatus,
)
from proliferate.config import settings


def deployment_sso_connection() -> SsoConnectionSnapshot | None:
    if not settings.sso_enabled:
        return None
    protocol = _enum_or_default(SsoProtocol, settings.sso_protocol, SsoProtocol.OIDC)
    allowed_domains = normalize_domains(_split_csv(settings.sso_allowed_domains))
    scopes = tuple(_split_scope_string(settings.sso_oidc_scopes)) or DEFAULT_OIDC_SCOPES
    return SsoConnectionSnapshot(
        id=None,
        scope=SsoScope.DEPLOYMENT,
        organization_id=None,
        connection_key=DEPLOYMENT_SSO_CONNECTION_KEY,
        protocol=protocol,
        status=SsoStatus.ENABLED,
        display_name=settings.sso_display_name.strip() or "Company SSO",
        login_policy=_deployment_login_policy(),
        jit_policy=_enum_or_default(SsoJitPolicy, settings.sso_jit_policy, SsoJitPolicy.DISABLED),
        default_role=settings.sso_default_role.strip() or "member",
        allowed_domains=allowed_domains,
        oidc_issuer_url=_none_if_blank(settings.sso_oidc_issuer_url),
        oidc_discovery_url=_none_if_blank(settings.sso_oidc_discovery_url),
        oidc_authorization_endpoint=_none_if_blank(settings.sso_oidc_authorization_endpoint),
        oidc_token_endpoint=_none_if_blank(settings.sso_oidc_token_endpoint),
        oidc_jwks_uri=_none_if_blank(settings.sso_oidc_jwks_uri),
        oidc_userinfo_endpoint=_none_if_blank(settings.sso_oidc_userinfo_endpoint),
        oidc_client_id=_none_if_blank(settings.sso_oidc_client_id),
        oidc_client_secret=_none_if_blank(settings.sso_oidc_client_secret),
        oidc_client_secret_configured=bool(settings.sso_oidc_client_secret.strip()),
        oidc_scopes=scopes,
        oidc_token_endpoint_auth_method=(
            settings.sso_oidc_token_endpoint_auth_method.strip() or "client_secret_basic"
        ),
    )


def _none_if_blank(value: str) -> str | None:
    stripped = value.strip()
    return stripped or None


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _split_scope_string(value: str) -> list[str]:
    return [item for item in value.replace(",", " ").split() if item]


def _deployment_login_policy() -> SsoLoginPolicy:
    policy = _enum_or_default(
        SsoLoginPolicy,
        settings.sso_login_policy,
        SsoLoginPolicy.OPTIONAL,
    )
    if policy == SsoLoginPolicy.REQUIRED:
        raise HTTPException(
            status_code=400,
            detail="Required SSO login policy is not supported yet.",
        )
    return policy


def _enum_or_default[T](enum_type: type[T], value: str, default: T) -> T:
    try:
        return enum_type(value.strip())  # type: ignore[call-arg]
    except ValueError:
        return default
