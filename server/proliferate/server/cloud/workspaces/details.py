"""Workspace summary and detail response assembly."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus, CloudWorkspaceStatus
from proliferate.db import session_ops as db_session
from proliferate.db.store.automation_runs import (
    AutomationRunValue,
    list_latest_runs_by_cloud_workspace_ids_for_user,
)
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_runtime_environments import (
    get_runtime_environment_for_workspace,
    load_runtime_environment_for_workspace,
)
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.billing.service import (
    get_billing_snapshot_for_subject,
    get_billing_snapshot_for_subject_in_session,
)
from proliferate.server.cloud.claims.access import load_workspace_exposure_and_claim
from proliferate.server.cloud.runtime.credentials.auth_status import (
    build_workspace_runtime_auth_snapshot,
    load_workspace_runtime_auth_snapshot,
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceCreatorContext,
    WorkspaceDetail,
    WorkspaceDirectTargetContext,
    WorkspaceSummary,
)
from proliferate.server.cloud.workspaces.payloads import (
    workspace_detail_payload,
    workspace_summary_payload,
)


class WorkspaceRow(Protocol):
    id: UUID
    target_id: UUID | None
    anyharness_workspace_id: str | None
    user_id: UUID
    sandbox_profile_id: UUID | None
    status: str
    billing_subject_id: UUID


def _creator_context_for_automation_run(
    run: AutomationRunValue | None,
) -> WorkspaceCreatorContext | None:
    if run is None:
        return None
    return WorkspaceCreatorContext(
        kind="automation",
        automation_id=str(run.automation_id),
        automation_run_id=str(run.id),
        label=run.title_snapshot,
    )


def _direct_target_context_for_automation_run(
    run: AutomationRunValue | None,
) -> WorkspaceDirectTargetContext | None:
    if (
        run is None
        or run.cloud_target_id_snapshot is None
        or run.cloud_target_kind_snapshot is None
        or run.cloud_target_kind_snapshot == "managed_cloud"
        or not run.anyharness_workspace_id
    ):
        return None
    return WorkspaceDirectTargetContext(
        target_id=str(run.cloud_target_id_snapshot),
        target_kind=run.cloud_target_kind_snapshot,
        anyharness_workspace_id=run.anyharness_workspace_id,
    )


def _direct_target_context_for_workspace(
    workspace: WorkspaceRow,
    target_kind: str | None,
) -> WorkspaceDirectTargetContext | None:
    if (
        workspace.target_id is None
        or target_kind is None
        or target_kind == CloudTargetKind.managed_cloud.value
        or not workspace.anyharness_workspace_id
    ):
        return None
    return WorkspaceDirectTargetContext(
        target_id=str(workspace.target_id),
        target_kind=target_kind,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )


def cloud_workspace_block_message(blocked_reason: str | None) -> str:
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return (
            "Sandbox limit reached. Archive or delete another cloud workspace before "
            "starting a new one."
        )
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "Cloud usage is paused because your included sandbox hours are exhausted."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED:
        return "Cloud usage is paused because billing needs attention."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD:
        return "Cloud usage is paused for this account."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD:
        return "Cloud usage is paused because billing needs attention."
    return "Cloud usage is currently unavailable."


async def _agent_auth_agent_kinds_for_workspace_request(
    db: AsyncSession,
    workspace: WorkspaceRow,
) -> tuple[str, ...]:
    sandbox_profile_id = workspace.sandbox_profile_id
    if sandbox_profile_id is None:
        profile = await agent_auth_store.get_active_personal_sandbox_profile_for_user(
            db,
            workspace.user_id,
        )
        if profile is None:
            return ()
        sandbox_profile_id = profile.id
    return await selected_agent_auth_agent_kinds(
        db,
        sandbox_profile_id=sandbox_profile_id,
    )


async def _load_agent_auth_agent_kinds_for_workspace(
    workspace: WorkspaceRow,
) -> tuple[str, ...]:
    async with db_session.open_async_session() as db:
        return await _agent_auth_agent_kinds_for_workspace_request(db, workspace)


def _workspace_action_block(
    workspace: WorkspaceRow,
    billing: BillingSnapshot,
) -> tuple[str | None, str | None]:
    if billing.billing_mode != BILLING_MODE_ENFORCE or not billing.start_blocked:
        return None, None
    if workspace.status == CloudWorkspaceStatus.ready.value:
        return None, None
    return (
        billing.start_block_reason,
        cloud_workspace_block_message(billing.start_block_reason),
    )


async def workspace_summaries_for_request(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspaces: list,
) -> list[WorkspaceSummary]:
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        db,
        user_id=user_id,
        cloud_workspace_ids=[workspace.id for workspace in workspaces],
    )
    snapshots_by_subject: dict[UUID, BillingSnapshot] = {}
    summaries: list[WorkspaceSummary] = []
    for workspace in workspaces:
        exposure, claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        runtime_environment = await get_runtime_environment_for_workspace(db, workspace)
        runtime_auth = await build_workspace_runtime_auth_snapshot(
            db,
            workspace=workspace,
            runtime_environment=runtime_environment,
        )
        latest_sessions = await projections_store.list_session_projections_for_workspace(
            db,
            cloud_workspace_id=workspace.id,
            target_id=workspace.target_id,
            limit=1,
        )
        target = (
            await targets_store.get_target_by_id(db, workspace.target_id)
            if workspace.target_id is not None
            else None
        )
        billing_subject_id = (
            runtime_environment.billing_subject_id
            if runtime_environment is not None
            else workspace.billing_subject_id
        )
        billing = snapshots_by_subject.get(billing_subject_id)
        if billing is None:
            billing = await get_billing_snapshot_for_subject_in_session(db, billing_subject_id)
            snapshots_by_subject[billing_subject_id] = billing
        action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
        direct_target_context = _direct_target_context_for_workspace(
            workspace,
            target.kind if target is not None else None,
        ) or _direct_target_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        )
        summaries.append(
            workspace_summary_payload(
                workspace,
                runtime_environment=runtime_environment,
                runtime_auth=runtime_auth,
                billing=billing,
                action_block_kind=action_block_kind,
                action_block_reason=action_block_reason,
                creator_context=_creator_context_for_automation_run(
                    automation_runs_by_workspace.get(workspace.id)
                ),
                direct_target_context=direct_target_context,
                exposure=exposure,
                claim=claim,
                last_session_summary=latest_sessions[0] if latest_sessions else None,
                target_kind=target.kind if target is not None else None,
                target_label=target.display_name if target is not None else None,
                target_online=(
                    target.status == CloudTargetStatus.online.value if target is not None else None
                ),
            )
        )
    return summaries


async def build_workspace_detail_for_request(
    db: AsyncSession,
    workspace: WorkspaceRow,
) -> WorkspaceDetail:
    exposure, claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    runtime_environment = await get_runtime_environment_for_workspace(db, workspace)
    runtime_auth = await build_workspace_runtime_auth_snapshot(
        db,
        workspace=workspace,
        runtime_environment=runtime_environment,
    )
    ready_agent_kind_values = await _agent_auth_agent_kinds_for_workspace_request(db, workspace)
    latest_sessions = await projections_store.list_session_projections_for_workspace(
        db,
        cloud_workspace_id=workspace.id,
        target_id=workspace.target_id,
        limit=1,
    )
    target = (
        await targets_store.get_target_by_id(db, workspace.target_id)
        if workspace.target_id is not None
        else None
    )
    billing = await get_billing_snapshot_for_subject_in_session(
        db,
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id,
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        db,
        user_id=workspace.user_id,
        cloud_workspace_ids=[workspace.id],
    )
    direct_target_context = _direct_target_context_for_workspace(
        workspace,
        target.kind if target is not None else None,
    ) or _direct_target_context_for_automation_run(automation_runs_by_workspace.get(workspace.id))
    return workspace_detail_payload(
        workspace,
        ready_agent_kind_values,
        runtime_environment=runtime_environment,
        runtime_auth=runtime_auth,
        billing=billing,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        creator_context=_creator_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        direct_target_context=direct_target_context,
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
        target_label=target.display_name if target is not None else None,
        target_online=(
            target.status == CloudTargetStatus.online.value if target is not None else None
        ),
    )


async def build_workspace_detail(
    workspace: WorkspaceRow,
) -> WorkspaceDetail:
    async with db_session.open_async_session() as db:
        exposure, claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        runtime_environment = await load_runtime_environment_for_workspace(db, workspace)
    runtime_auth = await load_workspace_runtime_auth_snapshot(
        workspace=workspace,
        runtime_environment=runtime_environment,
    )
    ready_agent_kind_values = await _load_agent_auth_agent_kinds_for_workspace(workspace)
    async with db_session.open_async_session() as db:
        latest_sessions = await projections_store.list_session_projections_for_workspace(
            db,
            cloud_workspace_id=workspace.id,
            target_id=workspace.target_id,
            limit=1,
        )
        target = (
            await targets_store.get_target_by_id(db, workspace.target_id)
            if workspace.target_id is not None
            else None
        )
        automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
            db,
            user_id=workspace.user_id,
            cloud_workspace_ids=[workspace.id],
        )
    billing = await get_billing_snapshot_for_subject(
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    direct_target_context = _direct_target_context_for_workspace(
        workspace,
        target.kind if target is not None else None,
    ) or _direct_target_context_for_automation_run(automation_runs_by_workspace.get(workspace.id))
    return workspace_detail_payload(
        workspace,
        ready_agent_kind_values,
        runtime_environment=runtime_environment,
        runtime_auth=runtime_auth,
        billing=billing,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        creator_context=_creator_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        direct_target_context=direct_target_context,
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
        target_label=target.display_name if target is not None else None,
        target_online=(
            target.status == CloudTargetStatus.online.value if target is not None else None
        ),
    )
