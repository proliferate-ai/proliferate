"""Pure runtime environment state mutation rules."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from proliferate.constants.cloud import CloudRuntimeEnvironmentStatus

RuntimeStateUpdate = dict[str, object]


class RuntimeLifecycleChange(StrEnum):
    url_rotated = "url_rotated"
    process_relaunched = "process_relaunched"
    token_rotated = "token_rotated"
    provider_destroyed = "provider_destroyed"


_GENERATION_CHANGING_EVENTS = frozenset(
    {
        RuntimeLifecycleChange.process_relaunched,
        RuntimeLifecycleChange.token_rotated,
        RuntimeLifecycleChange.provider_destroyed,
    }
)


def runtime_generation_changes_for(change: RuntimeLifecycleChange) -> bool:
    return change in _GENERATION_CHANGING_EVENTS


def runtime_endpoint_rotated_update(runtime_url: str) -> RuntimeStateUpdate:
    return {"runtime_url": runtime_url}


def runtime_process_relaunched_update(runtime_url: str) -> RuntimeStateUpdate:
    return {
        "runtime_url": runtime_url,
        "increment_runtime_generation": runtime_generation_changes_for(
            RuntimeLifecycleChange.process_relaunched
        ),
    }


def runtime_connected_sandbox_update(
    *,
    runtime_url: str,
    active_sandbox_id: UUID,
) -> RuntimeStateUpdate:
    return {
        "status": CloudRuntimeEnvironmentStatus.running.value,
        "runtime_url": runtime_url,
        "active_sandbox_id": active_sandbox_id,
        "last_error": None,
    }


def runtime_ready_update(
    *,
    runtime_url: str,
    runtime_token_ciphertext: str,
    root_anyharness_workspace_id: str,
    root_anyharness_repo_root_id: str,
    launched_runtime: bool,
    repo_env_applied_version: int,
) -> RuntimeStateUpdate:
    return {
        "status": CloudRuntimeEnvironmentStatus.running.value,
        "runtime_url": runtime_url,
        "runtime_token_ciphertext": runtime_token_ciphertext,
        "root_anyharness_workspace_id": root_anyharness_workspace_id,
        "root_anyharness_repo_root_id": root_anyharness_repo_root_id,
        "increment_runtime_generation": launched_runtime,
        "repo_env_applied_version": repo_env_applied_version,
        "last_error": None,
    }


def runtime_provider_running_update() -> RuntimeStateUpdate:
    return {"status": CloudRuntimeEnvironmentStatus.running.value}


def runtime_provider_paused_update() -> RuntimeStateUpdate:
    return {"status": CloudRuntimeEnvironmentStatus.paused.value}


def runtime_provider_destroyed_update() -> RuntimeStateUpdate:
    return {
        "status": CloudRuntimeEnvironmentStatus.error.value,
        "runtime_url": None,
        "runtime_token_ciphertext": None,
        "active_sandbox_id": None,
        "increment_runtime_generation": runtime_generation_changes_for(
            RuntimeLifecycleChange.provider_destroyed
        ),
        "last_error": "Provider reported sandbox killed.",
    }
