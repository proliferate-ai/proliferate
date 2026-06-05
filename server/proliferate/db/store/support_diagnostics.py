"""Allowlisted DB snapshots for support cloud diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.cloud.cloud_target_runtime_access import CloudTargetRuntimeAccess
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace, CloudWorkspaceSetupRun
from proliferate.db.models.organizations import OrganizationMembership


@dataclass(frozen=True)
class AuthorizedCloudWorkspaceSnapshot:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    target_id: UUID | None
    sandbox_profile_id: UUID | None
    anyharness_workspace_id: str | None
    status: str
    status_detail: str | None
    last_error: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    origin: str
    template_version: str
    materialized_target_id: UUID | None
    required_runtime_config_sequence: int | None
    required_runtime_config_revision_id: str | None
    required_agent_auth_revision: int | None
    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None
    archived_at: datetime | None


@dataclass(frozen=True)
class CloudExposureDiagnosticsSnapshot:
    id: UUID
    target_id: UUID
    cloud_workspace_id: UUID
    anyharness_workspace_id: str | None
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    visibility: str
    claimed_by_user_id: UUID | None
    default_projection_level: str
    commandable: bool
    status: str
    revision: int
    last_projected_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudTargetDiagnosticsSnapshot:
    id: UUID
    display_name: str
    kind: str
    status: str
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    sandbox_profile_id: UUID | None
    profile_target_role: str
    update_status: str | None
    update_status_detail: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudTargetRuntimeAccessDiagnosticsSnapshot:
    target_id: UUID
    sandbox_profile_id: UUID
    cloud_sandbox_id: UUID | None
    anyharness_base_url: str | None
    last_worker_id: UUID | None
    last_heartbeat_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True)
class CloudSandboxDiagnosticsSnapshot:
    id: UUID
    sandbox_profile_id: UUID | None
    target_id: UUID | None
    provider: str
    external_sandbox_id: str | None
    status: str
    template_version: str
    last_provider_event_at: datetime | None
    last_provider_event_kind: str | None
    last_heartbeat_at: datetime | None
    blocked_reason: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudCommandDiagnosticsSnapshot:
    id: UUID
    target_id: UUID
    organization_id: UUID | None
    actor_user_id: UUID | None
    actor_kind: str
    source: str
    workspace_id: str | None
    cloud_workspace_id: UUID | None
    session_id: str | None
    kind: str
    payload_shape: str
    result_shape: str | None
    status: str
    lease_id: str | None
    leased_by_worker_id: UUID | None
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudSetupRunDiagnosticsSnapshot:
    id: UUID
    workspace_id: UUID
    anyharness_workspace_id: str
    terminal_id: str | None
    command_run_id: str
    setup_script_version: int
    status: str
    deadline_at: datetime
    claim_until: datetime | None
    last_polled_at: datetime | None
    next_poll_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


async def list_authorized_cloud_workspaces(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_ids: tuple[UUID, ...],
    limit: int,
) -> tuple[AuthorizedCloudWorkspaceSnapshot, ...]:
    if not workspace_ids:
        return ()
    statement = (
        select(CloudWorkspace)
        .outerjoin(
            OrganizationMembership,
            OrganizationMembership.organization_id == CloudWorkspace.organization_id,
        )
        .where(CloudWorkspace.id.in_(workspace_ids))
        .where(
            or_(
                and_(
                    CloudWorkspace.owner_scope == "personal",
                    CloudWorkspace.owner_user_id == user_id,
                ),
                and_(
                    CloudWorkspace.owner_scope == "organization",
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                ),
            )
        )
        .order_by(desc(CloudWorkspace.updated_at))
        .limit(limit)
    )
    rows = (await db.execute(statement)).scalars().all()
    return tuple(_workspace_snapshot(row) for row in rows)


async def list_exposures_for_workspaces(
    db: AsyncSession,
    workspace_ids: tuple[UUID, ...],
) -> tuple[CloudExposureDiagnosticsSnapshot, ...]:
    if not workspace_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudWorkspaceExposure)
                .where(CloudWorkspaceExposure.cloud_workspace_id.in_(workspace_ids))
                .order_by(desc(CloudWorkspaceExposure.updated_at))
            )
        )
        .scalars()
        .all()
    )
    return tuple(_exposure_snapshot(row) for row in rows)


async def list_targets_for_ids(
    db: AsyncSession,
    target_ids: tuple[UUID, ...],
    *,
    limit: int,
) -> tuple[CloudTargetDiagnosticsSnapshot, ...]:
    if not target_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudTarget)
                .where(CloudTarget.id.in_(target_ids))
                .order_by(desc(CloudTarget.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_target_snapshot(row) for row in rows)


async def list_runtime_access_for_targets(
    db: AsyncSession,
    target_ids: tuple[UUID, ...],
) -> tuple[CloudTargetRuntimeAccessDiagnosticsSnapshot, ...]:
    if not target_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudTargetRuntimeAccess).where(
                    CloudTargetRuntimeAccess.target_id.in_(target_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_runtime_access_snapshot(row) for row in rows)


async def list_sandboxes_for_ids(
    db: AsyncSession,
    sandbox_ids: tuple[UUID, ...],
) -> tuple[CloudSandboxDiagnosticsSnapshot, ...]:
    if not sandbox_ids:
        return ()
    rows = (
        await db.execute(select(CloudSandbox).where(CloudSandbox.id.in_(sandbox_ids)))
    ).scalars()
    return tuple(_sandbox_snapshot(row) for row in rows)


async def list_recent_commands_for_workspaces(
    db: AsyncSession,
    workspace_ids: tuple[UUID, ...],
    *,
    limit: int,
) -> tuple[CloudCommandDiagnosticsSnapshot, ...]:
    if not workspace_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudCommand)
                .where(CloudCommand.cloud_workspace_id.in_(workspace_ids))
                .order_by(desc(CloudCommand.created_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_command_snapshot(row) for row in rows)


async def list_recent_setup_runs_for_workspaces(
    db: AsyncSession,
    workspace_ids: tuple[UUID, ...],
    *,
    limit: int,
) -> tuple[CloudSetupRunDiagnosticsSnapshot, ...]:
    if not workspace_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudWorkspaceSetupRun)
                .where(CloudWorkspaceSetupRun.workspace_id.in_(workspace_ids))
                .order_by(desc(CloudWorkspaceSetupRun.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_setup_run_snapshot(row) for row in rows)


def _workspace_snapshot(row: CloudWorkspace) -> AuthorizedCloudWorkspaceSnapshot:
    return AuthorizedCloudWorkspaceSnapshot(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        status=row.status,
        status_detail=row.status_detail,
        last_error=row.last_error,
        git_provider=row.git_provider,
        git_owner=row.git_owner,
        git_repo_name=row.git_repo_name,
        git_branch=row.git_branch,
        git_base_branch=row.git_base_branch,
        origin=row.origin,
        template_version=row.template_version,
        materialized_target_id=row.materialized_target_id,
        required_runtime_config_sequence=row.required_runtime_config_sequence,
        required_runtime_config_revision_id=row.required_runtime_config_revision_id,
        required_agent_auth_revision=row.required_agent_auth_revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        ready_at=row.ready_at,
        archived_at=row.archived_at,
    )


def _exposure_snapshot(row: CloudWorkspaceExposure) -> CloudExposureDiagnosticsSnapshot:
    return CloudExposureDiagnosticsSnapshot(
        id=row.id,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        visibility=row.visibility,
        claimed_by_user_id=row.claimed_by_user_id,
        default_projection_level=row.default_projection_level,
        commandable=row.commandable,
        status=row.status,
        revision=row.revision,
        last_projected_at=row.last_projected_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _target_snapshot(row: CloudTarget) -> CloudTargetDiagnosticsSnapshot:
    return CloudTargetDiagnosticsSnapshot(
        id=row.id,
        display_name=row.display_name,
        kind=row.kind,
        status=row.status,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        sandbox_profile_id=row.sandbox_profile_id,
        profile_target_role=row.profile_target_role,
        update_status=row.update_status,
        update_status_detail=row.update_status_detail,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _runtime_access_snapshot(
    row: CloudTargetRuntimeAccess,
) -> CloudTargetRuntimeAccessDiagnosticsSnapshot:
    return CloudTargetRuntimeAccessDiagnosticsSnapshot(
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        anyharness_base_url=row.anyharness_base_url,
        last_worker_id=row.last_worker_id,
        last_heartbeat_at=row.last_heartbeat_at,
        updated_at=row.updated_at,
    )


def _sandbox_snapshot(row: CloudSandbox) -> CloudSandboxDiagnosticsSnapshot:
    return CloudSandboxDiagnosticsSnapshot(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        provider=row.provider,
        external_sandbox_id=row.external_sandbox_id,
        status=row.status,
        template_version=row.template_version,
        last_provider_event_at=row.last_provider_event_at,
        last_provider_event_kind=row.last_provider_event_kind,
        last_heartbeat_at=row.last_heartbeat_at,
        blocked_reason=row.blocked_reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _command_snapshot(row: CloudCommand) -> CloudCommandDiagnosticsSnapshot:
    return CloudCommandDiagnosticsSnapshot(
        id=row.id,
        target_id=row.target_id,
        organization_id=row.organization_id,
        actor_user_id=row.actor_user_id,
        actor_kind=row.actor_kind,
        source=row.source,
        workspace_id=row.workspace_id,
        cloud_workspace_id=row.cloud_workspace_id,
        session_id=row.session_id,
        kind=row.kind,
        payload_shape=_json_shape(row.payload_json),
        result_shape=_json_shape(row.result_json) if row.result_json else None,
        status=row.status,
        lease_id=row.lease_id,
        leased_by_worker_id=row.leased_by_worker_id,
        attempt_count=row.attempt_count,
        error_code=row.error_code,
        error_message=row.error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _setup_run_snapshot(row: CloudWorkspaceSetupRun) -> CloudSetupRunDiagnosticsSnapshot:
    return CloudSetupRunDiagnosticsSnapshot(
        id=row.id,
        workspace_id=row.workspace_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        terminal_id=row.terminal_id,
        command_run_id=row.command_run_id,
        setup_script_version=row.setup_script_version,
        status=row.status,
        deadline_at=row.deadline_at,
        claim_until=row.claim_until,
        last_polled_at=row.last_polled_at,
        next_poll_at=row.next_poll_at,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _json_shape(raw: str | None) -> str:
    if not raw:
        return "empty"
    stripped = raw.strip()
    if not stripped:
        return "empty"
    if stripped.startswith("{"):
        return "object"
    if stripped.startswith("["):
        return "array"
    return "scalar"
