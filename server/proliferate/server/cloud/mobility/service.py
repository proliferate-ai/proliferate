from __future__ import annotations

from contextlib import suppress
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_mobility.cleanup_items import (
    insert_cleanup_items_for_handoff,
    list_cleanup_items_for_handoff,
)
from proliferate.db.store.cloud_mobility.handoffs import (
    fail_cloud_workspace_handoff_op_checkpoint_for_user,
    fail_cloud_workspace_handoff_op_for_user,
    finalize_cloud_workspace_handoff_op_for_user,
    get_cloud_workspace_handoff_op,
    heartbeat_cloud_workspace_handoff_op_for_user,
    update_cloud_workspace_handoff_phase_for_user,
)
from proliferate.db.store.cloud_mobility.records import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
    CloudWorkspaceMoveCleanupItemInput,
)
from proliferate.db.store.cloud_mobility.workspaces import (
    backfill_cloud_workspace_mobility_for_workspace,
    ensure_cloud_workspace_mobility_for_user,
    load_cloud_workspace_mobility_value,
)
from proliferate.db.store.cloud_mobility.workspaces import (
    list_cloud_workspace_mobility_for_user as list_cloud_workspace_mobility_store,
)
from proliferate.db.store.cloud_sync.exposures import get_active_workspace_exposure
from proliferate.db.store.cloud_sync.projections import list_session_projections_for_workspace
from proliferate.db.store.cloud_workspaces import (
    get_cloud_workspace_for_user,
    load_cloud_workspace_by_id,
    load_existing_cloud_workspace,
)
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces_for_user as list_cloud_workspaces_store,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility import transactions as mobility_tx
from proliferate.server.cloud.mobility.domain.lifecycle import (
    CANONICAL_SIDE_DESTINATION,
    FINAL_HANDOFF_PHASES,
    HANDOFF_PHASE_CLEANUP_FAILED,
    HANDOFF_PHASE_CLEANUP_PENDING,
    HANDOFF_PHASE_COMPLETED,
    HANDOFF_PHASE_CUTOVER_COMMITTED,
    HANDOFF_PHASE_DESTINATION_READY,
    HANDOFF_PHASE_HANDOFF_FAILED,
    HANDOFF_PHASE_INSTALL_SUCCEEDED,
    HANDOFF_PHASE_SOURCE_FROZEN,
    HANDOFF_PHASE_START_REQUESTED,
    LIFECYCLE_HANDOFF_FAILED,
    OWNER_CLOUD,
    OWNER_LOCAL,
    active_lifecycle_state,
    is_retryable_mobility_failure,
    is_valid_handoff_phase,
    is_valid_owner,
    moving_lifecycle_state,
    normalize_owner,
    stale_handoff_outcome,
    target_owner_for_direction,
    visible_failure_last_error,
    visible_failure_status_detail,
)
from proliferate.server.cloud.workspaces.provisioning.service import (
    ensure_cloud_workspace_for_existing_branch,
    start_cloud_workspace,
)
from proliferate.utils.time import utcnow

_STALE_HANDOFF_AFTER = timedelta(seconds=120)
_WORKER_PROGRESS_PHASES = frozenset(
    {
        HANDOFF_PHASE_SOURCE_FROZEN,
        HANDOFF_PHASE_DESTINATION_READY,
        HANDOFF_PHASE_INSTALL_SUCCEEDED,
        HANDOFF_PHASE_CLEANUP_PENDING,
    }
)


_ALLOWED_PHASE_TRANSITIONS: dict[str, frozenset[str]] = {
    HANDOFF_PHASE_START_REQUESTED: frozenset({HANDOFF_PHASE_SOURCE_FROZEN}),
    HANDOFF_PHASE_SOURCE_FROZEN: frozenset({HANDOFF_PHASE_DESTINATION_READY}),
    HANDOFF_PHASE_DESTINATION_READY: frozenset({HANDOFF_PHASE_INSTALL_SUCCEEDED}),
    HANDOFF_PHASE_INSTALL_SUCCEEDED: frozenset({HANDOFF_PHASE_CUTOVER_COMMITTED}),
    HANDOFF_PHASE_CUTOVER_COMMITTED: frozenset({HANDOFF_PHASE_CLEANUP_PENDING}),
}
_MOBILITY_BACKFILLABLE_WORKSPACE_STATUSES = frozenset(
    {
        CloudWorkspaceStatus.pending.value,
        CloudWorkspaceStatus.materializing.value,
        CloudWorkspaceStatus.needs_rematerialization.value,
        CloudWorkspaceStatus.ready.value,
    }
)


def _should_backfill_mobility_from_cloud_workspace(workspace: CloudWorkspace) -> bool:
    return workspace.status in _MOBILITY_BACKFILLABLE_WORKSPACE_STATUSES


def _preserve_failed_handoff_during_passive_backfill(
    *,
    lifecycle_state: str,
    has_active_handoff: bool,
) -> bool:
    # Passive list backfill must not flip ownership after an executor failed before cutover.
    return False


def _phase_transition_allowed(*, current_phase: str, requested_phase: str) -> bool:
    if requested_phase == current_phase:
        return requested_phase in _WORKER_PROGRESS_PHASES
    return requested_phase in _ALLOWED_PHASE_TRANSITIONS.get(current_phase, frozenset())


async def _require_handoff_belongs_to_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> None:
    handoff = await get_cloud_workspace_handoff_op(
        db,
        user_id=user_id,
        handoff_op_id=handoff_op_id,
    )
    if handoff is None or handoff.mobility_workspace_id != mobility_workspace_id:
        raise CloudApiError("handoff_not_found", "Mobility handoff not found.", status_code=404)


async def _default_cleanup_items_for_cutover(
    db: AsyncSession,
    *,
    source_cloud_workspace_id: UUID | None,
    destination_cloud_workspace_id: UUID | None,
) -> list[CloudWorkspaceMoveCleanupItemInput]:
    if source_cloud_workspace_id is None:
        return []
    if (
        destination_cloud_workspace_id is not None
        and destination_cloud_workspace_id == source_cloud_workspace_id
    ):
        return []

    source_workspace = await load_cloud_workspace_by_id(db, source_cloud_workspace_id)
    if source_workspace is None:
        return []

    items: list[CloudWorkspaceMoveCleanupItemInput] = []
    if source_workspace.anyharness_workspace_id:
        items.append(
            CloudWorkspaceMoveCleanupItemInput(
                item_kind="anyharness_workspace",
                target_id=source_workspace.target_id,
                anyharness_workspace_id=source_workspace.anyharness_workspace_id,
            )
        )

    for projection in await list_session_projections_for_workspace(
        db,
        cloud_workspace_id=source_cloud_workspace_id,
        limit=500,
    ):
        items.append(
            CloudWorkspaceMoveCleanupItemInput(
                item_kind="cloud_session_projection",
                target_id=projection.target_id,
                object_id=projection.id,
            )
        )

    if source_workspace.target_id is not None:
        exposure = await get_active_workspace_exposure(
            db,
            target_id=source_workspace.target_id,
            cloud_workspace_id=source_cloud_workspace_id,
        )
        if exposure is not None:
            items.append(
                CloudWorkspaceMoveCleanupItemInput(
                    item_kind="cloud_exposure",
                    target_id=source_workspace.target_id,
                    object_id=exposure.id,
                )
            )
        items.append(
            CloudWorkspaceMoveCleanupItemInput(
                item_kind="worker_projection_cursor",
                target_id=source_workspace.target_id,
            )
        )

    items.append(
        CloudWorkspaceMoveCleanupItemInput(
            item_kind="cloud_workspace",
            target_id=source_workspace.target_id,
            object_id=source_cloud_workspace_id,
        )
    )
    return items


async def expire_stale_cloud_workspace_handoffs_for_user(
    db: AsyncSession, *, user_id: UUID
) -> None:
    stale_before = utcnow() - _STALE_HANDOFF_AFTER
    workspaces = await list_cloud_workspace_mobility_store(db, user_id=user_id)
    for workspace in workspaces:
        active_handoff = workspace.active_handoff
        if active_handoff is None or active_handoff.heartbeat_at >= stale_before:
            continue
        outcome = stale_handoff_outcome(
            finalized_at=active_handoff.finalized_at,
            cleanup_completed_at=active_handoff.cleanup_completed_at,
            canonical_side=active_handoff.canonical_side,
        )
        await fail_cloud_workspace_handoff_op_checkpoint_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=workspace.id,
            handoff_op_id=active_handoff.id,
            phase=outcome.phase,
            lifecycle_state=outcome.lifecycle_state,
            failure_code=outcome.failure_code,
            failure_detail=outcome.failure_detail,
            status_detail=visible_failure_status_detail(outcome.failure_detail),
            last_error=visible_failure_last_error(outcome.failure_detail),
            keep_active_handoff=outcome.keep_active_handoff,
            event_type="handoff_stale",
        )


async def list_cloud_workspace_mobility_for_user(
    db: AsyncSession, user_id: UUID
) -> list[CloudWorkspaceMobilityValue]:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    workspaces = await list_cloud_workspaces_store(db, user_id)
    for workspace in workspaces:
        if not _should_backfill_mobility_from_cloud_workspace(workspace):
            continue
        await backfill_cloud_workspace_mobility_for_workspace(
            db,
            workspace=workspace,
            active_lifecycle_state=active_lifecycle_state(OWNER_CLOUD),
            is_retryable_failure=_preserve_failed_handoff_during_passive_backfill,
        )
    return await list_cloud_workspace_mobility_store(db, user_id=user_id)


async def ensure_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    display_name: str | None,
    owner_hint: str,
) -> CloudWorkspaceMobilityValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    owner_hint = normalize_owner(owner_hint)
    if not is_valid_owner(owner_hint):
        raise CloudApiError(
            "invalid_owner_hint",
            "ownerHint must be one of 'local', 'personal_cloud', "
            "'shared_cloud', 'ssh', or legacy 'cloud'.",
            status_code=400,
        )

    existing_cloud_workspace = await load_existing_cloud_workspace(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
    )
    cloud_workspace_id = existing_cloud_workspace.id if existing_cloud_workspace else None
    resolved_display_name = display_name or (
        existing_cloud_workspace.display_name if existing_cloud_workspace else None
    )
    return await ensure_cloud_workspace_mobility_for_user(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        owner_hint=owner_hint,
        active_lifecycle_state=active_lifecycle_state(owner_hint),
        is_retryable_failure=is_retryable_mobility_failure,
        display_name=resolved_display_name,
        cloud_workspace_id=cloud_workspace_id,
    )


async def get_cloud_workspace_mobility_detail(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    record = await load_cloud_workspace_mobility_value(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    if record is None:
        raise CloudApiError(
            "mobility_workspace_not_found",
            "Logical workspace not found.",
            status_code=404,
        )
    return record


async def start_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    direction: str,
    requested_branch: str,
    requested_base_sha: str | None,
    exclude_paths: list[str],
) -> CloudWorkspaceHandoffOpValue:
    from proliferate.server.cloud.mobility.preflight.service import (
        preflight_cloud_workspace_handoff,
    )

    await mobility_tx.expire_stale_handoffs_tx(user_id=user_id, stale_after=_STALE_HANDOFF_AFTER)
    workspace = await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    preflight = await preflight_cloud_workspace_handoff(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        direction=direction,
        requested_branch=requested_branch,
        requested_base_sha=requested_base_sha,
    )
    if not preflight.can_start:
        raise CloudApiError(
            "mobility_preflight_failed",
            "; ".join(blocker.message for blocker in preflight.blockers),
            status_code=409,
            extra_detail={
                "blockers": [blocker.model_dump(by_alias=True) for blocker in preflight.blockers],
            },
        )
    source_owner = normalize_owner(workspace.owner)
    target_owner = target_owner_for_direction(direction)
    try:
        handoff = await mobility_tx.create_cloud_workspace_handoff_op_checkpoint_tx(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            moving_lifecycle_state=moving_lifecycle_state(target_owner),
            final_handoff_phases=FINAL_HANDOFF_PHASES,
            requested_branch=requested_branch,
            requested_base_sha=requested_base_sha,
            exclude_paths=exclude_paths,
        )
    except ValueError as error:
        if str(error) == "handoff already in progress for workspace":
            raise CloudApiError(
                "handoff_already_in_progress",
                str(error),
                status_code=409,
            ) from error
        if str(error) == "mobility workspace not found":
            raise CloudApiError(
                "mobility_workspace_not_found",
                "Logical workspace not found.",
                status_code=404,
            ) from error
        raise
    if direction == "local_to_cloud":
        try:
            user = await load_user_with_oauth_accounts_by_id(db, user_id)
            if user is None:
                raise CloudApiError("user_not_found", "User not found.", status_code=404)
            cloud_workspace = await ensure_cloud_workspace_for_existing_branch(
                user,
                git_provider=workspace.git_provider,
                git_owner=workspace.git_owner,
                git_repo_name=workspace.git_repo_name,
                branch_name=requested_branch,
                display_name=workspace.display_name,
            )
            await start_cloud_workspace(
                db, user, cloud_workspace.id, requested_base_sha=requested_base_sha
            )
        except Exception as error:
            failure_code = (
                error.code if isinstance(error, CloudApiError) else "handoff_start_failed"
            )
            failure_detail = (
                error.message
                if isinstance(error, CloudApiError)
                else str(error) or "Workspace handoff start failed."
            )
            with suppress(ValueError):
                await mobility_tx.fail_cloud_workspace_handoff_op_checkpoint_tx(
                    user_id=user_id,
                    mobility_workspace_id=mobility_workspace_id,
                    handoff_op_id=handoff.id,
                    phase=HANDOFF_PHASE_HANDOFF_FAILED,
                    lifecycle_state=LIFECYCLE_HANDOFF_FAILED,
                    failure_code=failure_code,
                    failure_detail=failure_detail,
                    status_detail=visible_failure_status_detail(failure_detail),
                    last_error=visible_failure_last_error(failure_detail),
                )
            raise
        return await mobility_tx.update_cloud_workspace_handoff_phase_checkpoint_tx(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff.id,
            phase="start_requested",
            status_detail="Provisioning cloud workspace",
            cloud_workspace_id=cloud_workspace.id,
        )
    return handoff


async def heartbeat_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    try:
        return await heartbeat_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def update_cloud_workspace_handoff_phase(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    if not is_valid_handoff_phase(phase):
        raise CloudApiError(
            "invalid_handoff_phase",
            f"Unsupported handoff phase '{phase}'.",
            status_code=400,
        )
    handoff = await get_cloud_workspace_handoff_op(
        db,
        user_id=user_id,
        handoff_op_id=handoff_op_id,
        lock=True,
    )
    if handoff is None or handoff.mobility_workspace_id != mobility_workspace_id:
        raise CloudApiError("handoff_not_found", "Mobility handoff not found.", status_code=404)
    if phase not in _WORKER_PROGRESS_PHASES and phase != HANDOFF_PHASE_CUTOVER_COMMITTED:
        raise CloudApiError(
            "invalid_handoff_phase",
            "Use finalize, fail, cleanup, or repair endpoints for terminal handoff states.",
            status_code=409,
        )
    if not _phase_transition_allowed(current_phase=handoff.phase, requested_phase=phase):
        raise CloudApiError(
            "invalid_handoff_phase",
            f"Cannot move handoff from '{handoff.phase}' to '{phase}'.",
            status_code=409,
        )
    if phase == HANDOFF_PHASE_CUTOVER_COMMITTED:
        return await finalize_cloud_workspace_handoff(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            cloud_workspace_id=cloud_workspace_id,
        )
    try:
        return await update_cloud_workspace_handoff_phase_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=phase,
            status_detail=status_detail,
            cloud_workspace_id=cloud_workspace_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def finalize_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    source_workspace = await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    handoff = await get_cloud_workspace_handoff_op(
        db,
        user_id=user_id,
        handoff_op_id=handoff_op_id,
        lock=True,
    )
    if handoff is None or handoff.mobility_workspace_id != mobility_workspace_id:
        raise CloudApiError("handoff_not_found", "Mobility handoff not found.", status_code=404)
    if handoff.phase not in {
        HANDOFF_PHASE_INSTALL_SUCCEEDED,
        HANDOFF_PHASE_CUTOVER_COMMITTED,
        HANDOFF_PHASE_CLEANUP_PENDING,
    }:
        raise CloudApiError(
            "invalid_handoff_phase",
            "Handoff must reach install_succeeded before cutover can be committed.",
            status_code=409,
        )
    target_owner = normalize_owner(handoff.target_owner)
    if target_owner == OWNER_LOCAL:
        if cloud_workspace_id is not None:
            raise CloudApiError(
                "invalid_destination_workspace",
                "Local handoff destinations must not provide a cloud workspace id.",
                status_code=400,
            )
    else:
        if cloud_workspace_id is None:
            raise CloudApiError(
                "destination_workspace_required",
                "Cloud handoff destinations must provide a destination cloud workspace id.",
                status_code=400,
            )
        destination_workspace = await get_cloud_workspace_for_user(
            db,
            user_id,
            cloud_workspace_id,
        )
        if (
            destination_workspace is None
            or destination_workspace.git_provider != source_workspace.git_provider
            or destination_workspace.git_owner != source_workspace.git_owner
            or destination_workspace.git_repo_name != source_workspace.git_repo_name
            or destination_workspace.git_branch != source_workspace.git_branch
        ):
            raise CloudApiError(
                "invalid_destination_workspace",
                "Destination cloud workspace does not match the mobility workspace.",
                status_code=409,
            )
    try:
        value = await finalize_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            cloud_workspace_id=cloud_workspace_id,
        )
    except ValueError as error:
        raise CloudApiError("invalid_handoff_phase", str(error), status_code=409) from error
    if value.canonical_side != CANONICAL_SIDE_DESTINATION:
        raise CloudApiError(
            "cutover_not_committed",
            "Handoff cutover did not commit.",
            status_code=500,
        )
    existing_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
    if not existing_items:
        cleanup_items = await _default_cleanup_items_for_cutover(
            db,
            source_cloud_workspace_id=source_workspace.cloud_workspace_id,
            destination_cloud_workspace_id=cloud_workspace_id,
        )
        await insert_cleanup_items_for_handoff(
            db,
            handoff_op_id=handoff_op_id,
            items=cleanup_items,
        )
    value = await update_cloud_workspace_handoff_phase_for_user(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
        phase=HANDOFF_PHASE_CLEANUP_PENDING,
        status_detail="Awaiting source cleanup",
        cloud_workspace_id=cloud_workspace_id,
    )
    return value


async def fail_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    failure_code: str,
    failure_detail: str,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    try:
        await _require_handoff_belongs_to_workspace(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
        handoff = await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        )
        if handoff is not None and (
            handoff.phase == HANDOFF_PHASE_COMPLETED or handoff.cleanup_completed_at is not None
        ):
            return handoff
        phase = (
            HANDOFF_PHASE_CLEANUP_FAILED
            if handoff is not None and handoff.canonical_side == CANONICAL_SIDE_DESTINATION
            else HANDOFF_PHASE_HANDOFF_FAILED
        )
        lifecycle_state = (
            "cleanup_failed" if phase == HANDOFF_PHASE_CLEANUP_FAILED else LIFECYCLE_HANDOFF_FAILED
        )
        return await fail_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=phase,
            lifecycle_state=lifecycle_state,
            failure_code=failure_code,
            failure_detail=failure_detail,
            status_detail=visible_failure_status_detail(failure_detail),
            last_error=visible_failure_last_error(failure_detail),
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error
