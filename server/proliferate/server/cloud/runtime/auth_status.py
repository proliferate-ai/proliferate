"""Agent-auth target state projection for cloud runtime responses."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store


@dataclass(frozen=True)
class RuntimeAuthStateSnapshot:
    status: str
    config_current: bool
    target_current: bool
    requires_restart: bool
    desired_revision: int | None
    applied_revision: int | None
    last_error: str | None
    last_error_at: datetime | None
    last_attempted_at: datetime | None
    last_applied_at: datetime | None


def _snapshot(
    *,
    status: str,
    config_current: bool,
    target_current: bool,
    requires_restart: bool = False,
    desired_revision: int | None = None,
    applied_revision: int | None = None,
    last_error: str | None = None,
    last_error_at: datetime | None = None,
    last_attempted_at: datetime | None = None,
    last_applied_at: datetime | None = None,
) -> RuntimeAuthStateSnapshot:
    return RuntimeAuthStateSnapshot(
        status=status,
        config_current=config_current,
        target_current=target_current,
        requires_restart=requires_restart,
        desired_revision=desired_revision,
        applied_revision=applied_revision,
        last_error=last_error,
        last_error_at=last_error_at,
        last_attempted_at=last_attempted_at,
        last_applied_at=last_applied_at,
    )


async def build_workspace_runtime_auth_snapshot(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    runtime_environment: CloudRuntimeEnvironment | None,
) -> RuntimeAuthStateSnapshot | None:
    profile_id = workspace.sandbox_profile_id
    target_id = workspace.target_id or (
        runtime_environment.target_id if runtime_environment is not None else None
    )
    profile = None
    if profile_id is not None:
        profile = await agent_auth_store.get_sandbox_profile(db, profile_id)
    else:
        profile = await agent_auth_store.get_active_personal_sandbox_profile_for_user(
            db,
            workspace.user_id,
        )
        profile_id = profile.id if profile is not None else None
        target_id = target_id or (profile.primary_target_id if profile is not None else None)

    if profile is None:
        return None

    selections = await agent_auth_store.list_selections_for_profile(db, profile.id)
    has_active_selection = any(selection.status == "active" for selection in selections)
    if not has_active_selection:
        return _snapshot(
            status="missing_credentials",
            config_current=False,
            target_current=False,
            desired_revision=profile.agent_auth_revision,
        )

    if target_id is None:
        return _snapshot(
            status="stale",
            config_current=False,
            target_current=False,
            desired_revision=profile.agent_auth_revision,
        )

    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
    )
    if state is None:
        return _snapshot(
            status="stale",
            config_current=False,
            target_current=False,
            desired_revision=profile.agent_auth_revision,
        )

    config_current = state.desired_revision >= profile.agent_auth_revision
    target_current = (
        state.status == "applied"
        and state.applied_revision is not None
        and state.applied_revision >= profile.agent_auth_revision
        and not state.force_restart_required
    )
    if state.status == "failed":
        status = "apply_failed"
    elif state.force_restart_required:
        status = "restart_required"
    elif target_current:
        status = "current"
    else:
        status = "stale"

    return _snapshot(
        status=status,
        config_current=config_current,
        target_current=target_current,
        requires_restart=state.force_restart_required,
        desired_revision=profile.agent_auth_revision,
        applied_revision=state.applied_revision,
        last_error=state.last_error_message,
        last_error_at=state.last_agent_auth_attempted_at,
        last_attempted_at=state.last_agent_auth_attempted_at,
        last_applied_at=state.last_agent_auth_applied_at,
    )


async def load_workspace_runtime_auth_snapshot(
    *,
    workspace: CloudWorkspace,
    runtime_environment: CloudRuntimeEnvironment | None,
) -> RuntimeAuthStateSnapshot | None:
    async with db_engine.async_session_factory() as db:
        return await build_workspace_runtime_auth_snapshot(
            db,
            workspace=workspace,
            runtime_environment=runtime_environment,
        )


async def selected_agent_auth_agent_kinds(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
) -> tuple[str, ...]:
    selections = await agent_auth_store.list_selections_for_profile(db, sandbox_profile_id)
    return tuple(
        sorted({selection.agent_kind for selection in selections if selection.status == "active"})
    )
