"""Organization join link helpers."""

from __future__ import annotations

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
