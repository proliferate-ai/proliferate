"""Web beta allowlist policy for hosted browser sessions."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.errors import PermissionDenied

WEB_BETA_EMAIL_MISSING_CODE = "web_beta_email_missing"
WEB_BETA_EMAIL_NOT_ALLOWED_CODE = "web_beta_email_not_allowed"


class WebBetaAccessDenied(PermissionDenied):
    """Raised when an authenticated identity is not eligible for hosted web."""


def web_beta_gate_configured() -> bool:
    allowed_emails, allowed_domains = _allowed_beta_config()
    return bool(allowed_emails or allowed_domains)


def ensure_web_beta_email_allowed(email: str | None) -> None:
    allowed_emails, allowed_domains = _allowed_beta_config()
    if not allowed_emails and not allowed_domains:
        return

    normalized_email = _normalize_email(email)
    if normalized_email is None:
        raise WebBetaAccessDenied(
            "Web access is currently limited to beta users. "
            "Sign in with a beta-approved email address.",
            code=WEB_BETA_EMAIL_MISSING_CODE,
        )

    if normalized_email in allowed_emails:
        return

    domain = normalized_email.rsplit("@", 1)[1]
    if domain in allowed_domains:
        return

    raise WebBetaAccessDenied(
        "Web access is currently limited to beta users. "
        "This email is not enrolled in the web beta.",
        code=WEB_BETA_EMAIL_NOT_ALLOWED_CODE,
    )


def _normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    normalized = email.strip().lower()
    if not normalized or "@" not in normalized:
        return None
    local, domain = normalized.rsplit("@", 1)
    if not local or not domain:
        return None
    return normalized


def _allowed_emails() -> set[str]:
    return {
        normalized
        for raw in settings.web_beta_allowed_emails.split(",")
        if (normalized := _normalize_email(raw)) is not None
    }


def _allowed_domains() -> set[str]:
    domains: set[str] = set()
    for raw in settings.web_beta_allowed_domains.split(","):
        normalized = raw.strip().lower().removeprefix("@")
        if normalized and "@" not in normalized:
            domains.add(normalized)
    return domains


def _allowed_beta_config() -> tuple[set[str], set[str]]:
    return _allowed_emails(), _allowed_domains()
