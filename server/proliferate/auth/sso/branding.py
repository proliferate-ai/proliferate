"""Display helpers for SSO provider brands."""

from __future__ import annotations

from typing import Protocol


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
    normalized = " ".join(values)
    subject = values[-1]
    if "auth0" in normalized:
        return "Auth0 SSO"
    if "gitlab" in normalized:
        return "GitLab SSO"
    if (
        "accounts.google.com" in normalized
        or "google" in normalized
        or (subject.isdigit() and len(subject) >= 10)
    ):
        return "Google SSO"
    if (
        "login.microsoftonline.com" in normalized
        or "sts.windows.net" in normalized
        or "microsoft" in normalized
        or "entra" in normalized
        or "azure" in normalized
    ):
        return "Microsoft Entra"
    if "okta" in normalized or subject.startswith("00u"):
        return "Okta SSO"
    return None
