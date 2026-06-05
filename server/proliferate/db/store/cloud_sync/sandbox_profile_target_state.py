"""Persistence helpers for sandbox profile target applied state."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth import (
    AgentGatewayRuntimeGrant,
    SandboxProfileTargetState,
)
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow


async def load_state_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SandboxProfileTargetState | None:
    return (
        await db.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one_or_none()


async def mark_profile_target_replaced(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    replaced_target_id: UUID,
) -> None:
    now = utcnow()
    grants = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.target_id == replaced_target_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for grant in grants:
        grant.revoked_at = now

    workspaces = (
        (
            await db.execute(
                select(CloudWorkspace).where(
                    CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
                    CloudWorkspace.archived_at.is_(None),
                    or_(
                        CloudWorkspace.target_id == replaced_target_id,
                        CloudWorkspace.materialized_target_id == replaced_target_id,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for workspace in workspaces:
        workspace.materialized_target_id = None
        if workspace.anyharness_workspace_id is not None:
            workspace.status = "needs_rematerialization"
        workspace.updated_at = now
    await db.flush()
