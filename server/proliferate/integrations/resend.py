"""Resend transactional email adapter."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from proliferate.config import settings

RESEND_API_BASE = "https://api.resend.com"
RESEND_TIMEOUT_SECONDS = 10.0


class ResendEmailError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class ResendEmailResult:
    provider_message_id: str | None
    skipped: bool = False


async def send_organization_invitation_email(
    *,
    to_email: str,
    organization_name: str,
    inviter_email: str,
    invite_url: str,
) -> ResendEmailResult:
    if not settings.resend_api_key or not settings.resend_from_email:
        return ResendEmailResult(provider_message_id=None, skipped=True)

    payload = {
        "from": settings.resend_from_email,
        "to": [to_email],
        "subject": f"Join {organization_name} on Proliferate",
        "html": _organization_invitation_html(
            organization_name=organization_name,
            inviter_email=inviter_email,
            invite_url=invite_url,
        ),
        "text": (
            f"{inviter_email} invited you to join {organization_name} on Proliferate.\n\n"
            f"Open this link to accept: {invite_url}\n"
        ),
    }
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=RESEND_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{RESEND_API_BASE}/emails",
                headers=headers,
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise ResendEmailError(
            "resend_request_failed",
            "Could not reach Resend for organization invitation delivery.",
        ) from exc

    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        message = "Resend invitation email request failed."
        if isinstance(body, dict) and isinstance(body.get("message"), str):
            message = body["message"]
        raise ResendEmailError("resend_request_failed", message)
    provider_message_id = body.get("id") if isinstance(body, dict) else None
    return ResendEmailResult(
        provider_message_id=provider_message_id if isinstance(provider_message_id, str) else None,
    )


def _organization_invitation_html(
    *,
    organization_name: str,
    inviter_email: str,
    invite_url: str,
) -> str:
    escaped_name = _escape_html(organization_name)
    escaped_inviter = _escape_html(inviter_email)
    escaped_url = _escape_html(invite_url)
    return (
        "<!doctype html>"
        "<html><body>"
        f"<p>{escaped_inviter} invited you to join {escaped_name} on Proliferate.</p>"
        f'<p><a href="{escaped_url}">Accept invitation</a></p>'
        "<p>If you did not expect this invitation, you can ignore this email.</p>"
        "</body></html>"
    )


def _escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )
