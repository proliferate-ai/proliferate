"""API-facing organization SSO transaction helpers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops as db_session
from proliferate.db.store import auth_sso as sso_store
from proliferate.server.organizations.sso import service
from proliferate.server.organizations.sso.models import (
    OrganizationSsoConnectionRequest,
    OrganizationSsoConnectionUpdateRequest,
)


async def create_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    body: OrganizationSsoConnectionRequest,
) -> sso_store.SsoConnectionRecord:
    record = await service.create_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        body=body,
    )
    await db_session.commit_session(db)
    return record


async def update_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
    body: OrganizationSsoConnectionUpdateRequest,
) -> sso_store.SsoConnectionRecord:
    record = await service.update_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        connection_id=connection_id,
        body=body,
    )
    await db_session.commit_session(db)
    return record


async def test_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    record = await service.test_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    await db_session.commit_session(db)
    return record


async def enable_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    record = await service.enable_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    await db_session.commit_session(db)
    return record


async def disable_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    record = await service.disable_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    await db_session.commit_session(db)
    return record


async def delete_organization_sso_connection_and_commit(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    record = await service.delete_organization_sso_connection(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    await db_session.commit_session(db)
    return record
