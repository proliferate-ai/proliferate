from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

OWNER_LOCAL = "local"
LEGACY_OWNER_CLOUD = "cloud"
OWNER_PERSONAL_CLOUD = "personal_cloud"
OWNER_SHARED_CLOUD = "shared_cloud"
OWNER_SSH = "ssh"
# Backwards-compatible symbol for call sites that still mean the user's
# personal managed cloud.
OWNER_CLOUD = OWNER_PERSONAL_CLOUD
VALID_OWNERS: frozenset[str] = frozenset(
    {OWNER_LOCAL, OWNER_PERSONAL_CLOUD, OWNER_SHARED_CLOUD, OWNER_SSH}
)

DIRECTION_LOCAL_TO_CLOUD = "local_to_cloud"
DIRECTION_CLOUD_TO_LOCAL = "cloud_to_local"
DIRECTION_SHARED_TO_PERSONAL = "shared_to_personal"
DIRECTION_SHARED_TO_LOCAL = "shared_to_local"
DIRECTION_PERSONAL_TO_SHARED = "personal_to_shared"
DIRECTION_CLOUD_TO_CLOUD = "cloud_to_cloud"
VALID_HANDOFF_DIRECTIONS: frozenset[str] = frozenset(
    {
        DIRECTION_LOCAL_TO_CLOUD,
        DIRECTION_CLOUD_TO_LOCAL,
        DIRECTION_SHARED_TO_PERSONAL,
        DIRECTION_SHARED_TO_LOCAL,
        DIRECTION_PERSONAL_TO_SHARED,
        DIRECTION_CLOUD_TO_CLOUD,
    }
)

CANONICAL_SIDE_SOURCE = "source"
CANONICAL_SIDE_DESTINATION = "destination"
VALID_CANONICAL_SIDES: frozenset[str] = frozenset(
    {CANONICAL_SIDE_SOURCE, CANONICAL_SIDE_DESTINATION}
)

HANDOFF_PHASE_START_REQUESTED = "start_requested"
HANDOFF_PHASE_SOURCE_FROZEN = "source_frozen"
HANDOFF_PHASE_DESTINATION_READY = "destination_ready"
HANDOFF_PHASE_INSTALL_SUCCEEDED = "install_succeeded"
HANDOFF_PHASE_CUTOVER_COMMITTED = "cutover_committed"
HANDOFF_PHASE_CLEANUP_PENDING = "cleanup_pending"
HANDOFF_PHASE_CLEANUP_FAILED = "cleanup_failed"
HANDOFF_PHASE_REPAIR_REQUIRED = "repair_required"
HANDOFF_PHASE_COMPLETED = "completed"
HANDOFF_PHASE_HANDOFF_FAILED = "handoff_failed"
VALID_HANDOFF_PHASES: frozenset[str] = frozenset(
    {
        HANDOFF_PHASE_START_REQUESTED,
        HANDOFF_PHASE_SOURCE_FROZEN,
        HANDOFF_PHASE_DESTINATION_READY,
        HANDOFF_PHASE_INSTALL_SUCCEEDED,
        HANDOFF_PHASE_CUTOVER_COMMITTED,
        HANDOFF_PHASE_CLEANUP_PENDING,
        HANDOFF_PHASE_CLEANUP_FAILED,
        HANDOFF_PHASE_REPAIR_REQUIRED,
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
LIFECYCLE_SSH_ACTIVE = "ssh_active"
LIFECYCLE_SHARED_CLOUD_ACTIVE = "shared_cloud_active"
LIFECYCLE_MOVING = "moving"
LIFECYCLE_MOVING_TO_CLOUD = "moving_to_cloud"
LIFECYCLE_MOVING_TO_LOCAL = "moving_to_local"
LIFECYCLE_HANDOFF_FAILED = "handoff_failed"
LIFECYCLE_CLEANUP_FAILED = "cleanup_failed"
LIFECYCLE_REPAIR_REQUIRED = "repair_required"

STATUS_HANDOFF_STARTED = "Handoff started"
STATUS_CUTOVER_COMMITTED = "Cutover committed"
STATUS_AWAITING_SOURCE_CLEANUP = "Awaiting source cleanup"
STATUS_READY = "Ready"

STALE_HANDOFF_FAILURE_CODE = "handoff_stale"
STALE_HANDOFF_FAILURE_DETAIL = "Workspace mobility heartbeat expired."
STALE_CLEANUP_FAILURE_CODE = "cleanup_stale"
STALE_CLEANUP_FAILURE_DETAIL = "Workspace mobility cleanup heartbeat expired."
STALE_REPAIR_FAILURE_CODE = "repair_required"
STALE_REPAIR_FAILURE_DETAIL = "Workspace mobility heartbeat expired after cutover."
FAILURE_STATUS_DETAIL_MAX_LENGTH = 255
FAILURE_LAST_ERROR_MAX_LENGTH = 2000

_OWNER_RULES_BY_DIRECTION = {
    DIRECTION_LOCAL_TO_CLOUD: (
        frozenset({OWNER_LOCAL}),
        OWNER_PERSONAL_CLOUD,
        "workspace is not currently local-owned",
    ),
    DIRECTION_CLOUD_TO_LOCAL: (
        frozenset({OWNER_PERSONAL_CLOUD}),
        OWNER_LOCAL,
        "workspace is not currently cloud-owned",
    ),
    DIRECTION_SHARED_TO_PERSONAL: (
        frozenset({OWNER_SHARED_CLOUD}),
        OWNER_PERSONAL_CLOUD,
        "workspace is not currently shared-cloud-owned",
    ),
    DIRECTION_SHARED_TO_LOCAL: (
        frozenset({OWNER_SHARED_CLOUD}),
        OWNER_LOCAL,
        "workspace is not currently shared-cloud-owned",
    ),
    DIRECTION_PERSONAL_TO_SHARED: (
        frozenset({OWNER_PERSONAL_CLOUD}),
        OWNER_SHARED_CLOUD,
        "workspace is not currently personal-cloud-owned",
    ),
    DIRECTION_CLOUD_TO_CLOUD: (
        frozenset({OWNER_PERSONAL_CLOUD, OWNER_SHARED_CLOUD, OWNER_SSH}),
        OWNER_PERSONAL_CLOUD,
        "workspace is not currently cloud- or ssh-owned",
    ),
}


@dataclass(frozen=True)
class HandoffOwnerRule:
    required_owners: frozenset[str]
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
    return normalize_owner(owner) in VALID_OWNERS


def normalize_owner(owner: str) -> str:
    if owner == LEGACY_OWNER_CLOUD:
        return OWNER_PERSONAL_CLOUD
    return owner


def is_valid_handoff_direction(direction: str) -> bool:
    return direction in VALID_HANDOFF_DIRECTIONS


def is_local_to_cloud_direction(direction: str) -> bool:
    return direction == DIRECTION_LOCAL_TO_CLOUD


def is_valid_canonical_side(canonical_side: str) -> bool:
    return canonical_side in VALID_CANONICAL_SIDES


def is_valid_handoff_phase(phase: str) -> bool:
    return phase in VALID_HANDOFF_PHASES


def is_final_handoff_phase(phase: str) -> bool:
    return phase in FINAL_HANDOFF_PHASES


def is_active_handoff_phase(phase: str) -> bool:
    return is_valid_handoff_phase(phase) and not is_final_handoff_phase(phase)


def can_set_destination_canonical_side(*, phase: str) -> bool:
    return phase in {
        HANDOFF_PHASE_CUTOVER_COMMITTED,
        HANDOFF_PHASE_CLEANUP_PENDING,
        HANDOFF_PHASE_COMPLETED,
        HANDOFF_PHASE_REPAIR_REQUIRED,
        HANDOFF_PHASE_CLEANUP_FAILED,
    }


def handoff_owner_rule(direction: str) -> HandoffOwnerRule:
    try:
        required_owners, target_owner, blocker = _OWNER_RULES_BY_DIRECTION[direction]
    except KeyError as error:
        raise ValueError("unsupported handoff direction") from error
    return HandoffOwnerRule(
        required_owners=required_owners,
        target_owner=target_owner,
        mismatch_blocker=blocker,
    )


def target_owner_for_direction(direction: str) -> str:
    return handoff_owner_rule(direction).target_owner


def owner_direction_blocker(*, owner: str, direction: str) -> str | None:
    rule = handoff_owner_rule(direction)
    if normalize_owner(owner) in rule.required_owners:
        return None
    return rule.mismatch_blocker


def active_lifecycle_state(owner: str) -> str:
    owner = normalize_owner(owner)
    if owner == OWNER_PERSONAL_CLOUD:
        return LIFECYCLE_CLOUD_ACTIVE
    if owner == OWNER_SHARED_CLOUD:
        return LIFECYCLE_SHARED_CLOUD_ACTIVE
    if owner == OWNER_SSH:
        return LIFECYCLE_SSH_ACTIVE
    if owner == OWNER_LOCAL:
        return LIFECYCLE_LOCAL_ACTIVE
    raise ValueError("unsupported mobility owner")


def moving_lifecycle_state(target_owner: str) -> str:
    target_owner = normalize_owner(target_owner)
    if target_owner in VALID_OWNERS:
        return LIFECYCLE_MOVING
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
    canonical_side: str = CANONICAL_SIDE_SOURCE,
) -> StaleHandoffOutcome:
    if canonical_side == CANONICAL_SIDE_DESTINATION:
        return StaleHandoffOutcome(
            phase=HANDOFF_PHASE_REPAIR_REQUIRED,
            lifecycle_state=LIFECYCLE_REPAIR_REQUIRED,
            failure_code=STALE_REPAIR_FAILURE_CODE,
            failure_detail=STALE_REPAIR_FAILURE_DETAIL,
            keep_active_handoff=True,
        )
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
