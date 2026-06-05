"""Application service for Proliferate Worker registration and heartbeats."""

from __future__ import annotations

import json
import secrets
from time import monotonic
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_TARGET_HEARTBEAT_STALE_SECONDS,
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudTargetStatus,
    CloudTargetUpdateStatus,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db.store import cloud_workspaces
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import inventory as inventory_store
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.db.store.cloud_sync import worker_exposures as worker_exposures_store
from proliferate.db.store.users import get_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.events.models import (
    WorkerEventBatchRequest,
    WorkerEventBatchResponse,
)
from proliferate.server.cloud.events.service import ingest_worker_event_batch
from proliferate.server.cloud.live.service import (
    defer_live_publishes_until_commit,
    publish_target_patch_after_commit,
    publish_worker_control_after_commit,
)
from proliferate.server.cloud.observability import log_worker_update_status
from proliferate.server.cloud.target_git_identity.service import materialize_target_git_identity
from proliferate.server.cloud.worker.auth import hash_token
from proliferate.server.cloud.worker.domain.rules import (
    compact_json,
    validate_update_component,
    validate_update_status,
    validate_update_version,
    validate_worker_status,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.domain.updates import (
    ACTIVE_TARGET_UPDATE_STATUSES,
    DesiredVersions,
    desired_versions_match,
    has_desired_versions,
    require_expected_update_version,
)
from proliferate.server.cloud.worker.models import (
    WorkerDesiredVersionsResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerExposureListResponse,
    WorkerExposureSnapshotResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryPayload,
    WorkerInventoryRequest,
    WorkerInventoryResponse,
    WorkerMaterializationReportRequest,
    WorkerMaterializationReportResponse,
    WorkerProjectionGapRequest,
    WorkerProjectionGapResponse,
    WorkerUpdateStatusRequest,
    WorkerUpdateStatusResponse,
)
from proliferate.server.cloud.worker.runtime_access import (
    update_runtime_access_for_managed_worker,
)
from proliferate.server.cloud.worker.target_validation import (
    require_current_worker_target as _require_current_worker_target,
)
from proliferate.server.cloud.worker.target_validation import (
    require_enrollment_profile_for_target,
    worker_request_profile_id,
)
from proliferate.utils.time import utcnow

_LEGACY_EXPOSURE_CACHE_TTL_SECONDS = 2.0
_legacy_exposure_cache: dict[UUID, tuple[float, WorkerExposureListResponse]] = {}
_UNSET = object()


async def _record_inventory_payload(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    payload: WorkerInventoryPayload,
) -> None:
    await inventory_store.upsert_inventory(
        db,
        target_id=target_id,
        worker_id=worker_id,
        os=payload.os,
        arch=payload.arch,
        distro=payload.distro,
        shell=payload.shell,
        git_json=compact_json(payload.git),
        node_json=compact_json(payload.node),
        python_json=compact_json(payload.python),
        browser_json=compact_json(payload.browser),
        capabilities_json=compact_json(payload.capabilities),
        providers_json=compact_json(payload.providers),
        mcp_json=compact_json(payload.mcp),
        raw_json=None,
    )


async def _publish_current_target_patch(db: AsyncSession, *, target_id: UUID) -> None:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is not None:
        await publish_target_patch_after_commit(db, target)


async def _enqueue_initial_git_identity(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    created_by_user_id: UUID,
) -> None:
    user = await get_user_with_oauth_accounts_by_id(db, created_by_user_id)
    if user is None:
        await inventory_store.upsert_target_status(
            db,
            target_id=target_id,
            worker_id=worker_id,
            status_value=CloudTargetStatus.online.value,
            status_detail=(
                "Worker enrolled; Git bootstrap failed because the creator was not found."
            ),
        )
        return
    try:
        await materialize_target_git_identity(
            db,
            target_id=target_id,
            user=user,
            source="automation",
            idempotency_key="worker-enrollment",
        )
    except CloudApiError as exc:
        await inventory_store.upsert_target_status(
            db,
            target_id=target_id,
            worker_id=worker_id,
            status_value=CloudTargetStatus.online.value,
            status_detail=f"Worker enrolled; Git bootstrap failed: {exc.code}.",
        )


def _target_desired_versions(target: targets_store.CloudTargetSnapshot) -> DesiredVersions:
    return DesiredVersions(
        anyharness_version=target.desired_anyharness_version,
        worker_version=target.desired_worker_version,
        supervisor_version=target.desired_supervisor_version,
    )


def _worker_current_versions(worker: worker_auth_store.CloudWorkerSnapshot) -> DesiredVersions:
    return DesiredVersions(
        anyharness_version=worker.anyharness_version,
        worker_version=worker.worker_version,
        supervisor_version=worker.supervisor_version,
    )


def _target_current_versions(
    target: targets_store.CloudTargetSnapshot,
) -> DesiredVersions | None:
    current_versions = target.current_versions
    if current_versions is None:
        return None
    return DesiredVersions(
        anyharness_version=current_versions.anyharness_version,
        worker_version=current_versions.worker_version,
        supervisor_version=current_versions.supervisor_version,
    )


def _target_has_desired_versions(target: targets_store.CloudTargetSnapshot) -> bool:
    return has_desired_versions(_target_desired_versions(target))


def _desired_versions_response(
    *,
    target: targets_store.CloudTargetSnapshot,
    worker: worker_auth_store.CloudWorkerSnapshot,
) -> WorkerDesiredVersionsResponse:
    desired = _target_desired_versions(target)
    current = _worker_current_versions(worker)
    should_update = has_desired_versions(desired) and not desired_versions_match(
        desired=desired,
        current=current,
    )
    return WorkerDesiredVersionsResponse(
        should_update=should_update,
        update_channel=target.update_channel,
        update_generation=target.update_generation,
        anyharness_version=target.desired_anyharness_version,
        worker_version=target.desired_worker_version,
        supervisor_version=target.desired_supervisor_version,
    )


async def enroll_worker(
    db: AsyncSession,
    *,
    body: WorkerEnrollRequest,
) -> WorkerEnrollResponse:
    now = utcnow()
    enrollment = await worker_auth_store.consume_pending_enrollment_by_hash(
        db,
        token_hash=hash_token(
            domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
            token=body.enrollment_token,
        ),
        now=now,
    )
    if enrollment is None:
        raise CloudApiError(
            "cloud_worker_enrollment_invalid",
            "Enrollment token is invalid or expired.",
            status_code=401,
        )
    target = await targets_store.get_target_by_id(db, enrollment.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    require_enrollment_profile_for_target(enrollment=enrollment, target=target)
    worker_token = secrets.token_urlsafe(48)
    worker = await worker_auth_store.create_worker(
        db,
        target_id=enrollment.target_id,
        token_hash=hash_token(domain=CLOUD_WORKER_TOKEN_DOMAIN, token=worker_token),
        machine_fingerprint=body.machine_fingerprint,
        hostname=body.hostname,
        worker_version=body.worker_version,
        anyharness_version=body.anyharness_version,
        supervisor_version=body.supervisor_version,
        now=now,
    )
    await inventory_store.upsert_target_status(
        db,
        target_id=worker.target_id,
        worker_id=worker.id,
        status_value=CloudTargetStatus.online.value,
        status_detail="Worker enrolled.",
    )
    await targets_store.set_target_status(
        db,
        target_id=worker.target_id,
        status_value=CloudTargetStatus.online.value,
    )
    await worker_control_store.get_or_create_control_state(db, target_id=worker.target_id)
    if enrollment.sandbox_profile_id is not None:
        await update_runtime_access_for_managed_worker(
            db,
            target_id=worker.target_id,
            sandbox_profile_id=enrollment.sandbox_profile_id,
            worker_id=worker.id,
            now=now,
        )
    if body.inventory is not None:
        await _record_inventory_payload(
            db,
            target_id=worker.target_id,
            worker_id=worker.id,
            payload=body.inventory,
        )
    await _enqueue_initial_git_identity(
        db,
        target_id=worker.target_id,
        worker_id=worker.id,
        created_by_user_id=enrollment.created_by_user_id,
    )
    await _publish_current_target_patch(db, target_id=worker.target_id)
    return WorkerEnrollResponse(
        target_id=str(worker.target_id),
        sandbox_profile_id=(
            str(enrollment.sandbox_profile_id) if enrollment.sandbox_profile_id else None
        ),
        worker_id=str(worker.id),
        worker_token=worker_token,
        heartbeat_interval_seconds=CLOUD_TARGET_HEARTBEAT_STALE_SECONDS // 3,
    )


async def record_heartbeat(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerHeartbeatRequest,
) -> WorkerHeartbeatResponse:
    status_value = validate_worker_status(body.status)
    now = utcnow()
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    sandbox_profile_id = worker_request_profile_id(
        target=target,
        sandbox_profile_id=body.sandbox_profile_id,
    )
    worker = await worker_auth_store.record_worker_heartbeat(
        db,
        worker_id=auth.worker_id,
        status_value=status_value,
        worker_version=body.worker_version,
        anyharness_version=body.anyharness_version,
        supervisor_version=body.supervisor_version,
        now=now,
    )
    if worker is None:
        raise CloudApiError(
            "cloud_worker_not_found",
            "Worker not found.",
            status_code=404,
        )
    await inventory_store.upsert_target_status(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status_value=status_value,
        status_detail=body.status_detail,
    )
    await targets_store.set_target_status(db, target_id=auth.target_id, status_value=status_value)
    if sandbox_profile_id is not None:
        await update_runtime_access_for_managed_worker(
            db,
            target_id=auth.target_id,
            sandbox_profile_id=sandbox_profile_id,
            worker_id=auth.worker_id,
            now=now,
        )
    desired_versions = _desired_versions_response(target=target, worker=worker)
    if target.update_status in ACTIVE_TARGET_UPDATE_STATUSES and desired_versions_match(
        desired=_target_desired_versions(target),
        current=_worker_current_versions(worker),
    ):
        result = await targets_store.record_target_update_status_for_generation(
            db,
            target_id=auth.target_id,
            expected_update_generation=target.update_generation,
            status_value=CloudTargetUpdateStatus.applied.value,
            status_detail="Desired versions reported by worker.",
            component=None,
            version=None,
            reported_at=now,
        )
        target = result.target or target
    await publish_target_patch_after_commit(db, target)
    return WorkerHeartbeatResponse(
        target_id=str(auth.target_id),
        sandbox_profile_id=str(sandbox_profile_id) if sandbox_profile_id else None,
        worker_id=str(auth.worker_id),
        status=status_value,
        server_time=now.isoformat(),
        desired_versions=desired_versions,
    )


async def record_inventory(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerInventoryRequest,
) -> WorkerInventoryResponse:
    status_value = validate_worker_status(body.status)
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    await _record_inventory_payload(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        payload=body,
    )
    await inventory_store.upsert_target_status(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status_value=status_value,
        status_detail=body.status_detail,
    )
    await targets_store.set_target_status(db, target_id=auth.target_id, status_value=status_value)
    await _publish_current_target_patch(db, target_id=auth.target_id)
    return WorkerInventoryResponse(
        target_id=str(auth.target_id),
        worker_id=str(auth.worker_id),
        updated=True,
    )


def _report_cleanup_state(
    body: WorkerMaterializationReportRequest,
) -> str | object:
    cleanup_status = (body.cleanup_status or "").strip().lower()
    state = body.state.strip().lower()
    if cleanup_status in {"completed", "complete"}:
        return CloudWorkspaceCleanupState.complete.value
    if cleanup_status == "blocked" or state == "prune_blocked":
        return CloudWorkspaceCleanupState.blocked.value
    if cleanup_status == "failed" or state == "prune_failed":
        return CloudWorkspaceCleanupState.failed.value
    if cleanup_status in {"pruning", "pending"} or state in {"dehydrating", "pruning"}:
        return CloudWorkspaceCleanupState.pending.value
    if state == "hydrated":
        return CloudWorkspaceCleanupState.none.value
    return _UNSET


def _report_cleanup_error(body: WorkerMaterializationReportRequest) -> str | None | object:
    if body.cleanup_last_error:
        return body.cleanup_last_error
    if body.blockers:
        return json.dumps({"blockers": body.blockers}, separators=(",", ":"), sort_keys=True)
    return None if (body.cleanup_status or "").lower() in {"completed", "complete"} else _UNSET


async def record_materialization_report(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerMaterializationReportRequest,
) -> WorkerMaterializationReportResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(
        db,
        body.cloud_workspace_id,
    )
    if workspace is None:
        raise CloudApiError(
            "cloud_worker_workspace_missing",
            "Cloud workspace no longer exists.",
            status_code=404,
        )
    if workspace.target_id != auth.target_id:
        raise CloudApiError(
            "cloud_worker_workspace_target_mismatch",
            "Cloud workspace is not attached to this worker target.",
            status_code=409,
        )

    state = body.state.strip().lower()
    status: str | object = _UNSET
    status_detail: str | None | object = _UNSET
    anyharness_workspace_id: str | None | object = _UNSET
    cleanup_state = _report_cleanup_state(body)
    cleanup_last_error = _report_cleanup_error(body)

    if state == "hydrated":
        if not body.anyharness_workspace_id:
            raise CloudApiError(
                "cloud_worker_materialization_workspace_required",
                "Hydrated materialization reports require anyharnessWorkspaceId.",
                status_code=400,
            )
        anyharness_workspace_id = body.anyharness_workspace_id
        status = (
            CloudWorkspaceStatus.archived.value
            if workspace.archived_at is not None
            else CloudWorkspaceStatus.ready.value
        )
        status_detail = "Archived" if workspace.archived_at is not None else "Ready"
    elif state in {"dehydrated", "prune_blocked", "prune_failed", "dehydrating", "pruning"}:
        if (
            body.anyharness_workspace_id
            and workspace.anyharness_workspace_id is not None
            and workspace.anyharness_workspace_id != body.anyharness_workspace_id
        ):
            raise CloudApiError(
                "cloud_worker_materialization_workspace_mismatch",
                "Materialization report does not match the current AnyHarness workspace.",
                status_code=409,
            )
        if body.anyharness_workspace_id:
            anyharness_workspace_id = None if state == "dehydrated" else _UNSET
        status = (
            CloudWorkspaceStatus.archived.value
            if workspace.archived_at is not None
            else CloudWorkspaceStatus.needs_rematerialization.value
            if state == "dehydrated"
            else _UNSET
        )
        status_detail = (
            "Archived"
            if workspace.archived_at is not None
            else "Worktree pruned"
            if state == "dehydrated"
            else _UNSET
        )
    else:
        raise CloudApiError(
            "cloud_worker_materialization_state_invalid",
            f"Unsupported materialization state: {body.state}",
            status_code=400,
        )

    updates: dict[str, object] = {}
    if anyharness_workspace_id is not _UNSET:
        updates["anyharness_workspace_id"] = anyharness_workspace_id
    if state == "dehydrated":
        updates["worktree_path"] = None
    elif body.worktree_path is not None:
        updates["worktree_path"] = body.worktree_path
    if status is not _UNSET:
        updates["status"] = status
    if status_detail is not _UNSET:
        updates["status_detail"] = status_detail
    if cleanup_state is not _UNSET:
        updates["cleanup_state"] = cleanup_state
    if cleanup_last_error is not _UNSET:
        updates["cleanup_last_error"] = cleanup_last_error
    if state == "hydrated":
        updates["materialized_target_id"] = auth.target_id
    await cloud_workspaces.update_cloud_workspace_materialization_state(
        db,
        workspace=workspace,
        **updates,
    )
    if state == "dehydrated" and body.anyharness_workspace_id:
        cleared_exposure = await exposures_store.clear_workspace_exposure_materialization(
            db,
            target_id=auth.target_id,
            cloud_workspace_id=workspace.id,
            anyharness_workspace_id=body.anyharness_workspace_id,
        )
        if cleared_exposure is not None:
            await publish_worker_control_after_commit(
                db,
                target_id=auth.target_id,
                reason="exposures",
            )
    return WorkerMaterializationReportResponse(
        cloud_workspace_id=str(workspace.id),
        updated=True,
    )


async def record_update_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerUpdateStatusRequest,
) -> WorkerUpdateStatusResponse:
    status_value = validate_update_status(body.status)
    component = validate_update_component(body.component)
    version = validate_update_version(body.version)
    detail = body.detail or body.error_message
    current_target = await targets_store.get_target_by_id(db, auth.target_id)
    if current_target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(current_target)
    if not _target_has_desired_versions(current_target):
        raise CloudApiError(
            "cloud_worker_update_not_requested",
            "Worker update status cannot be reported before desired versions are set.",
            status_code=409,
        )
    require_expected_update_version(
        desired=_target_desired_versions(current_target),
        current_update_generation=current_target.update_generation,
        update_generation=body.update_generation,
        status_value=status_value,
        component=component,
        version=version,
    )
    if status_value == CloudTargetUpdateStatus.applied.value and not (
        desired_versions_match(
            desired=_target_desired_versions(current_target),
            current=_target_current_versions(current_target),
        )
    ):
        raise CloudApiError(
            "cloud_worker_update_versions_not_current",
            "Worker update cannot be marked applied until current versions "
            "match desired versions.",
            status_code=409,
        )
    result = await targets_store.record_target_update_status_for_generation(
        db,
        target_id=auth.target_id,
        expected_update_generation=current_target.update_generation,
        status_value=status_value,
        status_detail=detail,
        component=component,
        version=version,
        reported_at=utcnow(),
    )
    if not result.generation_matched:
        raise CloudApiError(
            "cloud_worker_update_generation_stale",
            "Worker update generation does not match the target desired versions.",
            status_code=409,
        )
    if result.target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    target = result.target
    log_worker_update_status(
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status=status_value,
        component=component,
        version=version,
    )
    await publish_target_patch_after_commit(db, target)
    return WorkerUpdateStatusResponse(
        target_id=str(auth.target_id),
        worker_id=str(auth.worker_id),
        updated=True,
    )


async def list_worker_exposures(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
) -> WorkerExposureListResponse:
    cached = _legacy_exposure_cache.get(auth.target_id)
    now = monotonic()
    if cached is not None and cached[0] > now:
        return cached[1]
    exposures = await worker_exposures_store.list_worker_exposure_snapshots_for_target(
        db,
        target_id=auth.target_id,
    )
    response = _worker_exposure_response_from_snapshots(exposures)
    _legacy_exposure_cache[auth.target_id] = (
        now + _LEGACY_EXPOSURE_CACHE_TTL_SECONDS,
        response,
    )
    return response


def _worker_exposure_response_from_snapshots(
    exposures: tuple[worker_exposures_store.WorkerExposureSnapshot, ...],
) -> WorkerExposureListResponse:
    return WorkerExposureListResponse(
        exposures=[
            WorkerExposureSnapshotResponse(
                exposure_id=str(exposure.exposure_id),
                target_id=str(exposure.target_id),
                cloud_workspace_id=str(exposure.cloud_workspace_id),
                session_projection_id=(
                    str(exposure.session_projection_id)
                    if exposure.session_projection_id is not None
                    else None
                ),
                anyharness_workspace_id=exposure.anyharness_workspace_id,
                anyharness_session_id=exposure.anyharness_session_id,
                projection_level=exposure.projection_level,
                commandable=exposure.commandable,
                status=exposure.status,
                revision=exposure.revision,
                last_uploaded_seq=exposure.last_uploaded_seq,
            )
            for exposure in exposures
        ]
    )


async def record_event_batch(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerEventBatchRequest,
) -> WorkerEventBatchResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    with defer_live_publishes_until_commit(db):
        return await ingest_worker_event_batch(db, auth=auth, body=body)


async def record_projection_gap(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerProjectionGapRequest,
) -> WorkerProjectionGapResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    projection = await projections_store.get_session_projection_metadata(
        db,
        target_id=auth.target_id,
        session_id=body.session_id,
    )
    if (
        projection is None
        or projection.id != body.session_projection_id
        or projection.exposure_id != body.exposure_id
    ):
        raise CloudApiError(
            "cloud_projection_gap_projection_mismatch",
            "Projection gap does not match an active Cloud projection.",
            status_code=409,
        )
    exposure = await exposures_store.get_workspace_exposure_by_id(db, body.exposure_id)
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        raise CloudApiError(
            "cloud_projection_gap_exposure_inactive",
            "Projection exposure is no longer active.",
            status_code=409,
        )
    if (projection.last_uploaded_seq or 0) > body.last_uploaded_seq or (
        projection.last_uploaded_seq or 0
    ) >= body.expected_seq:
        return WorkerProjectionGapResponse(updated=False)
    gap_state_json = compact_json(
        {
            "reason": "anyharness_event_sequence_gap",
            "expectedSeq": body.expected_seq,
            "firstObservedSeq": body.first_observed_seq,
            "lastUploadedSeq": body.last_uploaded_seq,
            "exposureId": str(body.exposure_id),
            "sessionProjectionId": str(body.session_projection_id),
            "reportedByWorkerId": str(auth.worker_id),
            "reportedAt": utcnow().isoformat(),
        }
    )
    await projections_store.set_projection_gap_state(
        db,
        target_id=auth.target_id,
        session_id=body.session_id,
        gap_state_json=gap_state_json or "{}",
    )
    return WorkerProjectionGapResponse(updated=True)
