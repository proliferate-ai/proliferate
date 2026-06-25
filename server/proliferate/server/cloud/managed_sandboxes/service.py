"""Managed cloud sandbox orchestration."""

from __future__ import annotations

import asyncio
import math
import re
import secrets
import shlex
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import PurePosixPath
from typing import Any, Literal, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import read_ready_github_grant_for_user
from proliferate.config import settings
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue, get_cloud_repo_config
from proliferate.db.store.cloud_sync import targets as targets_store
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
from proliferate.integrations.anyharness import (
    apply_agent_auth_config,
    create_remote_worktree_workspace,
    get_agent_auth_config_status,
    get_runtime_config_status,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxRuntimeContext,
    get_configured_sandbox_provider,
)
from proliferate.server.cloud.agent_auth.desktop_materialization import (
    desktop_agent_auth_config_apply_request,
    record_desktop_agent_auth_config_status,
)
from proliferate.server.cloud.agent_auth.models import DesktopAgentAuthConfigApplyStatusRequest
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
from proliferate.server.cloud.runtime.bundle import (
    check_runtime_bundle_preinstalled,
    stage_runtime_bundle,
)
from proliferate.server.cloud.runtime.config_sync.runtime_config import apply_remote_runtime_config
from proliferate.server.cloud.runtime.credentials.auth_status import (
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.runtime.credentials.remote_agents import reconcile_remote_agents
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
from proliferate.server.cloud.runtime_config.service import (
    refresh_profile_runtime_config,
    runtime_config_apply_request_for_revision,
    runtime_config_fragment_for_profile,
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
class _ManagedSandboxRuntimeProfile:
    profile: sandbox_profile_store.SandboxProfileSnapshot
    target: targets_store.CloudTargetSnapshot
    selected_agent_kinds: tuple[str, ...]


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
    cloud_repo_config_id: UUID
    git_owner: str
    git_repo_name: str
    default_branch: str
    files_version: int
    env_vars_version: int
    setup_script_version: int


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
    repo_config: CloudRepoConfigValue,
) -> _RepoRuntimeConnectionCacheKey:
    return _RepoRuntimeConnectionCacheKey(
        user_id=user_id,
        cloud_repo_config_id=repo_config.id,
        git_owner=repo_config.git_owner.lower(),
        git_repo_name=repo_config.git_repo_name.lower(),
        default_branch=repo_config.default_branch,
        files_version=repo_config.files_version,
        env_vars_version=repo_config.env_vars_version,
        setup_script_version=repo_config.setup_script_version,
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


async def _ensure_personal_runtime_profile(
    db: AsyncSession,
    user: _UserWithId,
) -> _ManagedSandboxRuntimeProfile:
    profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
        db,
        user_id=user.id,
        created_by_user_id=user.id,
    )
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=user.id,
    )
    refreshed = await sandbox_profile_store.load_sandbox_profile_by_id(db, profile.id)
    if refreshed is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Cloud sandbox profile could not be prepared.",
            status_code=500,
        )
    return _ManagedSandboxRuntimeProfile(
        profile=refreshed,
        target=target,
        selected_agent_kinds=await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=refreshed.id,
        ),
    )


def _agent_auth_state_current(
    state: agent_auth_store.SandboxProfileAgentAuthTargetStateRecord | None,
    *,
    desired_revision: int,
) -> bool:
    return bool(
        state is not None
        and state.agent_auth_status == "applied"
        and state.applied_agent_auth_revision is not None
        and state.applied_agent_auth_revision >= desired_revision
        and not state.agent_auth_force_restart_required
    )


def _runtime_config_state_current(
    state: agent_auth_store.SandboxProfileAgentAuthTargetStateRecord | None,
    *,
    revision_id: str,
    sequence: int,
) -> bool:
    return bool(
        state is not None
        and state.runtime_config_status == "applied"
        and state.applied_runtime_config_revision_id == revision_id
        and state.applied_runtime_config_sequence >= sequence
    )


async def _runtime_agent_auth_config_current(
    runtime_url: str,
    access_token: str,
    *,
    desired_revision: int,
) -> bool:
    try:
        status = await get_agent_auth_config_status(runtime_url, access_token)
    except Exception as exc:
        log_cloud_event(
            "managed sandbox agent auth status probe failed",
            runtime_url=runtime_url,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        return False
    revision = status.get("revision")
    return bool(
        status.get("status") == "applied"
        and isinstance(revision, int)
        and revision >= desired_revision
    )


async def _runtime_config_revision_current(
    runtime_url: str,
    access_token: str,
    *,
    revision_id: str,
    sequence: int,
) -> bool:
    try:
        status = await get_runtime_config_status(runtime_url, access_token)
    except Exception as exc:
        log_cloud_event(
            "managed sandbox runtime config status probe failed",
            runtime_url=runtime_url,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        return False
    current_revision = status.get("currentRevision")
    if not isinstance(current_revision, dict):
        return False
    current_sequence = current_revision.get("sequence")
    return bool(
        current_revision.get("id") == revision_id
        and isinstance(current_sequence, int)
        and current_sequence >= sequence
    )


def _safe_synced_file_path(home_dir: str, relative_path: str) -> str:
    pure = PurePosixPath(relative_path)
    if (
        not relative_path
        or relative_path.startswith("/")
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        raise CloudApiError(
            "agent_auth_synced_file_path_invalid",
            "Agent authentication synced file path is invalid.",
            status_code=409,
        )
    return str(PurePosixPath(home_dir).joinpath(*pure.parts))


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
    remaining = (
        _PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS - (utcnow() - sandbox.updated_at).total_seconds()
    )
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
    runtime_profile = await _ensure_personal_runtime_profile(db, user)
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
                    runtime_profile=runtime_profile,
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
                runtime_profile=runtime_profile,
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
                runtime_profile=runtime_profile,
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
    cache_key = _repo_runtime_connection_cache_key(
        user_id=user.id,
        repo_config=repo_config,
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
            repo_config=repo_config,
        )
        return _remember_repo_runtime_connection(cache_key, connection)


async def _resolve_managed_sandbox_repo_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    repo_config: CloudRepoConfigValue,
) -> ManagedSandboxRepoRuntimeConnection:
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
        git_owner=repo_config.git_owner,
        git_repo_name=repo_config.git_repo_name,
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


async def _materialize_synced_agent_auth_files(
    provider: SandboxProvider,
    provider_sandbox: object,
    *,
    runtime_context: SandboxRuntimeContext,
    synced_files: object,
    managed_sandbox_id: UUID,
) -> None:
    files = tuple(synced_files or ())
    if not files:
        return
    destinations: list[str] = []
    contents: list[str] = []
    parent_dirs: set[str] = set()
    for item in files:
        relative_path = getattr(item, "relative_path", None)
        content = getattr(item, "content", None)
        if not isinstance(relative_path, str) or not isinstance(content, str):
            raise CloudApiError(
                "agent_auth_synced_file_invalid",
                "Agent authentication synced file payload is invalid.",
                status_code=409,
            )
        destination = _safe_synced_file_path(runtime_context.home_dir, relative_path)
        destinations.append(destination)
        contents.append(content)
        parent_dirs.add(str(PurePosixPath(destination).parent))

    if parent_dirs:
        assert_command_succeeded(
            await run_sandbox_command_logged(
                provider,
                provider_sandbox,
                workspace_id=managed_sandbox_id,
                label="managed_runtime_prepare_agent_auth_files",
                command="mkdir -p " + " ".join(shlex.quote(path) for path in sorted(parent_dirs)),
                runtime_context=runtime_context,
                timeout_seconds=30,
                log_output_on_success=True,
            ),
            "Managed sandbox agent auth directory prepare failed",
        )

    for destination, content in zip(destinations, contents, strict=True):
        await provider.write_file(
            provider_sandbox,
            destination,
            content,
        )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=managed_sandbox_id,
            label="managed_runtime_chmod_agent_auth_files",
            command="chmod 600 " + " ".join(shlex.quote(path) for path in destinations),
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox agent auth file permissions failed",
    )


async def _apply_managed_runtime_agent_auth(
    db: AsyncSession,
    provider: SandboxProvider,
    provider_sandbox: object,
    *,
    runtime_context: SandboxRuntimeContext,
    runtime_profile: _ManagedSandboxRuntimeProfile,
    runtime_url: str,
    access_token: str,
    managed_sandbox_id: UUID,
    force: bool,
) -> None:
    if not runtime_profile.selected_agent_kinds:
        return
    target_state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=runtime_profile.profile.id,
        target_id=runtime_profile.target.id,
    )
    if (
        not force
        and _agent_auth_state_current(
            target_state,
            desired_revision=runtime_profile.profile.agent_auth_revision,
        )
        and await _runtime_agent_auth_config_current(
            runtime_url,
            access_token,
            desired_revision=runtime_profile.profile.agent_auth_revision,
        )
    ):
        return

    response = await desktop_agent_auth_config_apply_request(
        db,
        profile=runtime_profile.profile,
        target_id=runtime_profile.target.id,
        actor_user_id=(
            runtime_profile.profile.owner_user_id or runtime_profile.target.created_by_user_id
        ),
    )
    revision = int(
        response.apply_request.get("revision") or runtime_profile.profile.agent_auth_revision
    )
    await commit_managed_sandbox_session(db)

    try:
        await _materialize_synced_agent_auth_files(
            provider,
            provider_sandbox,
            runtime_context=runtime_context,
            synced_files=response.synced_files,
            managed_sandbox_id=managed_sandbox_id,
        )
        applied = await apply_agent_auth_config(
            runtime_url,
            access_token,
            response.apply_request,
        )
    except Exception as exc:
        await record_desktop_agent_auth_config_status(
            db,
            profile=runtime_profile.profile,
            body=DesktopAgentAuthConfigApplyStatusRequest.model_validate(
                {
                    "targetId": runtime_profile.target.id,
                    "revision": revision,
                    "status": "failed",
                    "applied": False,
                    "errorCode": "agent_auth_apply_failed",
                    "errorMessage": format_exception_message(exc),
                }
            ),
            actor_user_id=(
                runtime_profile.profile.owner_user_id or runtime_profile.target.created_by_user_id
            ),
        )
        await commit_managed_sandbox_session(db)
        raise

    await record_desktop_agent_auth_config_status(
        db,
        profile=runtime_profile.profile,
        body=DesktopAgentAuthConfigApplyStatusRequest.model_validate(
            {
                "targetId": runtime_profile.target.id,
                "revision": applied.revision,
                "status": applied.status,
                "applied": applied.applied,
            }
        ),
        actor_user_id=(
            runtime_profile.profile.owner_user_id or runtime_profile.target.created_by_user_id
        ),
    )
    await commit_managed_sandbox_session(db)
    log_cloud_event(
        "managed sandbox agent auth applied",
        managed_sandbox_id=managed_sandbox_id,
        sandbox_profile_id=runtime_profile.profile.id,
        target_id=runtime_profile.target.id,
        revision=applied.revision,
        status=applied.status,
        selection_count=applied.selection_count,
    )


async def _apply_managed_runtime_config(
    db: AsyncSession,
    *,
    runtime_profile: _ManagedSandboxRuntimeProfile,
    runtime_url: str,
    access_token: str,
    managed_sandbox_id: UUID,
    force: bool,
) -> None:
    fragment = await runtime_config_fragment_for_profile(
        db,
        sandbox_profile_id=runtime_profile.profile.id,
    )
    target_state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=runtime_profile.profile.id,
        target_id=runtime_profile.target.id,
    )
    if (
        not force
        and fragment is not None
        and _runtime_config_state_current(
            target_state,
            revision_id=fragment.revision_id,
            sequence=fragment.sequence,
        )
        and await _runtime_config_revision_current(
            runtime_url,
            access_token,
            revision_id=fragment.revision_id,
            sequence=fragment.sequence,
        )
    ):
        return

    status = await refresh_profile_runtime_config(
        db,
        sandbox_profile_id=runtime_profile.profile.id,
        actor_user_id=runtime_profile.profile.owner_user_id,
        reason="managed_sandbox_runtime_ready",
    )
    if status.current_revision is None:
        raise CloudApiError(
            "runtime_config_missing",
            "Runtime config could not be compiled for the managed sandbox.",
            status_code=409,
        )
    revision_id = UUID(status.current_revision.revision_id)
    body = await runtime_config_apply_request_for_revision(
        db,
        revision_id=revision_id,
        target_id=runtime_profile.target.id,
        source="desktop",
    )
    await commit_managed_sandbox_session(db)

    try:
        await apply_remote_runtime_config(
            runtime_url,
            access_token,
            body,
            workspace_id=managed_sandbox_id,
        )
    except Exception as exc:
        await agent_auth_store.mark_runtime_config_failed(
            db,
            sandbox_profile_id=runtime_profile.profile.id,
            target_id=runtime_profile.target.id,
            sequence=status.current_revision.sequence,
            revision_id=revision_id,
            error_code="runtime_config_apply_failed",
            error_message=format_exception_message(exc),
        )
        await commit_managed_sandbox_session(db)
        raise

    await agent_auth_store.record_runtime_config_direct_status(
        db,
        sandbox_profile_id=runtime_profile.profile.id,
        target_id=runtime_profile.target.id,
        sequence=status.current_revision.sequence,
        revision_id=revision_id,
        status="applied",
        error_code=None,
        error_message=None,
    )
    await commit_managed_sandbox_session(db)


async def _prepare_managed_runtime_integrations(
    db: AsyncSession,
    provider: SandboxProvider,
    provider_sandbox: object,
    *,
    runtime_context: SandboxRuntimeContext,
    runtime_profile: _ManagedSandboxRuntimeProfile,
    runtime_url: str,
    access_token: str,
    managed_sandbox_id: UUID,
    force: bool,
) -> None:
    try:
        await _apply_managed_runtime_agent_auth(
            db,
            provider,
            provider_sandbox,
            runtime_context=runtime_context,
            runtime_profile=runtime_profile,
            runtime_url=runtime_url,
            access_token=access_token,
            managed_sandbox_id=managed_sandbox_id,
            force=force,
        )
        await _apply_managed_runtime_config(
            db,
            runtime_profile=runtime_profile,
            runtime_url=runtime_url,
            access_token=access_token,
            managed_sandbox_id=managed_sandbox_id,
            force=force,
        )
        if runtime_profile.selected_agent_kinds:
            await reconcile_remote_agents(
                runtime_url,
                access_token,
                workspace_id=managed_sandbox_id,
                required_agent_kinds=runtime_profile.selected_agent_kinds,
                auth_overlay_agent_kinds=runtime_profile.selected_agent_kinds,
            )
    except Exception as exc:
        log_cloud_event(
            "managed sandbox runtime integration prepare failed",
            managed_sandbox_id=managed_sandbox_id,
            sandbox_profile_id=runtime_profile.profile.id,
            target_id=runtime_profile.target.id,
            force=force,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        if force:
            raise


async def _reuse_ready_runtime_if_possible(
    db: AsyncSession,
    provider: SandboxProvider,
    sandbox: ManagedSandboxValue,
    *,
    template_ref: str,
    runtime_profile: _ManagedSandboxRuntimeProfile,
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
        if updated is not None:
            runtime_context = await provider.resolve_runtime_context(connected)
            await _prepare_managed_runtime_integrations(
                db,
                provider,
                connected,
                runtime_context=runtime_context,
                runtime_profile=runtime_profile,
                runtime_url=endpoint.runtime_url,
                access_token=token,
                managed_sandbox_id=updated.id,
                force=False,
            )
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
        if updated is not None:
            runtime_context = await provider.resolve_runtime_context(connected)
            await _prepare_managed_runtime_integrations(
                db,
                provider,
                connected,
                runtime_context=runtime_context,
                runtime_profile=runtime_profile,
                runtime_url=endpoint.runtime_url,
                access_token=token,
                managed_sandbox_id=updated.id,
                force=False,
            )
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
    runtime_profile: _ManagedSandboxRuntimeProfile,
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
    runtime_env = build_runtime_env(
        runtime_token,
        anyharness_data_key=data_key,
        target_id=runtime_profile.target.id,
    )

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
    bundle_preinstalled = await check_runtime_bundle_preinstalled(
        provider,
        provider_sandbox,
        workspace_id=sandbox.id,
        runtime_context=runtime_context,
    )
    if not bundle_preinstalled:
        staged = await stage_runtime_bundle(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            runtime_context=runtime_context,
        )
        log_cloud_event(
            "managed sandbox runtime bundle staged",
            managed_sandbox_id=sandbox.id,
            components={name: str(path) for name, path in staged.items()},
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
    await _prepare_managed_runtime_integrations(
        db,
        provider,
        provider_sandbox,
        runtime_context=runtime_context,
        runtime_profile=runtime_profile,
        runtime_url=endpoint.runtime_url,
        access_token=runtime_token,
        managed_sandbox_id=ready.id,
        force=True,
    )
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
