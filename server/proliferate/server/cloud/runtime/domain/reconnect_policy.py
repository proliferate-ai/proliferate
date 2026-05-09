"""Pure reconnect policy for persistent runtime sandboxes."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SandboxReconnectAction(StrEnum):
    connect = "connect"
    resume = "resume"
    unavailable = "unavailable"


@dataclass(frozen=True)
class HealthWaitConfig:
    total_attempts: int
    delay_seconds: float


DEFAULT_ENDPOINT_HEALTH = HealthWaitConfig(total_attempts=4, delay_seconds=0.5)
DEFAULT_RESTART_HEALTH = HealthWaitConfig(total_attempts=12, delay_seconds=0.5)
DAYTONA_ENDPOINT_HEALTH = HealthWaitConfig(total_attempts=30, delay_seconds=1.0)
DAYTONA_RESTART_HEALTH = HealthWaitConfig(total_attempts=45, delay_seconds=1.0)

RUNNING_SANDBOX_STATES = frozenset({"running", "started"})
RESUMABLE_SANDBOX_STATES = frozenset({"paused", "stopped"})


def endpoint_health_wait_config(provider_kind: object) -> HealthWaitConfig:
    if _normalized_provider_kind(provider_kind) == "daytona":
        return DAYTONA_ENDPOINT_HEALTH
    return DEFAULT_ENDPOINT_HEALTH


def restart_health_wait_config(provider_kind: object) -> HealthWaitConfig:
    if _normalized_provider_kind(provider_kind) == "daytona":
        return DAYTONA_RESTART_HEALTH
    return DEFAULT_RESTART_HEALTH


def reconnect_action_for_sandbox_state(sandbox_state: str) -> SandboxReconnectAction:
    normalized_state = sandbox_state.strip().lower()
    if normalized_state in RUNNING_SANDBOX_STATES:
        return SandboxReconnectAction.connect
    if normalized_state in RESUMABLE_SANDBOX_STATES:
        return SandboxReconnectAction.resume
    return SandboxReconnectAction.unavailable


def should_persist_rotated_runtime_url(
    current_runtime_url: str | None,
    resolved_runtime_url: str,
) -> bool:
    return resolved_runtime_url != current_runtime_url


def _normalized_provider_kind(provider_kind: object) -> str:
    return str(getattr(provider_kind, "value", provider_kind)).strip().lower()
