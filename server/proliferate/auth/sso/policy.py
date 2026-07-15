"""Pure policy helpers for SSO auth."""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import HTTPException

from proliferate.auth.sso.types import SsoConnectionSnapshot

# Stable machine reasons for an incomplete OIDC connection, mapped to the human
# 400 messages `start` has always raised. Surfaced verbatim as the
# `/auth/sso/discover` `reason` so a misconfigured deployment advertises
# `enabled: false` with an actionable code instead of a button that only fails
# at the provider.
OIDC_CONFIG_ERROR_MESSAGES: dict[str, str] = {
    "oidc_client_id_missing": "OIDC client ID is required.",
    "oidc_client_secret_missing": "OIDC client secret is required.",
    "oidc_endpoints_missing": "OIDC issuer or discovery URL is required.",
}


def oidc_configuration_error(
    connection: SsoConnectionSnapshot,
    *,
    require_secret: bool = True,
) -> str | None:
    """Return a stable reason code when an OIDC connection is missing required
    configuration, else ``None``. Single source of truth for "is this OIDC
    connection actually startable", consumed by discovery (advertise only usable
    configs), start-time validation, and the deployment doctor. Never raises."""
    if not connection.oidc_client_id:
        return "oidc_client_id_missing"
    if (
        require_secret
        and not connection.oidc_client_secret
        and (connection.oidc_token_endpoint_auth_method != "none")
    ):
        return "oidc_client_secret_missing"
    has_static_endpoints = (
        connection.oidc_issuer_url
        and connection.oidc_authorization_endpoint
        and connection.oidc_token_endpoint
        and connection.oidc_jwks_uri
    )
    if not has_static_endpoints and not (
        connection.oidc_issuer_url or connection.oidc_discovery_url
    ):
        return "oidc_endpoints_missing"
    return None


def normalize_domain(value: str) -> str:
    normalized = value.strip().lower()
    if normalized.startswith("@"):
        normalized = normalized[1:]
    return normalized


def normalize_domains(values: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        domain = normalize_domain(value)
        if not domain or domain in seen:
            continue
        seen.add(domain)
        normalized.append(domain)
    return tuple(normalized)


def email_domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return normalize_domain(email.rsplit("@", 1)[1])


def email_domain_allowed(email: str | None, allowed_domains: tuple[str, ...]) -> bool:
    if not allowed_domains:
        return True
    domain = email_domain(email)
    if domain is None:
        return False
    return domain in {normalize_domain(value) for value in allowed_domains}


def require_email_domain_allowed(email: str | None, allowed_domains: tuple[str, ...]) -> None:
    if not email_domain_allowed(email, allowed_domains):
        raise HTTPException(status_code=403, detail="Email domain is not allowed for this SSO.")


def oidc_discovery_url(issuer_or_discovery_url: str) -> str:
    value = issuer_or_discovery_url.strip().rstrip("/")
    if not value:
        raise HTTPException(status_code=400, detail="OIDC issuer URL is required.")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="OIDC issuer URL is invalid.")
    if value.endswith("/.well-known/openid-configuration"):
        return value
    return f"{value}/.well-known/openid-configuration"
