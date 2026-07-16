"""Local materialization intent/report/unlink orchestration.

These user-authenticated operations manage ``local_desktop`` rows in the
materialization ledger. Managed-Cloud rows are written by the workspace create
flow (dual-write) and the backfill; they are never created or unlinked here.

Concurrency: intent reuse, report, and unlink all lock the workspace's active
ledger rows (``.with_for_update()``) before mutating, so two concurrent intents
converge onto one active row/generation and a completion racing an unlink loses
via the generation check.

Fail-closed preflight: the managed-Cloud source is read through the typed
AnyHarness git-status adapter and the authorized GitHub branch head; neither
falls back to shell heuristics or branch-name inference. A blocked source
returns a typed ``CloudApiError`` and never creates a ready-looking association.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import cloud_workspace_materializations as materialization_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_workspace_materializations import (
    CloudWorkspaceMaterializationValue,
)
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import RemoteGitStatusSnapshot
from proliferate.integrations.anyharness.workspaces import get_runtime_git_status
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.repo_authority import (
    require_github_cloud_repo_authority,
)
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
)
from proliferate.server.cloud.repos.service import get_repo_branches_for_credentials
from proliferate.server.cloud.workspaces.materializations.summaries import (
    materialization_summary,
    operation_id_for,
)
from proliferate.server.cloud.workspaces.models import (
    CreateMaterializationIntentRequest,
    MaterializationIntentResponse,
    MaterializationIntentSource,
    RepoRef,
    ReportMaterializationRequest,
    WorkspaceMaterializationSummary,
)


async def _load_user_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspaceValue:
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db,
        user_id,
        workspace_id,
    )
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return workspace


async def _require_owned_install(
    db: AsyncSession,
    *,
    user_id: UUID,
    desktop_install_id: str,
) -> None:
    worker = await runtime_workers_store.get_active_desktop_worker_for_user(
        db,
        owner_user_id=user_id,
        desktop_install_id=desktop_install_id,
    )
    if worker is None:
        raise CloudApiError(
            "desktop_install_not_owned",
            "This desktop installation is not registered to your account.",
            status_code=403,
        )


def _repo_ref(workspace: CloudWorkspaceValue, repo_environment: RepoEnvironmentValue) -> RepoRef:
    return RepoRef(
        provider=repo_environment.git_provider,
        owner=repo_environment.git_owner,
        name=repo_environment.git_repo_name,
        branch=workspace.git_branch,
        base_branch=workspace.git_base_branch or repo_environment.default_branch or "main",
    )


def _require_clean_publishable_source(status: RemoteGitStatusSnapshot) -> str:
    """Validate the managed-Cloud source snapshot; return the current branch.

    Requires a normal (non-detached) case-sensitive branch, clean and
    conflict-free state, no in-progress Git operation, an upstream, and zero
    ahead/behind. Raises a typed ``materialization_source_blocked`` error
    otherwise.
    """

    def _blocked(detail: str) -> CloudApiError:
        return CloudApiError(
            "materialization_source_blocked",
            detail,
            status_code=409,
        )

    if status.detached or status.current_branch is None:
        raise _blocked("The cloud workspace is in a detached HEAD state.")
    if status.operation != "none":
        raise _blocked(f"The cloud workspace has a Git {status.operation} operation in progress.")
    if status.conflicted:
        raise _blocked("The cloud workspace has unresolved merge conflicts.")
    if not status.clean:
        raise _blocked("The cloud workspace has uncommitted changes.")
    if status.upstream_branch is None:
        raise _blocked("The cloud workspace branch has not been published upstream.")
    if status.ahead != 0 or status.behind != 0:
        raise _blocked("The cloud workspace branch is not in sync with its upstream.")
    return status.current_branch


async def _read_managed_cloud_source(
    db: AsyncSession,
    *,
    user_id: UUID,
    managed: CloudWorkspaceMaterializationValue,
) -> RemoteGitStatusSnapshot:
    if managed.anyharness_workspace_id is None:
        raise CloudApiError(
            "materialization_source_unavailable",
            "The managed cloud workspace has no runtime materialization yet.",
            status_code=409,
        )
    # Resolve the EXACT sandbox recorded on this managed row, never the caller's
    # current personal sandbox. After the recorded sandbox S1 is destroyed and
    # replaced by S2, falling back to S2 would let us query S2 with S1's
    # AnyHarness workspace id — a cross-sandbox read of the wrong worktree. A
    # missing/destroyed recorded sandbox is source-unavailable, full stop. See
    # PR4-TARGET-03.
    if managed.cloud_sandbox_id is None:
        raise CloudApiError(
            "materialization_source_unavailable",
            "The managed cloud sandbox is not available.",
            status_code=409,
        )
    sandbox = await cloud_sandbox_store.load_cloud_sandbox_by_id(db, managed.cloud_sandbox_id)
    if sandbox is None or sandbox.status == "destroyed":
        raise CloudApiError(
            "materialization_source_unavailable",
            "The managed cloud sandbox is not available.",
            status_code=409,
        )
    (
        runtime_url,
        runtime_token,
        _data_key,
    ) = await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
    try:
        return await get_runtime_git_status(
            runtime_url,
            runtime_token,
            anyharness_workspace_id=managed.anyharness_workspace_id,
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "materialization_source_unavailable",
            "Could not read the cloud workspace git status.",
            status_code=502,
        ) from exc


async def create_local_materialization_intent(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
    body: CreateMaterializationIntentRequest,
) -> MaterializationIntentResponse:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    desktop_install_id = body.desktop_install_id.strip()
    if not desktop_install_id:
        raise CloudApiError(
            "invalid_desktop_install",
            "A desktop installation id is required.",
            status_code=400,
        )
    await _require_owned_install(db, user_id=user_id, desktop_install_id=desktop_install_id)

    # A repo-less workspace (no repository identity — e.g. a #1245 scratch
    # workspace) cannot resolve a source repo/branch/HEAD, so a local
    # materialization intent has no meaning. Reject it cleanly rather than
    # dereferencing a null repo environment id. This branch's store never yields
    # a repo-less row today; the guard is correct once #1245 merges. See
    # PR4-BASE-02.
    if workspace.repo_environment_id is None:
        raise CloudApiError(
            "materialization_source_unavailable",
            "This workspace has no repository backing to materialize.",
            status_code=409,
        )
    repo_environment = await repositories_store.get_repo_environment_by_id(
        db,
        workspace.repo_environment_id,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Cloud repo environment not found.",
            status_code=404,
        )

    # Lock the workspace's active ledger rows so concurrent intents converge.
    active = await materialization_store.lock_active_materializations_for_workspace(
        db,
        cloud_workspace_id=workspace_id,
    )
    managed = next((m for m in active if m.target_kind == "managed_cloud"), None)
    if managed is None:
        raise CloudApiError(
            "materialization_source_unavailable",
            "The managed cloud workspace has no runtime materialization yet.",
            status_code=409,
        )

    status = await _read_managed_cloud_source(db, user_id=user_id, managed=managed)
    source_branch = _require_clean_publishable_source(status)

    # Publication proof: the observed HEAD must equal the authorized GitHub head
    # for the same branch. Fail-closed; no branch-name inference.
    authority = await require_github_cloud_repo_authority(
        db,
        user_id=user_id,
        git_owner=repo_environment.git_owner,
        git_repo_name=repo_environment.git_repo_name,
    )
    repo_branches = await get_repo_branches_for_credentials(
        CloudRepoGitHubCredentials(user_id=user_id, access_token=authority.access_token),
        git_owner=repo_environment.git_owner,
        git_repo_name=repo_environment.git_repo_name,
        missing_access_message=(
            "Connect the Proliferate GitHub App before materializing this workspace."
        ),
        repo_access_required_message=(
            "Reconnect the Proliferate GitHub App and grant repository access before "
            "materializing this workspace."
        ),
    )
    github_head = repo_branches.branch_heads_by_name.get(source_branch)
    if github_head is None:
        raise CloudApiError(
            "materialization_source_blocked",
            "The cloud workspace branch is not published on GitHub.",
            status_code=409,
        )
    if github_head != status.head_oid:
        raise CloudApiError(
            "materialization_source_blocked",
            "The cloud workspace branch has commits that are not published on GitHub.",
            status_code=409,
        )

    existing_local = next(
        (
            m
            for m in active
            if m.target_kind == "local_desktop" and m.desktop_install_id == desktop_install_id
        ),
        None,
    )
    if existing_local is not None:
        row = await materialization_store.refresh_local_desktop_intent(
            db,
            existing_local.id,
            expected_head_sha=status.head_oid,
            observed_branch=source_branch,
        )
    else:
        row = await materialization_store.create_local_desktop_intent(
            db,
            cloud_workspace_id=workspace_id,
            desktop_install_id=desktop_install_id,
            expected_head_sha=status.head_oid,
            observed_branch=source_branch,
        )
        if row is None:
            # Lost an active-uniqueness race with a concurrent intent; converge
            # onto the row that won by reusing it.
            existing = await materialization_store.get_active_local_materialization(
                db,
                cloud_workspace_id=workspace_id,
                desktop_install_id=desktop_install_id,
                lock_row=True,
            )
            if existing is None:
                raise CloudApiError(
                    "materialization_conflict",
                    "Could not create the local materialization intent.",
                    status_code=409,
                )
            row = await materialization_store.refresh_local_desktop_intent(
                db,
                existing.id,
                expected_head_sha=status.head_oid,
                observed_branch=source_branch,
            )
    if row is None:
        raise CloudApiError(
            "materialization_conflict",
            "Could not create the local materialization intent.",
            status_code=409,
        )

    return MaterializationIntentResponse(
        materialization=materialization_summary(
            row,
            requesting_desktop_install_id=desktop_install_id,
        ),
        operation_id=operation_id_for(row),
        source=MaterializationIntentSource(
            repository=_repo_ref(workspace, repo_environment),
            branch_name=source_branch,
            head_sha=status.head_oid,
        ),
    )


async def report_materialization(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
    materialization_id: UUID,
    body: ReportMaterializationRequest,
) -> WorkspaceMaterializationSummary:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    row = await materialization_store.load_materialization(
        db,
        materialization_id,
        lock_row=True,
    )
    if row is None or row.cloud_workspace_id != workspace.id:
        raise CloudApiError(
            "materialization_not_found",
            "Materialization not found.",
            status_code=404,
        )
    if row.target_kind != "local_desktop":
        raise CloudApiError(
            "materialization_not_reportable",
            "Only local materializations can be reported.",
            status_code=409,
        )
    if row.desktop_install_id is not None:
        await _require_owned_install(
            db,
            user_id=user_id,
            desktop_install_id=row.desktop_install_id,
        )

    # A stale generation (including one bumped by a concurrent unlink) is
    # rejected without mutating state.
    if body.generation != row.generation or row.unlinked_at is not None:
        raise CloudApiError(
            "stale_materialization_generation",
            "This materialization report is stale.",
            status_code=409,
        )

    observed_head_sha = (body.observed_head_sha or "").strip() or None
    observed_branch = (body.observed_branch or "").strip() or None
    if body.state == "hydrated":
        if observed_head_sha is None or observed_head_sha != row.expected_head_sha:
            raise CloudApiError(
                "materialization_sha_mismatch",
                "The reported HEAD does not match the expected source commit.",
                status_code=409,
            )
        if observed_branch is None or observed_branch != row.observed_branch:
            raise CloudApiError(
                "materialization_branch_mismatch",
                "The reported branch does not match the expected source branch.",
                status_code=409,
            )

    updated = await materialization_store.apply_report(
        db,
        materialization_id,
        state=body.state,
        anyharness_workspace_id=(body.anyharness_workspace_id or "").strip() or None,
        worktree_path=(body.worktree_path or "").strip() or None,
        observed_branch=observed_branch,
        observed_head_sha=observed_head_sha,
        failure_code=(body.failure_code or "").strip() or None,
        failure_detail=(body.failure_detail or "").strip() or None,
    )
    if updated is None:
        raise CloudApiError(
            "materialization_not_found",
            "Materialization not found.",
            status_code=404,
        )
    return materialization_summary(
        updated,
        requesting_desktop_install_id=updated.desktop_install_id,
    )


async def unlink_materialization(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
    materialization_id: UUID,
) -> None:
    workspace = await _load_user_workspace(db, user_id=user_id, workspace_id=workspace_id)
    row = await materialization_store.load_materialization(
        db,
        materialization_id,
        lock_row=True,
    )
    if row is None or row.cloud_workspace_id != workspace.id:
        raise CloudApiError(
            "materialization_not_found",
            "Materialization not found.",
            status_code=404,
        )
    if row.target_kind != "local_desktop":
        raise CloudApiError(
            "materialization_not_unlinkable",
            "Only local materializations can be unlinked.",
            status_code=409,
        )
    if row.unlinked_at is not None:
        # Already unlinked — idempotent success.
        return
    if row.desktop_install_id is not None:
        await _require_owned_install(
            db,
            user_id=user_id,
            desktop_install_id=row.desktop_install_id,
        )
    await materialization_store.unlink_materialization(db, materialization_id)
