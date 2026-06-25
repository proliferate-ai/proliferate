"""Managed cloud sandbox orchestration."""

from __future__ import annotations

import asyncio
import math
import re
import secrets
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import PurePosixPath
from typing import Any, Literal, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import (
    get_ready_github_grant_for_user,
    read_ready_github_grant_for_user,
)
from proliferate.config import settings
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_repo_config import get_cloud_repo_config
from proliferate.db.store.cloud_workspace_runtime import (
    attach_anyharness_workspace_id,
    attach_anyharness_workspace_id_to_managed_repo_workspaces,
)
from proliferate.db.store.managed_sandboxes import (
    ManagedSandboxValue,
    acquire_managed_sandbox_owner_lock,
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_destroyed,
    mark_managed_sandbox_ready,
    record_managed_sandbox_provider_sandbox,
    update_managed_sandbox_status,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.integrations.anyharness import create_remote_worktree_workspace
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.managed_sandboxes.transactions import (
    commit_managed_sandbox_session,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
    build_supervised_runtime_stop_command,
)
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.provisioning.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_interact_with_db,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

_IN_FLIGHT_STATUSES = {"creating", "starting", "destroying"}
_STARTING_LEASE_SECONDS = 10 * 60
_PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS = 30
_WAIT_ATTEMPTS = 120
_WAIT_DELAY_SECONDS = 1.0
_SAFE_PATH_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


class _UserWithId(Protocol):
    id: UUID


class _ManagedWorkspaceRow(Protocol):
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    sandbox_profile_id: UUID | None
    target_id: UUID | None
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    origin: str
    status: str
    anyharness_workspace_id: str | None
    worktree_path: str | None


@dataclass(frozen=True)
class _SandboxStartClaim:
    sandbox: ManagedSandboxValue
    action: Literal["start", "reuse", "wait"]


@dataclass(frozen=True)
class ManagedSandboxRepoRuntimeConnection:
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    runtime_generation: int


@dataclass(frozen=True)
class ManagedSandboxWorkspaceRuntimeConnection:
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    runtime_generation: int


@dataclass(frozen=True)
class _RepoRuntimeConnectionCacheKey:
    user_id: UUID
    git_owner: str
    git_repo_name: str


@dataclass(frozen=True)
class _CachedRepoRuntimeConnection:
    connection: ManagedSandboxRepoRuntimeConnection
    expires_at_monotonic: float


_REPO_RUNTIME_CONNECTION_CACHE_TTL_SECONDS = 60.0
_repo_runtime_connection_cache: dict[
    _RepoRuntimeConnectionCacheKey,
    _CachedRepoRuntimeConnection,
] = {}
_repo_runtime_connection_locks: dict[_RepoRuntimeConnectionCacheKey, asyncio.Lock] = {}
_workspace_runtime_connection_locks: dict[UUID, asyncio.Lock] = {}


def _repo_runtime_connection_cache_key(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> _RepoRuntimeConnectionCacheKey:
    return _RepoRuntimeConnectionCacheKey(
        user_id=user_id,
        git_owner=git_owner.lower(),
        git_repo_name=git_repo_name.lower(),
    )


def _cached_repo_runtime_connection(
    key: _RepoRuntimeConnectionCacheKey,
) -> ManagedSandboxRepoRuntimeConnection | None:
    cached = _repo_runtime_connection_cache.get(key)
    if cached is None:
        return None
    if cached.expires_at_monotonic <= time.monotonic():
        _repo_runtime_connection_cache.pop(key, None)
        return None
    return cached.connection


def _repo_runtime_connection_lock(key: _RepoRuntimeConnectionCacheKey) -> asyncio.Lock:
    lock = _repo_runtime_connection_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _repo_runtime_connection_locks[key] = lock
    return lock


def _remember_repo_runtime_connection(
    key: _RepoRuntimeConnectionCacheKey,
    connection: ManagedSandboxRepoRuntimeConnection,
) -> ManagedSandboxRepoRuntimeConnection:
    _repo_runtime_connection_cache[key] = _CachedRepoRuntimeConnection(
        connection=connection,
        expires_at_monotonic=time.monotonic() + _REPO_RUNTIME_CONNECTION_CACHE_TTL_SECONDS,
    )
    return connection


def _reset_managed_sandbox_repo_runtime_connection_cache_for_tests() -> None:
    _repo_runtime_connection_cache.clear()
    _repo_runtime_connection_locks.clear()
    _workspace_runtime_connection_locks.clear()


def _workspace_runtime_connection_lock(workspace_id: UUID) -> asyncio.Lock:
    lock = _workspace_runtime_connection_locks.get(workspace_id)
    if lock is None:
        lock = asyncio.Lock()
        _workspace_runtime_connection_locks[workspace_id] = lock
    return lock


def _safe_path_segment(value: str) -> str:
    normalized = _SAFE_PATH_CHARS.sub("-", value.strip()).strip("-._")
    return normalized or "workspace"


def _managed_cloud_worktree_path(workspace: _ManagedWorkspaceRow) -> str:
    owner = _safe_path_segment(workspace.git_owner)
    repo = _safe_path_segment(workspace.git_repo_name)
    branch = _safe_path_segment(workspace.git_branch)
    return str(
        PurePosixPath("/home/user/workspace/worktrees")
        / owner
        / repo
        / f"{branch}-{str(workspace.id)[:8]}"
    )


def _workspace_origin_context(workspace: _ManagedWorkspaceRow) -> dict[str, str]:
    entrypoint_by_origin = {
        "manual_desktop": "desktop",
        "manual_web": "web",
        "manual_mobile": "mobile",
    }
    return {
        "kind": "human",
        "entrypoint": entrypoint_by_origin.get(workspace.origin, "cloud"),
    }


def _template_ref() -> str:
    value = settings.e2b_template_name.strip()
    if not value:
        raise CloudApiError(
            "e2b_template_required",
            "E2B_TEMPLATE_NAME is required before creating a managed cloud sandbox.",
            status_code=500,
        )
    return value


def _runtime_access_ready(sandbox: ManagedSandboxValue) -> bool:
    return bool(
        sandbox.e2b_sandbox_id
        and sandbox.anyharness_base_url
        and sandbox.anyharness_bearer_token_ciphertext
        and sandbox.anyharness_data_key_ciphertext
    )


def _in_flight_status_is_fresh(sandbox: ManagedSandboxValue) -> bool:
    if sandbox.status not in _IN_FLIGHT_STATUSES:
        return False
    return utcnow() - sandbox.updated_at < timedelta(seconds=_STARTING_LEASE_SECONDS)


def _is_temporary_provider_unavailable_message(message: str | None) -> bool:
    if not message:
        return False
    normalized = message.lower()
    return "no healthy upstream" in normalized or "service unavailable" in normalized


def _is_temporary_provider_unavailable(exc: BaseException) -> bool:
    return _is_temporary_provider_unavailable_message(format_exception_message(exc))


def _provider_unavailable_retry_after_seconds(sandbox: ManagedSandboxValue | None = None) -> int:
    if sandbox is None:
        return _PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS
    elapsed = (utcnow() - sandbox.updated_at).total_seconds()
    return max(1, math.ceil(_PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS - elapsed))


def _provider_unavailable_cooldown_seconds(sandbox: ManagedSandboxValue) -> int | None:
    if sandbox.status != "error":
        return None
    if not _is_temporary_provider_unavailable_message(sandbox.last_error):
        return None
    remaining = _PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS - (
        utcnow() - sandbox.updated_at
    ).total_seconds()
    if remaining <= 0:
        return None
    return max(1, math.ceil(remaining))


def _provider_unavailable_error(retry_after_seconds: int) -> CloudApiError:
    return CloudApiError(
        "managed_sandbox_provider_unavailable",
        "The sandbox provider is temporarily unavailable. Retrying shortly.",
        status_code=503,
        extra_detail={"retryAfterSeconds": retry_after_seconds},
        headers={"Retry-After": str(retry_after_seconds)},
    )


async def _claim_managed_sandbox_start(
    db: AsyncSession,
    *,
    user: _UserWithId,
    billing_subject_id: UUID,
    template_ref: str,
    allow_reuse: bool = True,
) -> _SandboxStartClaim:
    await acquire_managed_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    existing = await load_personal_managed_sandbox(db, user.id, lock_row=True)
    if existing is None:
        created = await ensure_personal_managed_sandbox(
            db,
            user_id=user.id,
            created_by_user_id=user.id,
            billing_subject_id=billing_subject_id,
            e2b_template_ref=template_ref,
        )
        claimed = await update_managed_sandbox_status(
            db,
            created.id,
            status="starting",
            last_error=None,
        )
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=claimed or created, action="start")

    retry_after = _provider_unavailable_cooldown_seconds(existing)
    if retry_after is not None:
        raise _provider_unavailable_error(retry_after)

    if _in_flight_status_is_fresh(existing):
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=existing, action="wait")

    if (
        allow_reuse
        and existing.status == "ready"
        and existing.e2b_template_ref == template_ref
        and _runtime_access_ready(existing)
    ):
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=existing, action="reuse")

    claimed = await update_managed_sandbox_status(
        db,
        existing.id,
        status="starting",
        last_error=None,
    )
    await commit_managed_sandbox_session(db)
    return _SandboxStartClaim(sandbox=claimed or existing, action="start")


async def _wait_for_in_flight_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    for _ in range(_WAIT_ATTEMPTS):
        await asyncio.sleep(_WAIT_DELAY_SECONDS)
        current = await load_personal_managed_sandbox(db, user.id)
        if current is None:
            return None
        if current.status == "ready" and _runtime_access_ready(current):
            return current
        if current.status == "error":
            return None
        if current.status in _IN_FLIGHT_STATUSES and _in_flight_status_is_fresh(current):
            continue
        return None
    return None


async def get_managed_sandbox_detail(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    return await load_personal_managed_sandbox(db, user.id)


async def ensure_managed_sandbox_ready(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue:
    provider = get_configured_sandbox_provider()
    template_ref = _template_ref()
    billing_subject = await ensure_personal_billing_subject(db, user.id)
    last_claim: _SandboxStartClaim | None = None

    for _ in range(2):
        claim = await _claim_managed_sandbox_start(
            db,
            user=user,
            billing_subject_id=billing_subject.id,
            template_ref=template_ref,
        )
        last_claim = claim
        if claim.action == "wait":
            waited = await _wait_for_in_flight_sandbox(db, user)
            if waited is not None:
                ready = await _reuse_ready_runtime_if_possible(
                    db,
                    provider,
                    waited,
                    template_ref=template_ref,
                )
                if ready is not None:
                    await _best_effort_reconcile_repos(
                        db,
                        user_id=ready.owner_user_id,
                        sandbox=ready,
                    )
                    return ready
                claim = await _claim_managed_sandbox_start(
                    db,
                    user=user,
                    billing_subject_id=billing_subject.id,
                    template_ref=template_ref,
                    allow_reuse=False,
                )
                if claim.action != "start":
                    continue
            else:
                continue

        if claim.action == "reuse":
            ready = await _reuse_ready_runtime_if_possible(
                db,
                provider,
                claim.sandbox,
                template_ref=template_ref,
            )
            if ready is not None:
                await _best_effort_reconcile_repos(db, user_id=ready.owner_user_id, sandbox=ready)
                return ready
            claim = await _claim_managed_sandbox_start(
                db,
                user=user,
                billing_subject_id=billing_subject.id,
                template_ref=template_ref,
                allow_reuse=False,
            )
            if claim.action != "start":
                continue

        try:
            return await _create_or_launch_runtime(
                db,
                provider,
                claim.sandbox,
                template_ref=template_ref,
            )
        except Exception as exc:
            message = format_exception_message(exc)
            retry_after_seconds = (
                _provider_unavailable_retry_after_seconds()
                if _is_temporary_provider_unavailable(exc)
                else None
            )
            await update_managed_sandbox_status(
                db,
                claim.sandbox.id,
                status="error",
                last_error=message,
            )
            await commit_managed_sandbox_session(db)
            if retry_after_seconds is not None:
                raise _provider_unavailable_error(retry_after_seconds) from exc
            if isinstance(exc, CloudApiError):
                raise
            raise CloudApiError(
                "managed_sandbox_start_failed",
                message or "Managed cloud sandbox failed to start.",
                status_code=502,
            ) from exc

    if last_claim is not None and last_claim.action == "wait":
        raise CloudApiError(
            "managed_sandbox_start_in_progress",
            "Managed cloud sandbox is still starting. Try again shortly.",
            status_code=409,
        )
    raise CloudApiError(
        "managed_sandbox_start_failed",
        "Managed cloud sandbox failed to reach a usable runtime.",
        status_code=502,
    )


async def wake_managed_sandbox(db: AsyncSession, user: _UserWithId) -> ManagedSandboxValue:
    return await ensure_managed_sandbox_ready(db, user)


async def destroy_managed_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    await acquire_managed_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    sandbox = await load_personal_managed_sandbox(db, user.id, lock_row=True)
    if sandbox is None:
        return None
    if sandbox.status in {"creating", "starting"} and _in_flight_status_is_fresh(sandbox):
        raise CloudApiError(
            "managed_sandbox_lifecycle_busy",
            "Managed cloud sandbox is still starting. Try destroy again after startup finishes.",
            status_code=409,
        )
    destroying = await update_managed_sandbox_status(
        db,
        sandbox.id,
        status="destroying",
        last_error=None,
    )
    await commit_managed_sandbox_session(db)
    sandbox = destroying or sandbox
    provider = get_configured_sandbox_provider()
    if sandbox.e2b_sandbox_id:
        try:
            await provider.destroy_sandbox(sandbox.e2b_sandbox_id)
        except Exception as exc:
            message = format_exception_message(exc)
            log_cloud_event(
                "managed sandbox destroy provider call failed",
                managed_sandbox_id=sandbox.id,
                e2b_sandbox_id=sandbox.e2b_sandbox_id,
                error=message,
                error_type=exc.__class__.__name__,
            )
            await update_managed_sandbox_status(
                db,
                sandbox.id,
                status="error",
                last_error=message,
            )
            await commit_managed_sandbox_session(db)
            raise CloudApiError(
                "managed_sandbox_destroy_failed",
                message or "Managed cloud sandbox destroy failed.",
                status_code=502,
            ) from exc
    destroyed = await mark_managed_sandbox_destroyed(db, sandbox.id)
    await commit_managed_sandbox_session(db)
    return destroyed


async def load_managed_sandbox_runtime_access(
    sandbox: ManagedSandboxValue,
) -> tuple[str, str, str]:
    if not _runtime_access_ready(sandbox):
        raise CloudApiError(
            "managed_sandbox_runtime_not_ready",
            "Managed sandbox runtime access is not ready.",
            status_code=409,
        )
    return (
        sandbox.anyharness_base_url or "",
        decrypt_text(sandbox.anyharness_bearer_token_ciphertext or ""),
        decrypt_text(sandbox.anyharness_data_key_ciphertext or ""),
    )


async def ensure_managed_sandbox_repo_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    git_owner: str,
    git_repo_name: str,
) -> ManagedSandboxRepoRuntimeConnection:
    cache_key = _repo_runtime_connection_cache_key(
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    cached = _cached_repo_runtime_connection(cache_key)
    if cached is not None:
        return cached

    async with _repo_runtime_connection_lock(cache_key):
        cached = _cached_repo_runtime_connection(cache_key)
        if cached is not None:
            return cached

        connection = await _resolve_managed_sandbox_repo_runtime_connection(
            db,
            user,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        return _remember_repo_runtime_connection(cache_key, connection)


async def _resolve_managed_sandbox_repo_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    git_owner: str,
    git_repo_name: str,
) -> ManagedSandboxRepoRuntimeConnection:
    repo_config = await get_cloud_repo_config(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        raise CloudApiError(
            "managed_sandbox_repo_not_configured",
            "Configure this GitHub repo for cloud use before resolving its runtime.",
            status_code=404,
        )
    github_grant = await read_ready_github_grant_for_user(db, user_id=user.id)
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Connect GitHub before resolving a managed sandbox repo runtime.",
            status_code=400,
        )

    sandbox = await ensure_managed_sandbox_ready(db, user)
    from proliferate.server.cloud.managed_sandboxes.repo_materialization import (
        ensure_repo_materialized,
    )

    materialization = await ensure_repo_materialized(
        db,
        sandbox=sandbox,
        repo_config=repo_config,
        github_token=github_grant.access_token,
        run_setup=False,
    )
    if not materialization.anyharness_workspace_id:
        raise CloudApiError(
            "managed_sandbox_repo_materialization_incomplete",
            "Managed sandbox repo materialization did not resolve an AnyHarness workspace.",
            status_code=502,
        )
    await attach_anyharness_workspace_id_to_managed_repo_workspaces(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        anyharness_workspace_id=materialization.anyharness_workspace_id,
        preferred_branch=repo_config.default_branch,
    )
    return ManagedSandboxRepoRuntimeConnection(
        anyharness_workspace_id=materialization.anyharness_workspace_id,
        anyharness_repo_root_id=materialization.anyharness_repo_root_id,
        runtime_generation=sandbox.runtime_generation,
    )


async def ensure_managed_sandbox_workspace_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    workspace_id: UUID,
) -> ManagedSandboxWorkspaceRuntimeConnection:
    async with _workspace_runtime_connection_lock(workspace_id):
        workspace = await cloud_workspace_user_can_interact_with_db(
            db,
            user.id,
            workspace_id,
        )
        return await ensure_managed_sandbox_workspace_record_runtime_connection(
            db,
            user,
            workspace=workspace,
        )


async def ensure_managed_sandbox_workspace_record_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    workspace: _ManagedWorkspaceRow,
) -> ManagedSandboxWorkspaceRuntimeConnection:
    if (
        workspace.owner_scope != "personal"
        or workspace.owner_user_id != user.id
        or workspace.sandbox_profile_id is None
        or workspace.target_id is None
    ):
        raise CloudApiError(
            "managed_sandbox_workspace_required",
            "This cloud workspace is not backed by a managed sandbox.",
            status_code=409,
        )

    repo_connection = await ensure_managed_sandbox_repo_runtime_connection(
        db,
        user,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    if not repo_connection.anyharness_repo_root_id:
        raise CloudApiError(
            "managed_sandbox_repo_materialization_incomplete",
            "Managed sandbox repo materialization did not resolve an AnyHarness repo root.",
            status_code=502,
        )

    branch = workspace.git_branch.strip()
    if not branch:
        raise CloudApiError(
            "invalid_workspace_branch",
            "Cloud workspace branch is missing.",
            status_code=400,
        )

    base_branch = workspace.git_base_branch.strip() if workspace.git_base_branch else None
    is_repo_root_workspace = base_branch is None or branch == base_branch
    if (
        workspace.anyharness_workspace_id
        and workspace.status == "ready"
        and (
            is_repo_root_workspace
            or workspace.anyharness_workspace_id != repo_connection.anyharness_workspace_id
        )
    ):
        return ManagedSandboxWorkspaceRuntimeConnection(
            anyharness_workspace_id=workspace.anyharness_workspace_id,
            anyharness_repo_root_id=repo_connection.anyharness_repo_root_id,
            runtime_generation=repo_connection.runtime_generation,
        )

    if is_repo_root_workspace:
        await attach_anyharness_workspace_id(
            db,
            workspace_id=workspace.id,
            anyharness_workspace_id=repo_connection.anyharness_workspace_id,
            runtime_generation=repo_connection.runtime_generation,
        )
        return ManagedSandboxWorkspaceRuntimeConnection(
            anyharness_workspace_id=repo_connection.anyharness_workspace_id,
            anyharness_repo_root_id=repo_connection.anyharness_repo_root_id,
            runtime_generation=repo_connection.runtime_generation,
        )

    sandbox = await ensure_managed_sandbox_ready(db, user)
    runtime_url, access_token, _data_key = await load_managed_sandbox_runtime_access(sandbox)
    worktree_path = workspace.worktree_path or _managed_cloud_worktree_path(workspace)
    materialized = await create_remote_worktree_workspace(
        runtime_url,
        access_token,
        repo_root_id=repo_connection.anyharness_repo_root_id,
        target_path=worktree_path,
        new_branch_name=branch,
        base_branch=base_branch,
        origin=_workspace_origin_context(workspace),
        creator_context={"kind": "human", "label": "Cloud workspace"},
    )
    await attach_anyharness_workspace_id(
        db,
        workspace_id=workspace.id,
        anyharness_workspace_id=materialized.workspace_id,
        worktree_path=worktree_path,
        runtime_generation=sandbox.runtime_generation,
    )
    return ManagedSandboxWorkspaceRuntimeConnection(
        anyharness_workspace_id=materialized.workspace_id,
        anyharness_repo_root_id=materialized.repo_root_id,
        runtime_generation=sandbox.runtime_generation,
    )


async def _reuse_ready_runtime_if_possible(
    db: AsyncSession,
    provider: SandboxProvider,
    sandbox: ManagedSandboxValue,
    *,
    template_ref: str,
) -> ManagedSandboxValue | None:
    if sandbox.e2b_template_ref != template_ref:
        return None
    if not _runtime_access_ready(sandbox):
        return None
    token = decrypt_text(sandbox.anyharness_bearer_token_ciphertext or "")
    try:
        connected = await provider.connect_running_sandbox(sandbox.e2b_sandbox_id or "")
        endpoint = await provider.resolve_runtime_endpoint(connected)
        await wait_for_runtime_health(
            endpoint.runtime_url,
            required_successes=1,
            total_attempts=3,
            delay_seconds=0.25,
        )
        await verify_runtime_auth_enforced(endpoint.runtime_url, token)
        updated = await mark_managed_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id or "",
            e2b_template_ref=template_ref,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=sandbox.anyharness_bearer_token_ciphertext or "",
            anyharness_data_key_ciphertext=sandbox.anyharness_data_key_ciphertext or "",
        )
        await commit_managed_sandbox_session(db)
        return updated
    except Exception as exc:
        log_cloud_event(
            "managed sandbox ready runtime reuse failed",
            managed_sandbox_id=sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
    try:
        connected = await provider.resume_sandbox(sandbox.e2b_sandbox_id or "")
        endpoint = await provider.resolve_runtime_endpoint(connected)
        await wait_for_runtime_health(
            endpoint.runtime_url,
            required_successes=1,
            total_attempts=12,
            delay_seconds=0.5,
        )
        await verify_runtime_auth_enforced(endpoint.runtime_url, token)
        updated = await mark_managed_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id or "",
            e2b_template_ref=template_ref,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=sandbox.anyharness_bearer_token_ciphertext or "",
            anyharness_data_key_ciphertext=sandbox.anyharness_data_key_ciphertext or "",
        )
        await commit_managed_sandbox_session(db)
        return updated
    except Exception as exc:
        log_cloud_event(
            "managed sandbox paused runtime resume failed",
            managed_sandbox_id=sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        return None


async def _create_or_launch_runtime(
    db: AsyncSession,
    provider: SandboxProvider,
    sandbox: ManagedSandboxValue,
    *,
    template_ref: str,
) -> ManagedSandboxValue:
    provider_sandbox: Any | None = None
    e2b_sandbox_id = sandbox.e2b_sandbox_id
    if e2b_sandbox_id and sandbox.e2b_template_ref != template_ref:
        try:
            await provider.destroy_sandbox(e2b_sandbox_id)
        except Exception as exc:
            log_cloud_event(
                "managed sandbox old template destroy failed",
                managed_sandbox_id=sandbox.id,
                e2b_sandbox_id=e2b_sandbox_id,
                old_template_ref=sandbox.e2b_template_ref,
                new_template_ref=template_ref,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
        e2b_sandbox_id = None
    if e2b_sandbox_id:
        try:
            provider_sandbox = await provider.resume_sandbox(e2b_sandbox_id)
        except Exception:
            provider_sandbox = None
    if provider_sandbox is None:
        handle = await provider.create_sandbox(
            metadata={
                "proliferate_managed_sandbox_id": str(sandbox.id),
                "proliferate_owner_scope": sandbox.owner_scope,
            }
        )
        e2b_sandbox_id = handle.sandbox_id
        recorded = await record_managed_sandbox_provider_sandbox(
            db,
            sandbox.id,
            e2b_sandbox_id=e2b_sandbox_id,
            e2b_template_ref=template_ref,
        )
        if recorded is None:
            try:
                await provider.destroy_sandbox(e2b_sandbox_id)
            except Exception as exc:
                log_cloud_event(
                    "managed sandbox orphan cleanup failed after row disappeared",
                    managed_sandbox_id=sandbox.id,
                    e2b_sandbox_id=e2b_sandbox_id,
                    error=format_exception_message(exc),
                    error_type=exc.__class__.__name__,
                )
            raise CloudApiError(
                "managed_sandbox_not_found",
                "Managed sandbox disappeared during provisioning.",
                status_code=404,
            )
        sandbox = recorded
        await commit_managed_sandbox_session(db)
        provider_sandbox = await provider.connect_running_sandbox(e2b_sandbox_id)

    runtime_context = await provider.resolve_runtime_context(provider_sandbox)
    endpoint = await provider.resolve_runtime_endpoint(provider_sandbox)
    runtime_token = secrets.token_urlsafe(32)
    data_key = generate_anyharness_data_key()
    runtime_env = build_runtime_env(runtime_token, anyharness_data_key=data_key)

    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_stop_previous",
            command=build_supervised_runtime_stop_command(runtime_context),
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox previous runtime stop failed",
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_prepare_workdir",
            command=f"mkdir -p {runtime_context.runtime_workdir}",
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox runtime workdir prepare failed",
    )
    await provider.write_file(
        provider_sandbox,
        runtime_launcher_path(runtime_context),
        build_runtime_launch_script(provider, runtime_context, runtime_env),
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_launch",
            command=(
                f"chmod 700 {runtime_launcher_path(runtime_context)} && "
                f"{build_detached_runtime_launch_command(runtime_context)}"
            ),
            runtime_context=runtime_context,
            cwd=runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox runtime launch failed",
    )
    await wait_for_runtime_health(
        endpoint.runtime_url,
        required_successes=1,
        total_attempts=40,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(endpoint.runtime_url, runtime_token)

    ready = await mark_managed_sandbox_ready(
        db,
        sandbox.id,
        e2b_sandbox_id=e2b_sandbox_id or "",
        e2b_template_ref=template_ref,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(data_key),
    )
    if ready is None:
        raise CloudApiError(
            "managed_sandbox_not_found",
            "Managed sandbox disappeared during provisioning.",
            status_code=404,
        )
    await commit_managed_sandbox_session(db)
    await _best_effort_reconcile_repos(db, user_id=ready.owner_user_id, sandbox=ready)
    return ready


async def _best_effort_reconcile_repos(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    sandbox: ManagedSandboxValue,
) -> None:
    if user_id is None:
        return
    github_grant = await read_ready_github_grant_for_user(db, user_id=user_id)
    if github_grant is None:
        return
    from proliferate.server.cloud.managed_sandboxes.repo_materialization import (
        reconcile_configured_repos_for_sandbox,
    )

    try:
        await reconcile_configured_repos_for_sandbox(
            db,
            sandbox=sandbox,
            github_token=github_grant.access_token,
            run_setup=False,
        )
        await commit_managed_sandbox_session(db)
    except Exception as exc:
        log_cloud_event(
            "managed sandbox repo reconciliation failed",
            managed_sandbox_id=sandbox.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
