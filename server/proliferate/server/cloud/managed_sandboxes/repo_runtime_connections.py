"""Managed sandbox repo runtime connection cache helpers."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from uuid import UUID

from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue
from proliferate.db.store.managed_sandboxes import ManagedSandboxValue


@dataclass(frozen=True)
class ManagedSandboxRepoRuntimeConnection:
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    runtime_generation: int


@dataclass(frozen=True)
class RepoRuntimeConnectionCacheKey:
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
    RepoRuntimeConnectionCacheKey,
    _CachedRepoRuntimeConnection,
] = {}
_repo_runtime_connection_locks: dict[RepoRuntimeConnectionCacheKey, asyncio.Lock] = {}


def repo_runtime_connection_cache_key(
    *,
    user_id: UUID,
    repo_config: CloudRepoConfigValue,
) -> RepoRuntimeConnectionCacheKey:
    return RepoRuntimeConnectionCacheKey(
        user_id=user_id,
        cloud_repo_config_id=repo_config.id,
        git_owner=repo_config.git_owner.lower(),
        git_repo_name=repo_config.git_repo_name.lower(),
        default_branch=repo_config.default_branch,
        files_version=repo_config.files_version,
        env_vars_version=repo_config.env_vars_version,
        setup_script_version=repo_config.setup_script_version,
    )


def cached_repo_runtime_connection_for_current_sandbox(
    key: RepoRuntimeConnectionCacheKey,
    sandbox: ManagedSandboxValue | None,
) -> ManagedSandboxRepoRuntimeConnection | None:
    cached = _cached_repo_runtime_connection(key)
    if cached is None:
        return None
    if (
        sandbox is None
        or not _runtime_access_ready(sandbox)
        or cached.runtime_generation != sandbox.runtime_generation
    ):
        _repo_runtime_connection_cache.pop(key, None)
        return None
    return cached


def repo_runtime_connection_cache_has_entry(key: RepoRuntimeConnectionCacheKey) -> bool:
    return _cached_repo_runtime_connection(key) is not None


def repo_runtime_connection_lock(key: RepoRuntimeConnectionCacheKey) -> asyncio.Lock:
    lock = _repo_runtime_connection_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _repo_runtime_connection_locks[key] = lock
    return lock


def remember_repo_runtime_connection(
    key: RepoRuntimeConnectionCacheKey,
    connection: ManagedSandboxRepoRuntimeConnection,
) -> ManagedSandboxRepoRuntimeConnection:
    _repo_runtime_connection_cache[key] = _CachedRepoRuntimeConnection(
        connection=connection,
        expires_at_monotonic=time.monotonic() + _REPO_RUNTIME_CONNECTION_CACHE_TTL_SECONDS,
    )
    return connection


def reset_repo_runtime_connection_cache_for_tests() -> None:
    _repo_runtime_connection_cache.clear()
    _repo_runtime_connection_locks.clear()


def _cached_repo_runtime_connection(
    key: RepoRuntimeConnectionCacheKey,
) -> ManagedSandboxRepoRuntimeConnection | None:
    cached = _repo_runtime_connection_cache.get(key)
    if cached is None:
        return None
    if cached.expires_at_monotonic <= time.monotonic():
        _repo_runtime_connection_cache.pop(key, None)
        return None
    return cached.connection


def _runtime_access_ready(sandbox: ManagedSandboxValue) -> bool:
    return bool(
        sandbox.e2b_sandbox_id
        and sandbox.anyharness_base_url
        and sandbox.anyharness_bearer_token_ciphertext
        and sandbox.anyharness_data_key_ciphertext
    )
