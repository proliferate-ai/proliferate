"""Organization join link helpers."""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

from proliferate.config import settings


def organization_join_path(organization_id: UUID) -> str:
    return f"/join/{organization_id}"


def organization_join_url(organization_id: UUID) -> str:
    path = organization_join_path(organization_id)
    base_url = (settings.frontend_base_url or settings.api_base_url).rstrip("/")
    if not base_url:
        return path
    return f"{base_url}{path}"


def invitation_registration_url(*, invitation_id: UUID, email: str) -> str:
    """Self-registration link for single-org deployments.

    The /join/<org> route lives in the hosted web app, which self-hosted
    servers do not serve. Their invite emails link to the server-rendered
    /register page instead, prefilled with the invitation token.
    """
    base_url = settings.api_base_url.rstrip("/")
    path = f"/register?token={invitation_id}&email={quote(email)}"
    return f"{base_url}{path}" if base_url else path
