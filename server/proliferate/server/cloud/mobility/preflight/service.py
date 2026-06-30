from __future__ import annotations

import re
import time
from contextlib import suppress
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_mobility.events import (
    record_cloud_workspace_mobility_event_for_user,
)
from proliferate.db.store.cloud_mobility.handoffs import load_active_user_handoff_op_for_user
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.mobility.domain.lifecycle import (
    FINAL_HANDOFF_PHASES,
    is_valid_handoff_direction,
    owner_direction_blocker,
    target_owner_for_direction,
)
from proliferate.server.cloud.mobility.models import mobility_workspace_detail_payload
from proliferate.server.cloud.mobility.preflight.models import (
    WorkspaceMobilityPreflightBlocker,
    WorkspaceMobilityPreflightResponse,
)
from proliferate.server.cloud.mobility.service import (
    expire_stale_cloud_workspace_handoffs_for_user,
    get_cloud_workspace_mobility_detail,
)
from proliferate.server.cloud.repos.service import get_repo_branches_for_user
from proliferate.utils.time import duration_ms

_BRANCH_NOT_PUBLISHED_BLOCKER = "The branch '{branch}' was not found on GitHub."
_BRANCH_HEAD_MISMATCH_BLOCKER = "The branch '{branch}' on GitHub is not at the requested commit."
_FULL_SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")


def _mobility_blocker(
    code: str,
    message: str,
    *,
    source: str = "cloud",
    retry_action: str | None = None,
    details: dict[str, str] | None = None,
) -> WorkspaceMobilityPreflightBlocker:
    return WorkspaceMobilityPreflightBlocker(
        code=code,
        message=message,
        source=source,
        retry_action=retry_action,
        details=details,
    )


async def preflight_cloud_workspace_handoff(
    db: AsyncSession,
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
    requested_base_sha_is_full = bool(
        normalized_requested_base_sha
        and _FULL_SHA_RE.fullmatch(normalized_requested_base_sha) is not None
    )
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    detail_started = time.perf_counter()
    workspace = await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    detail_elapsed_ms = duration_ms(detail_started)
    blockers: list[WorkspaceMobilityPreflightBlocker] = []
    if not is_valid_handoff_direction(direction):
        raise CloudApiError(
            "invalid_handoff_direction",
            "direction must be a supported workspace move direction.",
            status_code=400,
        )
    if workspace.cloud_lost_at is not None:
        blockers.append(
            _mobility_blocker(
                "cloud_lost",
                "Cloud workspace is in cloud_lost state.",
                retry_action="retry_prepare",
            )
        )
    if workspace.active_handoff is not None:
        blockers.append(
            _mobility_blocker(
                "workspace_handoff_in_progress",
                "Handoff already in progress for workspace.",
            )
        )
    active_handoff = await load_active_user_handoff_op_for_user(
        db, user_id=user_id, final_handoff_phases=FINAL_HANDOFF_PHASES
    )
    if active_handoff is not None and active_handoff.mobility_workspace_id != workspace.id:
        blockers.append(
            _mobility_blocker(
                "user_handoff_in_progress",
                "Another handoff is already in progress for this user.",
            )
        )
    owner_blocker = owner_direction_blocker(owner=workspace.owner, direction=direction)
    if owner_blocker is not None:
        blockers.append(_mobility_blocker("owner_mismatch", owner_blocker))
    if not normalized_requested_base_sha:
        blockers.append(
            _mobility_blocker(
                "missing_base_commit_sha",
                "requestedBaseSha is required for workspace moves.",
            )
        )
    elif not requested_base_sha_is_full:
        blockers.append(
            _mobility_blocker(
                "invalid_base_commit_sha",
                "requestedBaseSha must be a full 40-character commit SHA.",
            )
        )
    if is_valid_handoff_direction(direction):
        user = await load_user_with_oauth_accounts_by_id(db, user_id)
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
                blockers.append(
                    _mobility_blocker(
                        error.code,
                        error.message,
                        retry_action=(
                            "connect_github"
                            if error.code == "github_link_required"
                            else "manage_github_access"
                        ),
                    )
                )
            else:
                raise
        else:
            branch_lookup_elapsed_ms = duration_ms(branch_lookup_started)
            if normalized_requested_branch not in repo_branches.branches:
                blockers.append(
                    _mobility_blocker(
                        "branch_not_published",
                        _BRANCH_NOT_PUBLISHED_BLOCKER.format(branch=normalized_requested_branch),
                        retry_action="push_branch",
                        details={"branch": normalized_requested_branch},
                    )
                )
            elif (
                requested_base_sha_is_full
                and repo_branches.branch_heads_by_name.get(normalized_requested_branch)
                != normalized_requested_base_sha
            ):
                blockers.append(
                    _mobility_blocker(
                        "head_commit_not_published",
                        _BRANCH_HEAD_MISMATCH_BLOCKER.format(branch=normalized_requested_branch),
                        retry_action="push_branch",
                        details={
                            "branch": normalized_requested_branch,
                            "requestedBaseSha": normalized_requested_base_sha,
                            "githubHeadSha": repo_branches.branch_heads_by_name.get(
                                normalized_requested_branch,
                                "",
                            ),
                        },
                    )
                )

    repo_config_started = time.perf_counter()
    repo_config_elapsed_ms = duration_ms(repo_config_started)
    excluded_paths: list[str] = []
    if normalized_requested_branch != workspace.git_branch:
        blockers.append(
            _mobility_blocker(
                "branch_mismatch",
                "requested branch does not match logical workspace branch",
                details={
                    "requestedBranch": normalized_requested_branch,
                    "workspaceBranch": workspace.git_branch,
                },
            )
        )

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
            db,
            user_id=user_id,
            cloud_workspace_id=workspace.cloud_workspace_id,
            handoff_op_id=workspace.active_handoff.id if workspace.active_handoff else None,
            event_type="preflight_completed",
            direction=direction,
            source_owner=workspace.owner,
            target_owner=(
                target_owner_for_direction(direction)
                if is_valid_handoff_direction(direction)
                else None
            ),
        )
    return response
