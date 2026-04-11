from __future__ import annotations

from contextlib import suppress
from datetime import timedelta
from uuid import UUID

from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
    backfill_cloud_workspace_mobility_for_workspace,
    complete_cloud_workspace_handoff_cleanup_for_user,
    create_cloud_workspace_handoff_op_for_user,
    ensure_cloud_workspace_mobility_for_user,
    expire_stale_cloud_workspace_handoff_op_for_user,
    fail_cloud_workspace_handoff_op_for_user,
    finalize_cloud_workspace_handoff_op_for_user,
    heartbeat_cloud_workspace_handoff_op_for_user,
    load_active_user_handoff_op_for_user,
    load_cloud_workspace_mobility_for_user,
    update_cloud_workspace_handoff_phase_for_user,
)
from proliferate.db.store.cloud_mobility import (
    list_cloud_workspace_mobility_for_user as list_cloud_workspace_mobility_store,
)
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces_for_user as list_cloud_workspaces_store,
)
from proliferate.db.store.cloud_workspaces import (
    load_existing_cloud_workspace,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility.models import (
    WorkspaceMobilityPreflightResponse,
    mobility_workspace_detail_payload,
)
from proliferate.server.cloud.repos.service import get_repo_branches_for_user
from proliferate.server.cloud.workspaces.service import (
    ensure_cloud_workspace_for_existing_branch,
    start_cloud_workspace,
)
from proliferate.utils.time import utcnow

_VALID_HANDOFF_PHASES: frozenset[str] = frozenset(
    {
        "start_requested",
        "source_frozen",
        "destination_ready",
        "install_succeeded",
        "cleanup_pending",
        "cleanup_failed",
        "completed",
        "handoff_failed",
    }
)
_STALE_HANDOFF_AFTER = timedelta(seconds=120)


async def expire_stale_cloud_workspace_handoffs_for_user(*, user_id: UUID) -> None:
    stale_before = utcnow() - _STALE_HANDOFF_AFTER
    workspaces = await list_cloud_workspace_mobility_store(user_id=user_id)
    for workspace in workspaces:
        active_handoff = workspace.active_handoff
        if active_handoff is None or active_handoff.heartbeat_at >= stale_before:
            continue
        await expire_stale_cloud_workspace_handoff_op_for_user(
            user_id=user_id,
            mobility_workspace_id=workspace.id,
            handoff_op_id=active_handoff.id,
            failure_code=(
                "cleanup_stale"
                if active_handoff.finalized_at is not None
                and active_handoff.cleanup_completed_at is None
                else "handoff_stale"
            ),
            failure_detail=(
                "Workspace mobility cleanup heartbeat expired."
                if active_handoff.finalized_at is not None
                and active_handoff.cleanup_completed_at is None
                else "Workspace mobility heartbeat expired."
            ),
        )


async def list_cloud_workspace_mobility_for_user(
    user_id: UUID,
) -> list[CloudWorkspaceMobilityValue]:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    workspaces = await list_cloud_workspaces_store(user_id)
    for workspace in workspaces:
        await backfill_cloud_workspace_mobility_for_workspace(workspace=workspace)
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
    if owner_hint not in {"local", "cloud"}:
        raise CloudApiError(
            "invalid_owner_hint",
            "ownerHint must be either 'local' or 'cloud'.",
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
        display_name=resolved_display_name,
        cloud_workspace_id=cloud_workspace_id,
    )


async def get_cloud_workspace_mobility_detail(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    record = await load_cloud_workspace_mobility_for_user(
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


async def preflight_cloud_workspace_handoff(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    direction: str,
    requested_branch: str,
    requested_base_sha: str | None,
) -> WorkspaceMobilityPreflightResponse:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    workspace = await get_cloud_workspace_mobility_detail(
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    blockers: list[str] = []
    if direction not in {"local_to_cloud", "cloud_to_local"}:
        raise CloudApiError(
            "invalid_handoff_direction",
            "direction must be either 'local_to_cloud' or 'cloud_to_local'.",
            status_code=400,
        )
    if workspace.cloud_lost_at is not None:
        blockers.append("cloud workspace is in cloud_lost state")
    if workspace.active_handoff is not None:
        blockers.append("handoff already in progress for workspace")
    active_handoff = await load_active_user_handoff_op_for_user(user_id=user_id)
    if active_handoff is not None and active_handoff.mobility_workspace_id != workspace.id:
        blockers.append("another handoff is already in progress for this user")
    if direction == "local_to_cloud" and workspace.owner != "local":
        blockers.append("workspace is not currently local-owned")
    if direction == "cloud_to_local" and workspace.owner != "cloud":
        blockers.append("workspace is not currently cloud-owned")
    if direction == "local_to_cloud":
        user = await load_user_with_oauth_accounts_by_id(user_id)
        if user is None:
            raise CloudApiError("user_not_found", "User not found.", status_code=404)
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
            if error.code in {"github_link_required", "github_repo_access_required"}:
                blockers.append(error.message)
            else:
                raise
        else:
            if requested_branch.strip() not in repo_branches.branches:
                blockers.append(
                    f"The branch '{requested_branch.strip()}' was not found on GitHub."
                )

    repo_config = await load_cloud_repo_config_for_user(
        user_id=user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    excluded_paths = (
        [item.relative_path for item in repo_config.tracked_files]
        if repo_config is not None
        else []
    )
    if requested_branch.strip() != workspace.git_branch:
        blockers.append("requested branch does not match logical workspace branch")
    if requested_base_sha is not None and not requested_base_sha.strip():
        blockers.append("requested base sha must be non-empty when provided")

    return WorkspaceMobilityPreflightResponse(
        can_start=not blockers,
        blockers=blockers,
        excluded_paths=excluded_paths,
        workspace=mobility_workspace_detail_payload(workspace),
    )


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
    source_owner = workspace.owner
    target_owner = "cloud" if direction == "local_to_cloud" else "local"
    try:
        handoff = await create_cloud_workspace_handoff_op_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
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
                error.code
                if isinstance(error, CloudApiError)
                else "handoff_start_failed"
            )
            failure_detail = (
                error.message
                if isinstance(error, CloudApiError)
                else str(error) or "Workspace handoff start failed."
            )
            with suppress(ValueError):
                await fail_cloud_workspace_handoff_op_for_user(
                    user_id=user_id,
                    mobility_workspace_id=mobility_workspace_id,
                    handoff_op_id=handoff.id,
                    failure_code=failure_code,
                    failure_detail=failure_detail,
                )
            raise
        return await update_cloud_workspace_handoff_phase_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff.id,
            phase="start_requested",
            status_detail="Provisioning cloud workspace",
            cloud_workspace_id=cloud_workspace.id,
        )
    return handoff


async def heartbeat_cloud_workspace_handoff(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    try:
        return await heartbeat_cloud_workspace_handoff_op_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def update_cloud_workspace_handoff_phase(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    if phase not in _VALID_HANDOFF_PHASES:
        raise CloudApiError(
            "invalid_handoff_phase",
            f"Unsupported handoff phase '{phase}'.",
            status_code=400,
        )
    try:
        return await update_cloud_workspace_handoff_phase_for_user(
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
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    try:
        return await finalize_cloud_workspace_handoff_op_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            cloud_workspace_id=cloud_workspace_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def complete_cloud_workspace_handoff_cleanup(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    try:
        return await complete_cloud_workspace_handoff_cleanup_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error


async def fail_cloud_workspace_handoff(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    failure_code: str,
    failure_detail: str,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(user_id=user_id)
    try:
        return await fail_cloud_workspace_handoff_op_for_user(
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            failure_code=failure_code,
            failure_detail=failure_detail,
        )
    except ValueError as error:
        raise CloudApiError("handoff_not_found", str(error), status_code=404) from error
