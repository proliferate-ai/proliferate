from __future__ import annotations

import time
from contextlib import suppress
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
    CloudWorkspaceMoveCleanupItemInput,
    CloudWorkspaceMoveCleanupItemValue,
    all_cleanup_items_completed,
    backfill_cloud_workspace_mobility_for_workspace,
    complete_cloud_workspace_handoff_cleanup_for_user,
    create_cloud_workspace_handoff_op_for_user,
    ensure_cloud_workspace_mobility_for_user,
    fail_cloud_workspace_handoff_op_checkpoint_for_user,
    fail_cloud_workspace_handoff_op_for_user,
    finalize_cloud_workspace_handoff_op_for_user,
    get_cleanup_item_for_handoff,
    get_cloud_workspace_handoff_op,
    heartbeat_cloud_workspace_handoff_op_for_user,
    insert_cleanup_items_for_handoff,
    list_cleanup_items_for_handoff,
    load_active_user_handoff_op_for_user,
    load_cloud_workspace_mobility_for_user,
    load_cloud_workspace_mobility_value,
    record_cloud_workspace_mobility_event_for_user,
    update_cleanup_item_status,
    update_cloud_workspace_handoff_phase_checkpoint_for_user,
    update_cloud_workspace_handoff_phase_for_user,
)
from proliferate.db.store.cloud_mobility import (
    list_cloud_workspace_mobility_for_user as list_cloud_workspace_mobility_store,
)
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_sync.events import list_session_projections_for_workspace
from proliferate.db.store.cloud_sync.exposures import get_active_workspace_exposure
from proliferate.db.store.cloud_workspaces import (
    get_cloud_workspace_for_user,
    load_existing_cloud_workspace,
)
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces_for_user as list_cloud_workspaces_store,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility.cleanup_executor import (
    SERVER_CLEANUP_ITEM_KINDS,
    execute_server_cleanup_item,
)
from proliferate.server.cloud.mobility.domain.lifecycle import (
    CANONICAL_SIDE_DESTINATION,
    FINAL_HANDOFF_PHASES,
    HANDOFF_PHASE_CLEANUP_FAILED,
    HANDOFF_PHASE_CLEANUP_PENDING,
    HANDOFF_PHASE_CUTOVER_COMMITTED,
    HANDOFF_PHASE_DESTINATION_READY,
    HANDOFF_PHASE_HANDOFF_FAILED,
    HANDOFF_PHASE_INSTALL_SUCCEEDED,
    HANDOFF_PHASE_SOURCE_FROZEN,
    HANDOFF_PHASE_START_REQUESTED,
    LIFECYCLE_CLEANUP_FAILED,
    LIFECYCLE_HANDOFF_FAILED,
    OWNER_CLOUD,
    OWNER_LOCAL,
    active_lifecycle_state,
    cleanup_retry_delay_seconds,
    is_local_to_cloud_direction,
    is_retryable_mobility_failure,
    is_valid_handoff_direction,
    is_valid_handoff_phase,
    is_valid_owner,
    moving_lifecycle_state,
    normalize_owner,
    owner_direction_blocker,
    stale_handoff_outcome,
    target_owner_for_direction,
    visible_failure_last_error,
    visible_failure_status_detail,
)
from proliferate.server.cloud.mobility.models import (
    WorkspaceMobilityPreflightResponse,
    mobility_workspace_detail_payload,
)
from proliferate.server.cloud.repos.service import get_repo_branches_for_user
from proliferate.server.cloud.workspaces.service import (
    ensure_cloud_workspace_for_existing_branch,
    start_cloud_workspace,
)
from proliferate.utils.time import duration_ms, utcnow

_STALE_HANDOFF_AFTER = timedelta(seconds=120)
_BRANCH_NOT_PUBLISHED_BLOCKER = "The branch '{branch}' was not found on GitHub."
_BRANCH_HEAD_MISMATCH_BLOCKER = "The branch '{branch}' on GitHub is not at the requested commit."
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

    source_workspace = await db.get(CloudWorkspace, source_cloud_workspace_id)
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


async def expire_stale_cloud_workspace_handoffs_for_user(*, user_id: UUID) -> None:
    stale_before = utcnow() - _STALE_HANDOFF_AFTER
    workspaces = await list_cloud_workspace_mobility_store(user_id=user_id)
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
    user_id: UUID,
) -> list[CloudWorkspaceMobilityValue]:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    workspaces = await list_cloud_workspaces_store(user_id)
    for workspace in workspaces:
        await backfill_cloud_workspace_mobility_for_workspace(
            workspace=workspace,
            active_lifecycle_state=active_lifecycle_state(OWNER_CLOUD),
            is_retryable_failure=is_retryable_mobility_failure,
        )
    return await list_cloud_workspace_mobility_store(user_id=user_id)


async def ensure_cloud_workspace_mobility(
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    display_name: str | None,
    owner_hint: str,
) -> CloudWorkspaceMobilityValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    owner_hint = normalize_owner(owner_hint)
    if not is_valid_owner(owner_hint):
        raise CloudApiError(
            "invalid_owner_hint",
            "ownerHint must be one of 'local', 'personal_cloud', "
            "'shared_cloud', 'ssh', or legacy 'cloud'.",
            status_code=400,
        )

    existing_cloud_workspace = await load_existing_cloud_workspace(
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
    db: AsyncSession | None = None,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    record = (
        await load_cloud_workspace_mobility_value(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        )
        if db is not None
        else await load_cloud_workspace_mobility_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        )
    )
    if record is None:
        raise CloudApiError(
            "mobility_workspace_not_found",
            "Logical workspace not found.",
            status_code=404,
        )
    return record


async def preflight_cloud_workspace_handoff(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    direction: str,
    requested_branch: str,
    requested_base_sha: str | None,
) -> WorkspaceMobilityPreflightResponse:
    preflight_started = time.perf_counter()
    detail_elapsed_ms: int | None = None
    branch_lookup_elapsed_ms: int | None = None
    repo_config_elapsed_ms: int | None = None
    normalized_requested_branch = requested_branch.strip()
    normalized_requested_base_sha = (
        requested_base_sha.strip() if requested_base_sha is not None else None
    )
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    detail_started = time.perf_counter()
    workspace = await get_cloud_workspace_mobility_detail(
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    detail_elapsed_ms = duration_ms(detail_started)
    blockers: list[str] = []
    if not is_valid_handoff_direction(direction):
        raise CloudApiError(
            "invalid_handoff_direction",
            "direction must be a supported workspace move direction.",
            status_code=400,
        )
    if workspace.cloud_lost_at is not None:
        blockers.append("cloud workspace is in cloud_lost state")
    if workspace.active_handoff is not None:
        blockers.append("handoff already in progress for workspace")
    active_handoff = await load_active_user_handoff_op_for_user(
        user_id=user_id,
        final_handoff_phases=FINAL_HANDOFF_PHASES,
    )
    if active_handoff is not None and active_handoff.mobility_workspace_id != workspace.id:
        blockers.append("another handoff is already in progress for this user")
    owner_blocker = owner_direction_blocker(owner=workspace.owner, direction=direction)
    if owner_blocker is not None:
        blockers.append(owner_blocker)
    if is_local_to_cloud_direction(direction):
        user = await load_user_with_oauth_accounts_by_id(user_id)
        if user is None:
            raise CloudApiError("user_not_found", "User not found.", status_code=404)
        branch_lookup_started = time.perf_counter()
        try:
            repo_branches = await get_repo_branches_for_user(
                user,
                git_owner=workspace.git_owner,
                git_repo_name=workspace.git_repo_name,
                missing_access_message=(
                    "Connect a GitHub account before moving this workspace to cloud."
                ),
                repo_access_required_message=(
                    "Reconnect GitHub and grant repository access before "
                    "moving this workspace to cloud."
                ),
            )
        except CloudApiError as error:
            branch_lookup_elapsed_ms = duration_ms(branch_lookup_started)
            if error.code in {"github_link_required", "github_repo_access_required"}:
                blockers.append(error.message)
            else:
                raise
        else:
            branch_lookup_elapsed_ms = duration_ms(branch_lookup_started)
            if normalized_requested_branch not in repo_branches.branches:
                blockers.append(
                    _BRANCH_NOT_PUBLISHED_BLOCKER.format(branch=normalized_requested_branch)
                )
            elif (
                normalized_requested_base_sha
                and repo_branches.branch_heads_by_name.get(normalized_requested_branch)
                != normalized_requested_base_sha
            ):
                blockers.append(
                    _BRANCH_HEAD_MISMATCH_BLOCKER.format(branch=normalized_requested_branch)
                )

    repo_config_started = time.perf_counter()
    repo_config = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    repo_config_elapsed_ms = duration_ms(repo_config_started)
    excluded_paths = (
        [item.relative_path for item in repo_config.tracked_files]
        if repo_config is not None
        else []
    )
    if normalized_requested_branch != workspace.git_branch:
        blockers.append("requested branch does not match logical workspace branch")
    if requested_base_sha is not None and not normalized_requested_base_sha:
        blockers.append("requested base sha must be non-empty when provided")

    response = WorkspaceMobilityPreflightResponse(
        can_start=not blockers,
        blockers=blockers,
        excluded_paths=excluded_paths,
        workspace=mobility_workspace_detail_payload(workspace),
    )
    log_cloud_event(
        "mobility preflight completed",
        mobility_workspace_id=mobility_workspace_id,
        direction=direction,
        blocker_count=len(blockers),
        can_start=response.can_start,
        workspace_detail_ms=detail_elapsed_ms,
        branch_lookup_ms=branch_lookup_elapsed_ms,
        repo_config_ms=repo_config_elapsed_ms,
        elapsed_ms=duration_ms(preflight_started),
    )
    with suppress(Exception):
        await record_cloud_workspace_mobility_event_for_user(
            user_id=user_id,
            cloud_workspace_id=workspace.cloud_workspace_id,
            handoff_op_id=workspace.active_handoff.id if workspace.active_handoff else None,
            event_type="preflight_completed",
            direction=direction,
            source_owner=workspace.owner,
            target_owner=target_owner_for_direction(direction)
            if is_valid_handoff_direction(direction)
            else None,
        )
    return response


async def start_cloud_workspace_handoff(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    direction: str,
    requested_branch: str,
    requested_base_sha: str | None,
    exclude_paths: list[str],
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    workspace = await get_cloud_workspace_mobility_detail(
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    preflight = await preflight_cloud_workspace_handoff(
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        direction=direction,
        requested_branch=requested_branch,
        requested_base_sha=requested_base_sha,
    )
    if not preflight.can_start:
        raise CloudApiError(
            "mobility_preflight_failed",
            "; ".join(preflight.blockers),
            status_code=409,
        )
    source_owner = normalize_owner(workspace.owner)
    target_owner = target_owner_for_direction(direction)
    try:
        handoff = await create_cloud_workspace_handoff_op_for_user(
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
            user = await load_user_with_oauth_accounts_by_id(user_id)
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
                user,
                cloud_workspace.id,
                requested_base_sha=requested_base_sha,
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
                await fail_cloud_workspace_handoff_op_checkpoint_for_user(
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
        return await update_cloud_workspace_handoff_phase_checkpoint_for_user(
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
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
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
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
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
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
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


async def complete_cloud_workspace_handoff_cleanup(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    cleanup_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
    if cleanup_items:
        for item in cleanup_items:
            if item.status == "completed":
                continue
            if item.item_kind in SERVER_CLEANUP_ITEM_KINDS:
                await execute_server_cleanup_item(
                    db,
                    handoff_op_id=handoff_op_id,
                    cleanup_item_id=item.id,
                )
                continue
            cleanup_item = await get_cleanup_item_for_handoff(
                db,
                handoff_op_id=handoff_op_id,
                cleanup_item_id=item.id,
                lock=True,
            )
            if cleanup_item is not None:
                await update_cleanup_item_status(
                    db,
                    cleanup_item=cleanup_item,
                    status="completed",
                )
        cleanup_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
        if not all(item.status == "completed" for item in cleanup_items):
            raise CloudApiError(
                "cleanup_items_incomplete",
                "All cleanup items must complete before the handoff can be marked completed.",
                status_code=409,
            )
    try:
        return await complete_cloud_workspace_handoff_cleanup_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def list_cloud_workspace_handoff_cleanup_items(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    return await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)


async def start_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    return await update_cleanup_item_status(db, cleanup_item=item, status="in_progress")


async def complete_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    value = await update_cleanup_item_status(db, cleanup_item=item, status="completed")
    if await all_cleanup_items_completed(db, handoff_op_id=handoff_op_id):
        with suppress(CloudApiError, ValueError):
            await complete_cloud_workspace_handoff_cleanup(
                db,
                user_id=user_id,
                mobility_workspace_id=mobility_workspace_id,
                handoff_op_id=handoff_op_id,
            )
    return value


async def fail_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
    error_code: str,
    error_message: str,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    value = await update_cleanup_item_status(
        db,
        cleanup_item=item,
        status="failed",
        error_code=error_code,
        error_message=error_message,
        retry_delay_seconds=cleanup_retry_delay_seconds(item.attempt_count + 1),
    )
    if value.attempt_count >= max(1, settings.workspace_move_cleanup_max_attempts):
        await fail_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=HANDOFF_PHASE_CLEANUP_FAILED,
            lifecycle_state=LIFECYCLE_CLEANUP_FAILED,
            failure_code=error_code,
            failure_detail=error_message,
            status_detail=visible_failure_status_detail(error_message),
            last_error=visible_failure_last_error(error_message),
        )
    return value


async def repair_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    action: str,
    detail: str | None,
) -> CloudWorkspaceHandoffOpValue:
    if action not in {"resume_cleanup", "mark_complete"}:
        raise CloudApiError(
            "invalid_repair_action",
            "repair action must be 'resume_cleanup' or 'mark_complete'.",
            status_code=400,
        )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    if action == "mark_complete":
        if not await all_cleanup_items_completed(db, handoff_op_id=handoff_op_id):
            raise CloudApiError(
                "cleanup_items_incomplete",
                "Cleanup items must complete before a handoff can be marked complete.",
                status_code=409,
            )
        return await complete_cloud_workspace_handoff_cleanup_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    return await update_cloud_workspace_handoff_phase_for_user(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
        phase=HANDOFF_PHASE_CLEANUP_PENDING,
        status_detail="Awaiting source cleanup",
    )


async def fail_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    failure_code: str,
    failure_detail: str,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
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
        phase = (
            HANDOFF_PHASE_CLEANUP_FAILED
            if handoff is not None and handoff.canonical_side == CANONICAL_SIDE_DESTINATION
            else HANDOFF_PHASE_HANDOFF_FAILED
        )
        lifecycle_state = (
            "cleanup_failed"
            if phase == HANDOFF_PHASE_CLEANUP_FAILED
            else LIFECYCLE_HANDOFF_FAILED
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
