from __future__ import annotations

import logging
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import (
    CloudCommandKind,
    CloudCommandSource,
    CloudTargetKind,
    CloudTargetStatus,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store import billing_subjects as billing_subject_store
from proliferate.db.store.automation_runs import list_latest_runs_by_cloud_workspace_ids_for_user
from proliferate.db.store.cloud_sync import backfill as backfill_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspace_runtime import mark_workspace_error_by_id
from proliferate.db.store.cloud_workspaces import (
    get_cloud_workspace_by_id,
)
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.claims.access import load_workspace_exposure_and_claim
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
from proliferate.server.cloud.runtime.service import get_workspace_connection
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_archive_with_db,
    cloud_workspace_user_can_interact_with_db,
)
from proliferate.server.cloud.workspaces.details import build_workspace_detail_for_request
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.payloads import runtime_auth_payload
from proliferate.server.cloud.workspaces.remote_access.models import (
    BootstrapWorkspaceRemoteAccessRequest,
    WorkspaceConnection,
)

CLOUD_DESKTOP_REMOTE_ACCESS_ORIGIN_JSON = '{"kind":"human","entrypoint":"desktop"}'
CLOUD_REMOTE_ACCESS_TEMPLATE_VERSION = "desktop-remote-access-v1"


class RemoteAccessWorkspaceRecord(Protocol):
    id: UUID
    target_id: UUID | None
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    anyharness_workspace_id: str | None
    origin: str


def _exposure_owner_fields(
    workspace: RemoteAccessWorkspaceRecord,
) -> tuple[UUID | None, UUID | None, str]:
    if workspace.owner_scope == "personal":
        if workspace.owner_user_id is None:
            raise CloudApiError(
                "workspace_owner_invalid",
                "Personal workspace is missing its owner.",
                status_code=409,
            )
        return workspace.owner_user_id, None, "private"
    if workspace.owner_scope == "organization":
        if workspace.organization_id is None:
            raise CloudApiError(
                "workspace_owner_invalid",
                "Organization workspace is missing its organization.",
                status_code=409,
            )
        return None, workspace.organization_id, "shared_unclaimed"
    raise CloudApiError(
        "workspace_owner_invalid",
        "Workspace owner scope is not supported for remote access.",
        status_code=409,
    )


def _remote_access_repo_fields(
    body: BootstrapWorkspaceRemoteAccessRequest,
) -> tuple[str, str, str, str, str]:
    repo = body.repo
    fallback_name = (
        (body.display_name or "").strip() or body.anyharness_workspace_id.strip() or "workspace"
    )
    if repo is None:
        return "local", "local", fallback_name, "default", "default"

    provider = repo.provider.strip() or "local"
    owner = repo.owner.strip() or "local"
    name = repo.name.strip() or fallback_name
    branch = repo.branch.strip() or "default"
    base_branch = (repo.base_branch or "").strip() or branch
    return provider, owner, name, branch, base_branch


async def bootstrap_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    body: BootstrapWorkspaceRemoteAccessRequest,
) -> WorkspaceDetail:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=body.target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "remote_access_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.owner_scope != "personal" or target.owner_user_id != user.id:
        raise CloudApiError(
            "remote_access_target_not_personal",
            "Enabling remote access for an existing workspace requires a personal target.",
            status_code=409,
        )
    if target.kind not in {
        CloudTargetKind.desktop_dispatch.value,
        CloudTargetKind.ssh.value,
        CloudTargetKind.self_hosted_cloud.value,
    }:
        raise CloudApiError(
            "remote_access_target_kind_unsupported",
            "This target cannot backfill an existing workspace for remote access.",
            status_code=409,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "remote_access_target_offline",
            "Remote access requires the target worker to be online.",
            status_code=409,
        )

    billing_subject = await billing_subject_store.ensure_personal_billing_subject(db, user.id)
    git_provider, git_owner, git_repo_name, git_branch, git_base_branch = (
        _remote_access_repo_fields(body)
    )
    mapped = await backfill_store.upsert_synced_workspace(
        db,
        target_id=target.id,
        anyharness_workspace_id=body.anyharness_workspace_id,
        billing_subject_id=billing_subject.id,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        display_name=body.display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        origin_json=CLOUD_DESKTOP_REMOTE_ACCESS_ORIGIN_JSON,
        template_version=CLOUD_REMOTE_ACCESS_TEMPLATE_VERSION,
    )
    workspace = await get_cloud_workspace_by_id(db, mapped.id)
    if workspace is None:
        raise CloudApiError(
            "remote_access_workspace_missing",
            "Remote access workspace could not be created.",
            status_code=500,
        )

    exposure = await exposures_store.upsert_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=body.anyharness_workspace_id,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin="manual_desktop",
    )
    await publish_worker_control_after_commit(db, target_id=target.id, reason="exposures")
    await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": (
                    "remote-access-bootstrap:"
                    f"{target.id}:{workspace.id}:{exposure.id}:{exposure.revision}"
                ),
                "targetId": target.id,
                "workspaceId": body.anyharness_workspace_id,
                "cloudWorkspaceId": workspace.id,
                "kind": CloudCommandKind.backfill_exposed_workspace.value,
                "payload": {"workspaceId": body.anyharness_workspace_id},
                "source": CloudCommandSource.api.value,
            }
        ),
    )
    return await build_workspace_detail_for_request(db, workspace)


async def enable_cloud_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_interact_with_db(db, user.id, workspace_id)
    if workspace.target_id is None or not workspace.anyharness_workspace_id:
        raise CloudApiError(
            "remote_access_workspace_not_materialized",
            "Remote access requires a materialized target workspace.",
            status_code=409,
        )
    target = await targets_store.get_target_by_id(db, workspace.target_id)
    if target is None:
        raise CloudApiError(
            "remote_access_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "remote_access_target_offline",
            "Remote access requires the target worker to be online.",
            status_code=409,
        )

    owner_user_id, organization_id, visibility = _exposure_owner_fields(workspace)
    exposure = await exposures_store.upsert_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        visibility=visibility,
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin=workspace.origin,
    )
    await publish_worker_control_after_commit(
        db,
        target_id=workspace.target_id,
        reason="exposures",
    )
    await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": (
                    f"remote-access-backfill:{workspace.id}:{exposure.id}:{exposure.revision}"
                ),
                "targetId": workspace.target_id,
                "workspaceId": workspace.anyharness_workspace_id,
                "cloudWorkspaceId": workspace.id,
                "kind": CloudCommandKind.backfill_exposed_workspace.value,
                "payload": {"workspaceId": workspace.anyharness_workspace_id},
                "source": CloudCommandSource.api.value,
            }
        ),
    )
    return await build_workspace_detail_for_request(db, workspace)


async def disable_cloud_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user.id, workspace_id)
    if workspace.target_id is None:
        return await build_workspace_detail_for_request(db, workspace)
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    if exposure is not None:
        await exposures_store.archive_workspace_exposure(db, exposure_id=exposure.id)
        await publish_worker_control_after_commit(
            db,
            target_id=workspace.target_id,
            reason="exposures",
        )
    return await build_workspace_detail_for_request(db, workspace)


async def get_cloud_connection(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceConnection:
    workspace = await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    await _reject_shared_workspace_static_connection(workspace)
    async with db_session.open_async_session() as lookup_db:
        automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
            lookup_db,
            user_id=user_id,
            cloud_workspace_ids=[workspace.id],
        )
    latest_run = automation_runs_by_workspace.get(workspace.id)
    if (
        latest_run is not None
        and latest_run.cloud_target_kind_snapshot is not None
        and latest_run.cloud_target_kind_snapshot != "managed_cloud"
    ):
        raise CloudApiError(
            "direct_target_connection_required",
            "This workspace runs on an SSH target and must be opened through "
            "direct target access.",
            status_code=409,
        )
    try:
        target = await get_workspace_connection(db, workspace)
    except CloudRuntimeReconnectError as exc:
        log_cloud_event(
            "cloud workspace connection still resuming",
            level=logging.INFO,
            workspace_id=workspace.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        ) from exc
    except CloudApiError:
        raise
    except Exception as exc:
        await _mark_workspace_error_tx(
            workspace.id,
            format_exception_message(exc),
            status_detail="Reconnect failed",
            clear_runtime_metadata=False,
        )
        log_cloud_event(
            "cloud workspace connection check failed",
            level=logging.WARNING,
            workspace_id=workspace.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        ) from exc

    async with db_session.open_async_session() as reload_db:
        reloaded_workspace = await get_cloud_workspace_by_id(reload_db, workspace.id)
    if reloaded_workspace is not None:
        workspace = reloaded_workspace
    log_cloud_event(
        "cloud workspace connection issued",
        workspace_id=workspace.id,
        runtime_generation=target.runtime_generation,
        ready_agents=",".join(target.ready_agent_kinds) or "none",
    )
    return WorkspaceConnection(
        runtime_url=target.runtime_url,
        access_token=target.access_token,
        anyharness_workspace_id=target.anyharness_workspace_id,
        runtime_generation=target.runtime_generation,
        allowed_agent_kinds=allowed_agent_kinds(),
        ready_agent_kinds=target.ready_agent_kinds,
        runtime_auth=runtime_auth_payload(target.runtime_auth),
    )


async def _reject_shared_workspace_static_connection(
    workspace: RemoteAccessWorkspaceRecord,
) -> None:
    if workspace.owner_scope != "organization":
        return
    async with db_session.open_async_session() as db:
        exposure, _claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
    visibility = exposure.visibility if exposure else None
    if visibility == "shared_unclaimed":
        raise CloudApiError(
            "direct_attach_claim_required",
            "Claim the workspace before opening it directly in Desktop.",
            status_code=409,
        )
    if visibility == "claimed":
        raise CloudApiError(
            "direct_attach_token_required",
            "Claimed shared workspaces require a scoped direct-attach token.",
            status_code=409,
        )


async def _mark_workspace_error_tx(workspace_id: UUID, message: str, **kwargs: object) -> None:
    async with db_session.open_async_transaction() as db:
        await mark_workspace_error_by_id(db, workspace_id, message, **kwargs)
