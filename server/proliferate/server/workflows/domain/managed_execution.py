"""Pure state rules for managed Workflow delivery and projection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal


class DeliveryStatus(StrEnum):
    PREPARED = "prepared"
    QUEUED = "queued"
    DELIVERING = "delivering"
    ACCEPTED = "accepted"
    FAILED = "delivery_failed"
    CANCELLED = "delivery_cancelled"


class DeliveryCheckpoint(StrEnum):
    NONE = "none"
    TARGET_PLAN_FROZEN = "target_plan_frozen"
    TARGET_BOUND = "target_bound"
    WORKSPACE_PUT_STARTED = "workspace_put_started"
    WORKSPACE_READY = "workspace_ready"
    RUN_PUT_STARTED = "run_put_started"
    ACCEPTED = "accepted"


class DesiredState(StrEnum):
    ACTIVE = "active"
    CANCELLED = "cancelled"


class FreshnessBasis(StrEnum):
    PENDING = "pending"
    LIVE = "live"
    UNREACHABLE = "unreachable"
    TARGET_LOST = "target_lost"


TERMINAL_EXECUTION_STATUSES = frozenset({"completed", "failed", "cancelled", "interrupted"})

_CHECKPOINT_ORDER = {
    checkpoint: index
    for index, checkpoint in enumerate(
        (
            DeliveryCheckpoint.NONE,
            DeliveryCheckpoint.TARGET_PLAN_FROZEN,
            DeliveryCheckpoint.TARGET_BOUND,
            DeliveryCheckpoint.WORKSPACE_PUT_STARTED,
            DeliveryCheckpoint.WORKSPACE_READY,
            DeliveryCheckpoint.RUN_PUT_STARTED,
            DeliveryCheckpoint.ACCEPTED,
        )
    )
}


def checkpoint_at_or_after(
    current: DeliveryCheckpoint,
    boundary: DeliveryCheckpoint,
) -> bool:
    return _CHECKPOINT_ORDER[current] >= _CHECKPOINT_ORDER[boundary]


def execution_is_terminal(status: str | None) -> bool:
    return status in TERMINAL_EXECUTION_STATUSES


ProjectionDecision = Literal["apply", "heartbeat", "conflict", "stale"]


def projection_decision(
    *,
    stored_version: int | None,
    stored_projection: dict[str, object] | None,
    incoming_version: int,
    incoming_projection: dict[str, object],
) -> ProjectionDecision:
    if stored_version is None or incoming_version > stored_version:
        return "apply"
    if incoming_version < stored_version:
        return "stale"
    if stored_projection == incoming_projection:
        return "heartbeat"
    return "conflict"


def observation_delay_seconds(*, advanced: bool, unchanged_count: int) -> int:
    if advanced:
        return 1
    return min(10, 2 ** min(max(0, unchanged_count - 1), 4))


def access_retry_delay_seconds(attempt: int) -> int:
    return min(60, 5 * (2 ** min(max(0, attempt), 4)))


def derive_freshness(
    *,
    basis: FreshnessBasis,
    execution_status: str | None,
    latest_observed_at: datetime | None,
    now: datetime,
    stale_after: timedelta,
) -> Literal["pending", "live", "stale", "unreachable", "target_lost"]:
    if basis == FreshnessBasis.TARGET_LOST:
        return "target_lost"
    if basis == FreshnessBasis.UNREACHABLE:
        return "unreachable"
    if basis == FreshnessBasis.PENDING or latest_observed_at is None:
        return "pending"
    if execution_is_terminal(execution_status):
        return "live"
    return "stale" if now - latest_observed_at > stale_after else "live"


@dataclass(frozen=True)
class ScratchTargetPlan:
    cloud_sandbox_id: str

    def as_json(self) -> dict[str, object]:
        return {"kind": "scratch", "cloudSandboxId": self.cloud_sandbox_id}


@dataclass(frozen=True)
class RepositoryTargetPlan:
    repo_config_id: str
    repo_environment_id: str
    base_ref: str
    cloud_sandbox_id: str

    def as_json(self) -> dict[str, object]:
        return {
            "kind": "repositoryWorktree",
            "repoConfigId": self.repo_config_id,
            "repoEnvironmentId": self.repo_environment_id,
            "baseRef": self.base_ref,
            "cloudSandboxId": self.cloud_sandbox_id,
        }


DeliveryErrorAction = Literal["retry", "fail", "target_lost"]


def delivery_error_action(
    *,
    checkpoint: str,
    code: str,
    retryable: bool,
    authentication: bool,
    previous_code: str | None,
) -> DeliveryErrorAction:
    at_run_boundary = checkpoint == DeliveryCheckpoint.RUN_PUT_STARTED
    if at_run_boundary and code in {
        "workflow_execution_store_changed",
        "workflow_run_put_not_found",
        "workflow_target_destroyed",
    }:
        return "target_lost"
    if code.endswith("_rejected"):
        return "fail"
    if authentication and not at_run_boundary and previous_code == code:
        return "fail"
    if retryable or at_run_boundary:
        return "retry"
    return "fail"
