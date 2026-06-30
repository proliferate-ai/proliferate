"""Organization defaults created alongside product accounts."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations.domain.profile import (
    default_organization_name,
    derive_logo_domain_from_email,
)


class OrganizationRegistrationUser(Protocol):
    id: UUID
    email: str
    display_name: str | None


async def ensure_default_organization_for_account(
    db: AsyncSession,
    user: OrganizationRegistrationUser,
) -> None:
    await organization_store.ensure_default_organization_for_user(
        db,
        user_id=user.id,
        name=default_organization_name(email=user.email, display_name=user.display_name),
        logo_domain=derive_logo_domain_from_email(user.email),
    )
