"""Display helpers for SSO provider brands."""

from __future__ import annotations

from typing import Protocol
from urllib.parse import urlparse


class SsoBrandConnection(Protocol):
    display_name: str
    oidc_issuer_url: str | None
    oidc_discovery_url: str | None
    oidc_authorization_endpoint: str | None
    oidc_token_endpoint: str | None
    oidc_userinfo_endpoint: str | None


def sso_brand_label_for_connection(
    connection: SsoBrandConnection,
    provider_subject: str,
) -> str | None:
    return sso_brand_label_from_parts(
        connection.display_name,
        connection.oidc_issuer_url,
        connection.oidc_discovery_url,
        connection.oidc_authorization_endpoint,
        connection.oidc_token_endpoint,
        connection.oidc_userinfo_endpoint,
        provider_subject,
    )


def sso_brand_label_from_subject(provider_subject: str) -> str | None:
    return sso_brand_label_from_parts(provider_subject)


def sso_brand_label_from_parts(*parts: str | None) -> str | None:
    values = [part.strip().lower() for part in parts if part and part.strip()]
    if not values:
        return None
    hosts = [_url_host(value) for value in values]
    host_values = [host for host in hosts if host is not None]
    text_values = [value for value, host in zip(values, hosts, strict=False) if host is None]
    normalized = " ".join(text_values)
    subject = values[-1]
    if "auth0" in normalized or _has_domain_host(host_values, "auth0.com"):
        return "Auth0 SSO"
    if "gitlab" in normalized or _has_domain_host(host_values, "gitlab.com"):
        return "GitLab SSO"
    if (
        "google" in normalized
        or _has_domain_host(host_values, "accounts.google.com")
        or (subject.isdigit() and len(subject) >= 10)
    ):
        return "Google SSO"
    if (
        "microsoft" in normalized
        or "entra" in normalized
        or "azure" in normalized
        or _has_domain_host(host_values, "login.microsoftonline.com")
        or _has_domain_host(host_values, "sts.windows.net")
    ):
        return "Microsoft Entra"
    if (
        "okta" in normalized
        or _has_domain_host(host_values, "okta.com")
        or subject.startswith("00u")
    ):
        return "Okta SSO"
    return None


def _url_host(value: str) -> str | None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    return parsed.hostname.lower() if parsed.hostname else None


def _has_domain_host(hosts: list[str], domain: str) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for host in hosts)
