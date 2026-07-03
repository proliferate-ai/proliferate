"""Workspace move saga: round-trip local<->cloud workspace handoff.

See specs/tbd/workspace-migration-v2.md section 2.3 for the two flows this
module drives and section 5.2 for the exact composition this was asked to
reuse. Sandbox-side repo materialization (the shared clone/fetch step) already
takes the per-sandbox ``redis_materialization_lock``
(``materialize_repo_environment`` -> ``run_cloud_sandbox_operation``,
``materialization/operation.py:24-40``) -- this module does not add a second,
outer lock around that call (that would deadlock, since the lock is not
reentrant) and, matching ``workspaces/service.py::create_cloud_workspace_for_user``,
does not add extra locking around plain AnyHarness HTTP calls either: those are
already serialized per-workspace by the runtime's own
``workspace_operation_gate``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Coroutine
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store import workspace_moves as workspace_move_store
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue
from proliferate.db.store.workspace_moves import IllegalPhaseTransition, WorkspaceMoveValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.mobility import (
    export_runtime_mobility_archive,
    install_runtime_mobility_archive,
    preflight_runtime_mobility,
    set_runtime_mobility_state,
)
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.integrations.anyharness.workspaces import (
    create_remote_worktree_workspace,
    destroy_runtime_mobility_source,
    resolve_runtime_workspace,
)
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.materialization import paths as materialization_paths
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.workspace_moves import transactions
from proliferate.server.cloud.workspace_moves.models import (
    ExportWorkspaceMoveResponse,
    FailWorkspaceMoveRequest,
    InstallWorkspaceMoveRequest,
    StartWorkspaceMoveRequest,
    WorkspaceMoveEndpointRef,
    WorkspaceMoveResponse,
    workspace_move_payload,
)

_SUPPORTED_DIRECTIONS = frozenset({("local", "cloud"), ("cloud", "local")})
_DESTINATION_BUILD_ATTEMPTS = 2
_WORKTREE_SEGMENT_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


class _UserWithId(Protocol):
    id: UUID


async def start_workspace_move(
    db: AsyncSession,
    user: _UserWithId,
    body: StartWorkspaceMoveRequest,
) -> WorkspaceMoveResponse:
    repo_config = await _require_repo_config(
        db, user_id=user.id, repo_config_id=body.repo_config_id
    )
    source_kind, destination_kind = body.source.kind, body.destination.kind
    _require_supported_direction(source_kind, destination_kind)

    branch = body.branch.strip()
    if not branch:
        raise CloudApiError("invalid_branch", "Branch is required.", status_code=400)
    base_commit_sha = body.base_commit_sha.strip()
    if not base_commit_sha:
        raise CloudApiError(
            "invalid_base_commit_sha", "Base commit sha is required.", status_code=400
        )
    idempotency_key = body.idempotency_key.strip()
    if not idempotency_key:
        raise CloudApiError(
            "invalid_idempotency_key", "idempotencyKey is required.", status_code=400
        )

    move = await workspace_move_store.get_move_by_idempotency_key(
        db, user_id=user.id, idempotency_key=idempotency_key
    )
    if move is None:
        move = await _reserve_new_move(
            db,
            user=user,
            repo_config=repo_config,
            branch=branch,
            base_commit_sha=base_commit_sha,
            idempotency_key=idempotency_key,
            source=body.source,
            destination=body.destination,
            source_kind=source_kind,
            destination_kind=destination_kind,
        )

    # Idempotency-key replay resumes the saga from whatever phase it reached
    # last time, rather than short-circuiting -- see the module docstring and
    # spec section 2.2 ("recovery is re-derivation").
    if move.phase == "started":
        if destination_kind == "cloud":
            move = await _advance_local_to_cloud_start(
                db, user=user, move=move, repo_config=repo_config
            )
        else:
            move = await _advance_cloud_to_local_start(db, user=user, move=move)

    return workspace_move_payload(move)


async def get_workspace_move_for_user(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
) -> WorkspaceMoveResponse:
    return workspace_move_payload(await _load_move_or_404(db, user_id=user.id, move_id=move_id))


async def export_workspace_move_archive(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
) -> ExportWorkspaceMoveResponse:
    move = await _load_move_or_404(db, user_id=user.id, move_id=move_id)
    if move.source_kind != "cloud":
        raise CloudApiError(
            "workspace_move_export_unsupported",
            "Export is only available when the move's source is a cloud workspace.",
            status_code=400,
        )
    if move.phase not in {"destination_ready", "installed"}:
        raise CloudApiError(
            "workspace_move_invalid_phase",
            f"Cannot export while the move is in phase '{move.phase}'.",
            status_code=409,
        )

    workspace = await _require_source_cloud_workspace(db, user=user, move=move)
    runtime_url, runtime_token = await _require_runtime_access(db, user=user)

    try:
        archive = await export_runtime_mobility_archive(
            runtime_url,
            runtime_token,
            anyharness_workspace_id=workspace.anyharness_workspace_id,  # type: ignore[arg-type]
            expected_handoff_op_id=str(move.id),
            expected_base_commit_sha=move.base_commit_sha,
            expected_branch_name=move.branch,
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError("workspace_move_export_failed", str(exc), status_code=502) from exc

    _guard_archive_size(archive)
    return ExportWorkspaceMoveResponse(move_id=str(move.id), archive=archive)


async def install_workspace_move_archive(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
    body: InstallWorkspaceMoveRequest,
) -> WorkspaceMoveResponse:
    move = await _load_move_or_404(db, user_id=user.id, move_id=move_id)
    if move.phase == "installed":
        return workspace_move_payload(move)
    if move.phase != "destination_ready":
        raise CloudApiError(
            "workspace_move_invalid_phase",
            f"Cannot install while the move is in phase '{move.phase}'.",
            status_code=409,
        )

    if move.destination_kind == "cloud":
        move = await _install_into_cloud_destination(db, user=user, move=move, body=body)
    else:
        # cloud->local: install runs entirely on Desktop's own local AnyHarness,
        # which the server cannot reach. This call is just the durable
        # "installed" acknowledgement that lets the row advance to cutover.
        move = await _advance_phase_or_404(
            db, user_id=user.id, move_id=move.id, to_phase="installed"
        )

    await transactions.commit_workspace_move_session(db)
    return workspace_move_payload(move)


async def cutover_workspace_move(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
) -> WorkspaceMoveResponse:
    move = await _load_move_or_404(db, user_id=user.id, move_id=move_id)
    if move.phase in {"cutover", "completed"}:
        return workspace_move_payload(move)

    updated = await _try_transition(
        workspace_move_store.commit_cutover(db, move.id, user_id=user.id)
    )
    if updated is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    await transactions.commit_workspace_move_session(db)
    return workspace_move_payload(updated)


async def complete_workspace_move(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
) -> WorkspaceMoveResponse:
    move = await _load_move_or_404(db, user_id=user.id, move_id=move_id)
    if move.phase == "completed":
        return workspace_move_payload(move)
    if move.phase != "cutover":
        raise CloudApiError(
            "workspace_move_invalid_phase",
            f"Cannot complete while the move is in phase '{move.phase}'.",
            status_code=409,
        )

    # Source-fate cleanup (spec section 2.1, principle 4: "one durable row, two
    # cleanup obligations"). local->cloud has nothing left to do server-side --
    # Desktop already destroyed its own local source before calling complete.
    if move.source_kind == "cloud":
        await _cleanup_cloud_source(db, user=user, move=move)

    updated = await _advance_phase_or_404(
        db, user_id=user.id, move_id=move.id, to_phase="completed"
    )
    await transactions.commit_workspace_move_session(db)
    return workspace_move_payload(updated)


async def fail_workspace_move(
    db: AsyncSession,
    user: _UserWithId,
    move_id: UUID,
    body: FailWorkspaceMoveRequest,
) -> WorkspaceMoveResponse:
    move = await _load_move_or_404(db, user_id=user.id, move_id=move_id)
    if move.phase == "failed":
        return workspace_move_payload(move)

    updated = await _try_transition(
        workspace_move_store.fail_move(
            db,
            move.id,
            user_id=user.id,
            failure_code=body.failure_code,
            failure_detail=body.failure_detail,
        )
    )
    if updated is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    await transactions.commit_workspace_move_session(db)
    return workspace_move_payload(updated)


# --- local->cloud: build the destination -----------------------------------


async def _advance_local_to_cloud_start(
    db: AsyncSession,
    *,
    user: _UserWithId,
    move: WorkspaceMoveValue,
    repo_config: RepoConfigValue,
) -> WorkspaceMoveValue:
    cloud_repo_environment = await _require_cloud_repo_environment(
        db, user_id=user.id, repo_config=repo_config
    )
    await materialization_service.materialize_repo_environment(
        db, repo_environment_id=cloud_repo_environment.id
    )
    runtime_url, runtime_token = await _require_runtime_access(db, user=user)

    workspace = await _resolve_destination_cloud_workspace(
        db, user=user, move=move, cloud_repo_environment=cloud_repo_environment
    )
    created = await _build_destination_worktree(
        db,
        runtime_url,
        runtime_token,
        cloud_repo_environment=cloud_repo_environment,
        branch=move.branch,
        base_commit_sha=move.base_commit_sha,
        workspace_id=workspace.id,
        setup_script=cloud_repo_environment.setup_script,
    )
    if workspace.anyharness_workspace_id != created.workspace_id:
        workspace = await cloud_workspace_store.update_workspace_anyharness_workspace_id(
            db, workspace=workspace, anyharness_workspace_id=created.workspace_id
        )

    destination_ref = {
        "cloudWorkspaceId": str(workspace.id),
        "anyharnessWorkspaceId": created.workspace_id,
        "repoRootId": created.repo_root_id,
    }
    updated = await workspace_move_store.advance_phase(
        db, move.id, user_id=user.id, to_phase="destination_ready", destination_ref=destination_ref
    )
    if updated is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    await transactions.commit_workspace_move_session(db)
    return updated


async def _resolve_destination_cloud_workspace(
    db: AsyncSession,
    *,
    user: _UserWithId,
    move: WorkspaceMoveValue,
    cloud_repo_environment: RepoEnvironmentValue,
) -> CloudWorkspaceValue:
    # _reserve_new_move's collision check ran a transaction (and a multi-second
    # materialize) ago, so an *unrelated* active workspace can surface here on
    # this branch. Re-confirm adoption is sanctioned before reusing it, else
    # fail with the same 409 rather than silently hijacking it (spec section 2,
    # "Collision").
    active = await cloud_workspace_store.get_active_cloud_workspace_for_branch(
        db,
        owner_user_id=user.id,
        repo_environment_id=cloud_repo_environment.id,
        branch=move.branch,
    )
    if active is not None:
        if not await _may_adopt_active_destination(db, move=move, active=active):
            raise CloudApiError(
                "cloud_workspace_exists",
                f"A cloud workspace already exists for branch '{move.branch}'.",
                status_code=409,
                extra_detail={"cloudWorkspaceId": str(active.id)},
            )
        return active

    workspace = await cloud_workspace_store.create_cloud_workspace(
        db,
        user_id=user.id,
        repo_environment_id=cloud_repo_environment.id,
        display_name=move.branch,
        git_branch=move.branch,
        git_base_branch=move.branch,
    )
    if workspace is None:
        raise CloudApiError(
            "cloud_workspace_exists",
            f"A cloud workspace already exists for branch '{move.branch}'.",
            status_code=409,
        )
    return workspace


async def _may_adopt_active_destination(
    db: AsyncSession, *, move: WorkspaceMoveValue, active: CloudWorkspaceValue
) -> bool:
    # (a) a prior attempt of *this same* move already recorded this workspace as
    # its destination, or (b) it is this identity's own prior completed
    # destination -- the sanctioned re-adopt case _reserve_new_move green-lit.
    if _ref_str(move.destination_ref, "cloudWorkspaceId") == str(active.id):
        return True
    return await workspace_move_store.is_own_prior_cloud_destination(
        db,
        user_id=move.user_id,
        repo_config_id=move.repo_config_id,
        branch=move.branch,
        cloud_workspace_id=active.id,
    )


async def _build_destination_worktree(
    db: AsyncSession,
    runtime_url: str,
    runtime_token: str,
    *,
    cloud_repo_environment: RepoEnvironmentValue,
    branch: str,
    base_commit_sha: str,
    workspace_id: UUID,
    setup_script: str,
) -> ResolvedRemoteWorkspace:
    target_path = _worktree_path(cloud_repo_environment, branch, workspace_id=workspace_id)
    last_error: CloudRuntimeReconnectError | None = None
    for attempt in range(_DESTINATION_BUILD_ATTEMPTS):
        try:
            repo_root = await resolve_runtime_workspace(
                runtime_url,
                runtime_token,
                runtime_workdir=materialization_paths.repo_path(cloud_repo_environment),
            )
            # base_branch takes any git revision, including a raw sha -- passing
            # base_commit_sha here pins the new worktree's HEAD to the exact
            # commit the move is pinned to (spec section 5.2: "the worktree ends
            # up checked out at baseCommitSha").
            return await create_remote_worktree_workspace(
                runtime_url,
                runtime_token,
                repo_root_id=repo_root.repo_root_id,
                target_path=target_path,
                new_branch_name=branch,
                base_branch=base_commit_sha,
                setup_script=setup_script or None,
                # The runtime's origin.entrypoint is a closed enum
                # (desktop|cloud|local_runtime|cowork); a cloud-destination
                # worktree materialized server-side is a "cloud" entrypoint. This
                # mirrors create_cloud_workspace_for_user's origin shape.
                origin={"kind": "human", "entrypoint": "cloud"},
            )
        except CloudRuntimeReconnectError as exc:
            last_error = exc
            if attempt + 1 >= _DESTINATION_BUILD_ATTEMPTS:
                break
            # The exact sha may not be reachable yet if the source pushed it
            # right before calling start -- refetch once and retry (spec
            # section 5.2: "verify; requeue/fetch if the sha is not yet
            # reachable").
            await materialization_service.materialize_repo_environment(
                db, repo_environment_id=cloud_repo_environment.id
            )

    raise CloudApiError(
        "workspace_move_destination_unreachable",
        str(last_error)
        if last_error is not None
        else "Failed to build the cloud destination worktree.",
        status_code=502,
    )


async def _install_into_cloud_destination(
    db: AsyncSession,
    *,
    user: _UserWithId,
    move: WorkspaceMoveValue,
    body: InstallWorkspaceMoveRequest,
) -> WorkspaceMoveValue:
    if body.archive is None:
        raise CloudApiError(
            "workspace_move_archive_required",
            "An archive is required to install into a cloud destination.",
            status_code=400,
        )
    _guard_archive_size(body.archive)

    anyharness_workspace_id = _ref_str(move.destination_ref, "anyharnessWorkspaceId")
    if anyharness_workspace_id is None:
        raise CloudApiError(
            "invalid_move_destination",
            "Move destination is missing its AnyHarness workspace id.",
            status_code=400,
        )
    runtime_url, runtime_token = await _require_runtime_access(db, user=user)

    try:
        result = await install_runtime_mobility_archive(
            runtime_url,
            runtime_token,
            anyharness_workspace_id=anyharness_workspace_id,
            archive=body.archive,
            operation_id=str(move.id),
            install_mode="preserve_native_sessions",
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError("workspace_move_install_failed", str(exc), status_code=502) from exc

    if result.base_commit_sha != move.base_commit_sha:
        raise CloudApiError(
            "workspace_move_base_commit_mismatch",
            "The installed workspace HEAD does not match the move's pinned commit.",
            status_code=409,
            extra_detail={
                "installedBaseCommitSha": result.base_commit_sha,
                "expectedBaseCommitSha": move.base_commit_sha,
            },
        )

    return await _advance_phase_or_404(db, user_id=user.id, move_id=move.id, to_phase="installed")


# --- cloud->local: freeze + export the source -------------------------------


async def _advance_cloud_to_local_start(
    db: AsyncSession,
    *,
    user: _UserWithId,
    move: WorkspaceMoveValue,
) -> WorkspaceMoveValue:
    workspace = await _require_source_cloud_workspace(db, user=user, move=move)
    runtime_url, runtime_token = await _require_runtime_access(db, user=user)

    try:
        preflight = await preflight_runtime_mobility(
            runtime_url,
            runtime_token,
            anyharness_workspace_id=workspace.anyharness_workspace_id,  # type: ignore[arg-type]
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "workspace_move_source_unreachable", str(exc), status_code=502
        ) from exc
    if preflight.base_commit_sha is not None and preflight.base_commit_sha != move.base_commit_sha:
        raise CloudApiError(
            "workspace_move_base_commit_mismatch",
            "The cloud workspace HEAD does not match the pushed commit yet.",
            status_code=409,
            extra_detail={
                "runtimeBaseCommitSha": preflight.base_commit_sha,
                "expectedBaseCommitSha": move.base_commit_sha,
            },
        )

    try:
        await set_runtime_mobility_state(
            runtime_url,
            runtime_token,
            anyharness_workspace_id=workspace.anyharness_workspace_id,  # type: ignore[arg-type]
            mode="frozen_for_handoff",
            handoff_op_id=str(move.id),
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError("workspace_move_freeze_failed", str(exc), status_code=502) from exc

    updated = await workspace_move_store.advance_phase(
        db, move.id, user_id=user.id, to_phase="destination_ready"
    )
    if updated is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    await transactions.commit_workspace_move_session(db)
    return updated


async def _cleanup_cloud_source(
    db: AsyncSession, *, user: _UserWithId, move: WorkspaceMoveValue
) -> None:
    cloud_workspace_id = _ref_str(move.source_ref, "cloudWorkspaceId")
    if cloud_workspace_id is None:
        return
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db, user.id, UUID(cloud_workspace_id)
    )
    if workspace is None:
        return

    if workspace.anyharness_workspace_id:
        sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user.id)
        if sandbox is not None:
            (
                runtime_url,
                runtime_token,
                _data_key,
            ) = await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
            try:
                await set_runtime_mobility_state(
                    runtime_url,
                    runtime_token,
                    anyharness_workspace_id=workspace.anyharness_workspace_id,
                    mode="remote_owned",
                )
                await destroy_runtime_mobility_source(
                    runtime_url,
                    runtime_token,
                    anyharness_workspace_id=workspace.anyharness_workspace_id,
                )
            except CloudRuntimeReconnectError as exc:
                # Retry-only per spec section 2.1 -- leave the move at phase
                # "cutover" (canonical_side already flipped, so this cannot fail
                # back to the source) and let a repeat /complete call retry.
                raise CloudApiError(
                    "workspace_move_cleanup_failed", str(exc), status_code=502
                ) from exc

    if workspace.archived_at is None:
        await cloud_workspace_store.archive_cloud_workspace(db, workspace)


# --- shared helpers ----------------------------------------------------------


def _require_supported_direction(source_kind: str, destination_kind: str) -> None:
    if (source_kind, destination_kind) not in _SUPPORTED_DIRECTIONS:
        raise CloudApiError(
            "unsupported_move_direction",
            f"Moves from '{source_kind}' to '{destination_kind}' are not supported yet.",
            status_code=400,
        )


async def _require_repo_config(
    db: AsyncSession, *, user_id: UUID, repo_config_id: UUID
) -> RepoConfigValue:
    repo_config = await repositories_store.get_repo_config_by_id(
        db, user_id=user_id, repo_config_id=repo_config_id
    )
    if repo_config is None:
        raise CloudApiError(
            "repo_config_not_found", "Repository configuration not found.", status_code=404
        )
    return repo_config


async def _require_cloud_repo_environment(
    db: AsyncSession, *, user_id: UUID, repo_config: RepoConfigValue
) -> RepoEnvironmentValue:
    environment = await repositories_store.get_cloud_repo_environment(
        db,
        user_id=user_id,
        git_owner=repo_config.git_owner,
        git_repo_name=repo_config.git_repo_name,
    )
    if environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Configure this repository as a cloud environment before moving a workspace "
            "to the cloud.",
            status_code=404,
        )
    return environment


async def _require_runtime_access(db: AsyncSession, *, user: _UserWithId) -> tuple[str, str]:
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user.id)
    if sandbox is None:
        raise CloudApiError(
            "cloud_sandbox_missing", "Cloud sandbox has not been created.", status_code=409
        )
    (
        runtime_url,
        runtime_token,
        _data_key,
    ) = await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
    return runtime_url, runtime_token


async def _require_source_cloud_workspace(
    db: AsyncSession, *, user: _UserWithId, move: WorkspaceMoveValue
) -> CloudWorkspaceValue:
    cloud_workspace_id = _ref_str(move.source_ref, "cloudWorkspaceId")
    if cloud_workspace_id is None:
        raise CloudApiError(
            "invalid_move_source",
            "Move source is missing its cloud workspace id.",
            status_code=400,
        )
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db, user.id, UUID(cloud_workspace_id)
    )
    if workspace is None or workspace.anyharness_workspace_id is None:
        raise CloudApiError(
            "cloud_workspace_not_found", "Source cloud workspace not found.", status_code=404
        )
    return workspace


async def _reserve_new_move(
    db: AsyncSession,
    *,
    user: _UserWithId,
    repo_config: RepoConfigValue,
    branch: str,
    base_commit_sha: str,
    idempotency_key: str,
    source: WorkspaceMoveEndpointRef,
    destination: WorkspaceMoveEndpointRef,
    source_kind: str,
    destination_kind: str,
) -> WorkspaceMoveValue:
    if destination_kind == "cloud":
        cloud_repo_environment = await _require_cloud_repo_environment(
            db, user_id=user.id, repo_config=repo_config
        )
        active = await cloud_workspace_store.get_active_cloud_workspace_for_branch(
            db, owner_user_id=user.id, repo_environment_id=cloud_repo_environment.id, branch=branch
        )
        if active is not None:
            is_own_prior_home = await workspace_move_store.is_own_prior_cloud_destination(
                db,
                user_id=user.id,
                repo_config_id=repo_config.id,
                branch=branch,
                cloud_workspace_id=active.id,
            )
            if not is_own_prior_home:
                raise CloudApiError(
                    "cloud_workspace_exists",
                    f"A cloud workspace already exists for branch '{branch}'.",
                    status_code=409,
                    extra_detail={"cloudWorkspaceId": str(active.id)},
                )

    move = await workspace_move_store.create_move(
        db,
        user_id=user.id,
        repo_config_id=repo_config.id,
        branch=branch,
        source_kind=source_kind,
        destination_kind=destination_kind,
        source_ref=_ref_to_dict(source),
        destination_ref=_ref_to_dict(destination),
        base_commit_sha=base_commit_sha,
        idempotency_key=idempotency_key,
    )
    if move is None:
        raise CloudApiError(
            "workspace_move_in_progress",
            f"A move is already in progress for branch '{branch}'.",
            status_code=409,
        )
    await transactions.commit_workspace_move_session(db)
    return move


async def _advance_phase_or_404(
    db: AsyncSession, *, user_id: UUID, move_id: UUID, to_phase: str
) -> WorkspaceMoveValue:
    updated = await _try_transition(
        workspace_move_store.advance_phase(db, move_id, user_id=user_id, to_phase=to_phase)
    )
    if updated is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    return updated


async def _load_move_or_404(
    db: AsyncSession, *, user_id: UUID, move_id: UUID
) -> WorkspaceMoveValue:
    move = await workspace_move_store.get_move(db, move_id, user_id=user_id)
    if move is None:
        raise CloudApiError(
            "workspace_move_not_found", "Workspace move not found.", status_code=404
        )
    return move


async def _try_transition(
    coro: Coroutine[object, object, WorkspaceMoveValue | None],
) -> WorkspaceMoveValue | None:
    try:
        return await coro
    except IllegalPhaseTransition as exc:
        raise CloudApiError(
            "workspace_move_invalid_phase",
            f"Cannot move from phase '{exc.from_phase}' to '{exc.to_phase}'.",
            status_code=409,
        ) from exc


def _ref_to_dict(ref: WorkspaceMoveEndpointRef) -> dict[str, object]:
    payload: dict[str, object] = {}
    if ref.desktop_install_id:
        payload["desktopInstallId"] = ref.desktop_install_id
    if ref.cloud_workspace_id:
        payload["cloudWorkspaceId"] = str(ref.cloud_workspace_id)
    if ref.target_id:
        payload["targetId"] = ref.target_id
    if ref.anyharness_workspace_id:
        payload["anyharnessWorkspaceId"] = ref.anyharness_workspace_id
    return payload


def _ref_str(ref: dict[str, object], key: str) -> str | None:
    value = ref.get(key) if isinstance(ref, dict) else None
    return value if isinstance(value, str) and value else None


def _guard_archive_size(archive: dict[str, object]) -> None:
    encoded_size = len(json.dumps(archive).encode("utf-8"))
    if encoded_size > settings.workspace_move_max_archive_bytes:
        raise CloudApiError(
            "workspace_move_archive_too_large",
            f"Archive exceeds the {settings.workspace_move_max_archive_bytes} byte limit.",
            status_code=413,
        )


def _worktree_path(
    repo_environment: RepoEnvironmentValue, branch_name: str, *, workspace_id: UUID
) -> str:
    return (
        f"{materialization_paths.SANDBOX_WORKSPACE_ROOT}/worktrees/"
        f"{repo_environment.git_owner}/{repo_environment.git_repo_name}/"
        f"{_branch_path_segment(branch_name)}-{str(workspace_id)[:8]}"
    )


def _branch_path_segment(branch_name: str) -> str:
    cleaned = branch_name.strip().replace("/", "-")
    cleaned = _WORKTREE_SEGMENT_PATTERN.sub("-", cleaned).strip(".-")
    return cleaned[:96] or "workspace"
