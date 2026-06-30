"""Pure policy helpers for SSO auth."""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import HTTPException


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
