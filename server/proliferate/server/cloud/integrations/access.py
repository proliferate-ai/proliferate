from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.server.cloud.errors import CloudApiError


@dataclass(frozen=True)
class IntegrationDefinitionScopeAccess:
    user_id: UUID
    organization_id: UUID | None


async def integration_definition_scope_user_can_read(
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationDefinitionScopeAccess:
    if organization_id is not None:
        membership = await organization_store.get_organization_with_membership(
            db,
            organization_id=organization_id,
            user_id=user.id,
        )
        if membership is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
    return IntegrationDefinitionScopeAccess(
        user_id=user.id,
        organization_id=organization_id,
    )
