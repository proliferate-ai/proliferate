"""Persistence helpers for sandbox profile target applied state."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
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


async def invalidate_applied_on_slot_replacement(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    replaced_sandbox_id: UUID | None = None,
    replaced_slot_generation: int | None = None,
) -> None:
    now = utcnow()
    state = await load_state_for_profile_target(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    slot_matches_state = replaced_sandbox_id is None or (
        state is not None
        and state.active_sandbox_id == replaced_sandbox_id
        and state.slot_generation == replaced_slot_generation
    )
    if state is not None and slot_matches_state:
        state.active_sandbox_id = None
        state.slot_generation = None
        state.applied_agent_auth_revision = None
        state.agent_auth_status = "pending"
        state.applied_runtime_config_sequence = 0
        state.applied_runtime_config_revision_id = None
        state.runtime_config_status = "pending"
        state.updated_at = now
    grants = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.target_id == target_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                    *(
                        (
                            AgentGatewayRuntimeGrant.cloud_sandbox_id == replaced_sandbox_id,
                            AgentGatewayRuntimeGrant.slot_generation == replaced_slot_generation,
                        )
                        if replaced_sandbox_id is not None
                        else ()
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for grant in grants:
        grant.revoked_at = now
    rows = (
        (
            await db.execute(
                select(CloudWorkspace).where(
                    CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
                    CloudWorkspace.target_id == target_id,
                    CloudWorkspace.archived_at.is_(None),
                    *(
                        (CloudWorkspace.materialized_slot_generation == replaced_slot_generation,)
                        if replaced_sandbox_id is not None
                        else ()
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for workspace in rows:
        workspace.materialized_slot_generation = None
        if workspace.anyharness_workspace_id is not None:
            workspace.status = "needs_rematerialization"
        workspace.updated_at = now
    await db.flush()
