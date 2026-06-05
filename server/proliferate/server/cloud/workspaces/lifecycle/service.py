from __future__ import annotations

import logging
import time
from types import SimpleNamespace
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_DESTROY,
    USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
)
from proliferate.constants.cloud import (
    CloudCommandKind,
    CloudCommandSource,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_sandboxes import (
    load_cloud_sandbox_by_id,
    update_sandbox_status,
)
from proliferate.db.store.cloud_sync import commands as command_store
from proliferate.db.store.cloud_workspace_lifecycle import (
    archive_cloud_workspace_record,
    archive_cloud_workspace_record_by_id,
    delete_cloud_workspace_records_for_workspace,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    purge_cloud_workspace_record,
    restore_cloud_workspace_record,
)
from proliferate.db.store.cloud_workspaces import get_cloud_workspace_by_id
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.billing.service import record_cloud_sandbox_usage_stopped
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.worker.revoked_jti import mark_revoked_jtis_changed
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_archive_with_db,
    cloud_workspace_user_can_read,
)
from proliferate.server.cloud.workspaces.details import (
    build_workspace_detail,
    build_workspace_detail_for_request,
)
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    decide_workspace_status_transition,
    provider_failure_debug_state,
)
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.utils.time import duration_ms, utcnow


class LifecycleWorkspaceRecord(Protocol):
    id: UUID
    active_sandbox_id: UUID | None
    target_id: UUID | None
    anyharness_workspace_id: str | None
    owner_scope: str
    archived_at: object | None
    status: str
    status_detail: str | None
    updated_at: object
    cleanup_state: str
    cleanup_last_error: str | None
    runtime_url: str | None
    runtime_token_ciphertext: str | None


class LifecycleSandboxRecord(Protocol):
    id: UUID
    provider: str
    external_sandbox_id: str | None
    sandbox_profile_id: UUID | None
    target_id: UUID | None


def _transition_workspace_status(
    workspace: LifecycleWorkspaceRecord,
    target: CloudWorkspaceStatus,
    *,
    status_detail: str | None = None,
) -> None:
    decision = decide_workspace_status_transition(
        workspace.status,
        target,
        status_detail=status_detail,
    )
    if not decision.allowed:
        raise CloudApiError(
            decision.error_code or "invalid_status_transition",
            decision.error_message or "Workspace status transition is not allowed.",
            status_code=decision.status_code or 409,
        )
    workspace.status = target.value
    workspace.status_detail = decision.status_detail
    workspace.updated_at = utcnow()


async def stop_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    await _stop_workspace_runtime(workspace)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_archived")
    workspace = await cloud_workspace_user_can_read(user_id, workspace_id)
    return await build_workspace_detail(workspace)


async def archive_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    prune_error = None
    if workspace.archived_at is None:
        await command_store.supersede_workspace_commands(
            db,
            cloud_workspace_id=workspace.id,
            reason_code="cloud_workspace_archived",
            reason_message=(
                "Workspace command was superseded because the Cloud workspace was archived."
            ),
        )
        await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_archived")
        prune_error = await _enqueue_archive_prune_command(
            db, user_id=user_id, workspace=workspace
        )
    await archive_cloud_workspace_record(db, workspace=workspace)
    if prune_error is not None:
        workspace.cleanup_state = CloudWorkspaceCleanupState.failed.value
        workspace.cleanup_last_error = prune_error
    detail = await build_workspace_detail_for_request(db, workspace)
    await db_session.commit_session(db)
    return detail


async def _enqueue_archive_prune_command(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace: LifecycleWorkspaceRecord,
) -> str | None:
    if workspace.target_id is None or not workspace.anyharness_workspace_id:
        return None
    try:
        await enqueue_command(
            db,
            user=SimpleNamespace(id=user_id),
            body=CreateCloudCommandRequest.model_validate(
                {
                    "idempotencyKey": (
                        f"archive-prune:{workspace.id}:{workspace.anyharness_workspace_id}"
                    ),
                    "targetId": workspace.target_id,
                    "workspaceId": workspace.anyharness_workspace_id,
                    "cloudWorkspaceId": workspace.id,
                    "kind": CloudCommandKind.prune_workspace_worktree.value,
                    "payload": {
                        "workspaceId": workspace.anyharness_workspace_id,
                        "cloudWorkspaceId": str(workspace.id),
                        "reason": "archive",
                    },
                    "source": CloudCommandSource.api.value,
                }
            ),
        )
    except CloudApiError as exc:
        log_cloud_event(
            "cloud workspace archive prune enqueue failed",
            workspace_id=workspace.id,
            target_id=workspace.target_id,
            anyharness_workspace_id=workspace.anyharness_workspace_id,
            error_code=exc.code,
        )
        return exc.message
    return None


async def restore_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    if workspace.archived_at is None:
        return await build_workspace_detail_for_request(db, workspace)
    try:
        await restore_cloud_workspace_record(db, workspace=workspace)
        detail = await build_workspace_detail_for_request(db, workspace)
        await db_session.commit_session(db)
    except Exception as exc:
        if not db_session.is_integrity_error(exc):
            raise
        await db_session.rollback_session(db)
        raise CloudApiError(
            "workspace_restore_conflict",
            "Another active workspace already exists for this repo and branch.",
            status_code=409,
        ) from exc
    return detail


async def purge_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    if await get_cloud_workspace_by_id(db, workspace_id) is None:
        return
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    if workspace.owner_scope != "personal":
        raise CloudApiError(
            "workspace_purge_unsupported",
            "Only personal cloud workspaces can be purged from this surface.",
            status_code=409,
        )
    if workspace.archived_at is None:
        raise CloudApiError(
            "workspace_purge_requires_archive",
            "Archive this Cloud workspace before purging it.",
            status_code=409,
        )
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_purged")
    await command_store.supersede_workspace_commands(
        db,
        cloud_workspace_id=workspace.id,
        reason_code="cloud_workspace_purged",
        reason_message="Workspace command was superseded because the Cloud workspace was purged.",
        command_kinds=None,
    )
    await purge_cloud_workspace_record(db, workspace=workspace)
    await db_session.commit_session(db)


async def delete_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_deleted")
    workspace_record_id = workspace.id
    db.expunge(workspace)
    await _destroy_workspace_runtime(workspace)
    async with db_session.open_async_transaction() as delete_db:
        if refreshed := await get_cloud_workspace_by_id(delete_db, workspace_record_id):
            await delete_cloud_workspace_records_for_workspace(delete_db, refreshed)


async def archive_failed_cloud_workspace_for_mobility_retry(workspace_id: UUID) -> None:
    async with db_session.open_async_transaction() as db:
        await archive_cloud_workspace_record_by_id(db, workspace_id=workspace_id)


async def _revoke_claim_tokens_for_workspace(
    workspace: LifecycleWorkspaceRecord,
    *,
    reason: str,
) -> None:
    async with db_session.open_async_transaction() as db:
        claim = await claims_store.get_claim_for_workspace(db, workspace.id)
        if claim is None:
            return
        if await claim_tokens_store.revoke_active_tokens_for_claim(
            db, claim_id=claim.id, reason=reason
        ):
            await mark_revoked_jtis_changed(db, target_id=claim.target_id)


# These helpers own the interaction with the persisted sandbox provider
# (pause / destroy) and delegate the persistence update to store.py primitives.


async def _stop_workspace_runtime(workspace: LifecycleWorkspaceRecord) -> None:
    """Pause the active sandbox and mark the workspace as stopped."""
    stop_started = time.perf_counter()
    log_cloud_event(
        "cloud workspace stop requested",
        workspace_id=workspace.id,
        sandbox_id=workspace.active_sandbox_id,
        status=workspace.status,
    )
    sandbox = await _load_workspace_owned_runtime_sandbox(workspace)
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.pause_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("stop")
                await _update_sandbox_status_tx(sandbox, failure_state.sandbox_status)
                log_cloud_event(
                    "cloud sandbox pause failed",
                    level=logging.WARNING,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
            else:
                await record_cloud_sandbox_usage_stopped(
                    sandbox_id=sandbox.id,
                    ended_at=utcnow(),
                    closed_by=USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
                )
                await _update_sandbox_status_tx(sandbox, "paused", stopped_at_now=True)
                log_cloud_event(
                    "cloud sandbox paused",
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
        else:
            await _update_sandbox_status_tx(sandbox, "paused", stopped_at_now=True)

    if workspace.status != CloudWorkspaceStatus.archived.value:
        _transition_workspace_status(
            workspace,
            CloudWorkspaceStatus.archived,
            status_detail="Archived",
        )
    else:
        workspace.updated_at = utcnow()
    async with db_session.open_async_transaction() as db:
        await persist_workspace_stop_state(db, workspace)
    log_cloud_event(
        "cloud workspace stopped",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(stop_started),
    )


async def _destroy_workspace_runtime(workspace: LifecycleWorkspaceRecord) -> None:
    """Destroy the active sandbox and mark the workspace as stopped."""
    destroy_started = time.perf_counter()
    sandbox = await _load_workspace_owned_runtime_sandbox(workspace)
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.destroy_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("destroy")
                await _update_sandbox_status_tx(sandbox, failure_state.sandbox_status)
                log_cloud_event(
                    "cloud sandbox destroy failed",
                    level=logging.WARNING,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
            else:
                await record_cloud_sandbox_usage_stopped(
                    sandbox_id=sandbox.id,
                    ended_at=utcnow(),
                    closed_by=USAGE_SEGMENT_CLOSED_BY_DESTROY,
                )
                await _update_sandbox_status_tx(sandbox, "destroyed", stopped_at_now=True)
                log_cloud_event(
                    "cloud sandbox destroyed",
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
        else:
            await _update_sandbox_status_tx(sandbox, "destroyed", stopped_at_now=True)
    _transition_workspace_status(
        workspace,
        CloudWorkspaceStatus.archived,
        status_detail="Archived",
    )
    async with db_session.open_async_transaction() as db:
        await persist_workspace_destroy_state(db, workspace)
    log_cloud_event(
        "cloud workspace destroyed",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(destroy_started),
    )


async def _load_workspace_owned_runtime_sandbox(
    workspace: LifecycleWorkspaceRecord,
) -> LifecycleSandboxRecord | None:
    """Load only the legacy workspace-owned runtime sandbox.

    Managed cloud target sandboxes are shared by all workspaces on a sandbox
    profile and target. Workspace stop/delete must not pause or destroy them.
    """
    sandbox_id = getattr(workspace, "active_sandbox_id", None)
    if sandbox_id is None:
        return None
    async with db_session.open_async_session() as db:
        sandbox = await load_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None:
        return None
    if sandbox.sandbox_profile_id is not None or sandbox.target_id is not None:
        log_cloud_event(
            "cloud workspace runtime action skipped non-workspace sandbox",
            workspace_id=workspace.id,
            sandbox_id=sandbox.id,
            sandbox_profile_id=sandbox.sandbox_profile_id,
            target_id=sandbox.target_id,
        )
        return None
    return sandbox


async def _update_sandbox_status_tx(
    sandbox: LifecycleSandboxRecord,
    status: str,
    **kwargs: object,
) -> None:
    async with db_session.open_async_transaction() as db:
        await update_sandbox_status(db, sandbox, status, **kwargs)
