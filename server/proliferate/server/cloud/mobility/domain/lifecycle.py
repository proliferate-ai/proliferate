from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

OWNER_LOCAL = "local"
OWNER_CLOUD = "cloud"
VALID_OWNERS: frozenset[str] = frozenset({OWNER_LOCAL, OWNER_CLOUD})

DIRECTION_LOCAL_TO_CLOUD = "local_to_cloud"
DIRECTION_CLOUD_TO_LOCAL = "cloud_to_local"
VALID_HANDOFF_DIRECTIONS: frozenset[str] = frozenset(
    {DIRECTION_LOCAL_TO_CLOUD, DIRECTION_CLOUD_TO_LOCAL}
)

HANDOFF_PHASE_START_REQUESTED = "start_requested"
HANDOFF_PHASE_SOURCE_FROZEN = "source_frozen"
HANDOFF_PHASE_DESTINATION_READY = "destination_ready"
HANDOFF_PHASE_INSTALL_SUCCEEDED = "install_succeeded"
HANDOFF_PHASE_CLEANUP_PENDING = "cleanup_pending"
HANDOFF_PHASE_CLEANUP_FAILED = "cleanup_failed"
HANDOFF_PHASE_COMPLETED = "completed"
HANDOFF_PHASE_HANDOFF_FAILED = "handoff_failed"
VALID_HANDOFF_PHASES: frozenset[str] = frozenset(
    {
        HANDOFF_PHASE_START_REQUESTED,
        HANDOFF_PHASE_SOURCE_FROZEN,
        HANDOFF_PHASE_DESTINATION_READY,
        HANDOFF_PHASE_INSTALL_SUCCEEDED,
        HANDOFF_PHASE_CLEANUP_PENDING,
        HANDOFF_PHASE_CLEANUP_FAILED,
        HANDOFF_PHASE_COMPLETED,
        HANDOFF_PHASE_HANDOFF_FAILED,
    }
)
FINAL_HANDOFF_PHASES: tuple[str, ...] = (
    HANDOFF_PHASE_COMPLETED,
    HANDOFF_PHASE_HANDOFF_FAILED,
)

LIFECYCLE_LOCAL_ACTIVE = "local_active"
LIFECYCLE_CLOUD_ACTIVE = "cloud_active"
LIFECYCLE_MOVING_TO_CLOUD = "moving_to_cloud"
LIFECYCLE_MOVING_TO_LOCAL = "moving_to_local"
LIFECYCLE_HANDOFF_FAILED = "handoff_failed"
LIFECYCLE_CLEANUP_FAILED = "cleanup_failed"

STATUS_HANDOFF_STARTED = "Handoff started"
STATUS_AWAITING_SOURCE_CLEANUP = "Awaiting source cleanup"
STATUS_READY = "Ready"

STALE_HANDOFF_FAILURE_CODE = "handoff_stale"
STALE_HANDOFF_FAILURE_DETAIL = "Workspace mobility heartbeat expired."
STALE_CLEANUP_FAILURE_CODE = "cleanup_stale"
STALE_CLEANUP_FAILURE_DETAIL = "Workspace mobility cleanup heartbeat expired."
FAILURE_STATUS_DETAIL_MAX_LENGTH = 255
FAILURE_LAST_ERROR_MAX_LENGTH = 2000

_OWNER_RULES_BY_DIRECTION = {
    DIRECTION_LOCAL_TO_CLOUD: (OWNER_LOCAL, OWNER_CLOUD, "workspace is not currently local-owned"),
    DIRECTION_CLOUD_TO_LOCAL: (OWNER_CLOUD, OWNER_LOCAL, "workspace is not currently cloud-owned"),
}


@dataclass(frozen=True)
class HandoffOwnerRule:
    required_owner: str
    target_owner: str
    mismatch_blocker: str


@dataclass(frozen=True)
class StaleHandoffOutcome:
    phase: str
    lifecycle_state: str
    failure_code: str
    failure_detail: str
    keep_active_handoff: bool


def is_valid_owner(owner: str) -> bool:
    return owner in VALID_OWNERS


def is_valid_handoff_direction(direction: str) -> bool:
    return direction in VALID_HANDOFF_DIRECTIONS


def is_local_to_cloud_direction(direction: str) -> bool:
    return direction == DIRECTION_LOCAL_TO_CLOUD


def is_valid_handoff_phase(phase: str) -> bool:
    return phase in VALID_HANDOFF_PHASES


def is_final_handoff_phase(phase: str) -> bool:
    return phase in FINAL_HANDOFF_PHASES


def is_active_handoff_phase(phase: str) -> bool:
    return is_valid_handoff_phase(phase) and not is_final_handoff_phase(phase)


def handoff_owner_rule(direction: str) -> HandoffOwnerRule:
    try:
        required_owner, target_owner, blocker = _OWNER_RULES_BY_DIRECTION[direction]
    except KeyError as error:
        raise ValueError("unsupported handoff direction") from error
    return HandoffOwnerRule(
        required_owner=required_owner,
        target_owner=target_owner,
        mismatch_blocker=blocker,
    )


def target_owner_for_direction(direction: str) -> str:
    return handoff_owner_rule(direction).target_owner


def owner_direction_blocker(*, owner: str, direction: str) -> str | None:
    rule = handoff_owner_rule(direction)
    if owner == rule.required_owner:
        return None
    return rule.mismatch_blocker


def active_lifecycle_state(owner: str) -> str:
    if owner == OWNER_CLOUD:
        return LIFECYCLE_CLOUD_ACTIVE
    if owner == OWNER_LOCAL:
        return LIFECYCLE_LOCAL_ACTIVE
    raise ValueError("unsupported mobility owner")


def moving_lifecycle_state(target_owner: str) -> str:
    if target_owner == OWNER_CLOUD:
        return LIFECYCLE_MOVING_TO_CLOUD
    if target_owner == OWNER_LOCAL:
        return LIFECYCLE_MOVING_TO_LOCAL
    raise ValueError("unsupported handoff target owner")


def is_retryable_mobility_failure(
    *,
    lifecycle_state: str,
    has_active_handoff: bool,
) -> bool:
    return lifecycle_state == LIFECYCLE_HANDOFF_FAILED and not has_active_handoff


def stale_handoff_outcome(
    *,
    finalized_at: datetime | None,
    cleanup_completed_at: datetime | None,
) -> StaleHandoffOutcome:
    if finalized_at is not None and cleanup_completed_at is None:
        return StaleHandoffOutcome(
            phase=HANDOFF_PHASE_CLEANUP_FAILED,
            lifecycle_state=LIFECYCLE_CLEANUP_FAILED,
            failure_code=STALE_CLEANUP_FAILURE_CODE,
            failure_detail=STALE_CLEANUP_FAILURE_DETAIL,
            keep_active_handoff=True,
        )
    return StaleHandoffOutcome(
        phase=HANDOFF_PHASE_HANDOFF_FAILED,
        lifecycle_state=LIFECYCLE_HANDOFF_FAILED,
        failure_code=STALE_HANDOFF_FAILURE_CODE,
        failure_detail=STALE_HANDOFF_FAILURE_DETAIL,
        keep_active_handoff=False,
    )


def visible_failure_status_detail(failure_detail: str) -> str | None:
    return failure_detail[:FAILURE_STATUS_DETAIL_MAX_LENGTH] if failure_detail else None


def visible_failure_last_error(failure_detail: str) -> str:
    return failure_detail[:FAILURE_LAST_ERROR_MAX_LENGTH]
