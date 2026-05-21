from __future__ import annotations

from datetime import UTC, datetime

import pytest

from proliferate.server.cloud.mobility.domain.lifecycle import (
    DIRECTION_CLOUD_TO_LOCAL,
    DIRECTION_LOCAL_TO_CLOUD,
    HANDOFF_PHASE_CLEANUP_FAILED,
    HANDOFF_PHASE_COMPLETED,
    HANDOFF_PHASE_HANDOFF_FAILED,
    LIFECYCLE_CLEANUP_FAILED,
    LIFECYCLE_CLOUD_ACTIVE,
    LIFECYCLE_HANDOFF_FAILED,
    LIFECYCLE_LOCAL_ACTIVE,
    LIFECYCLE_MOVING,
    OWNER_CLOUD,
    OWNER_LOCAL,
    STALE_CLEANUP_FAILURE_CODE,
    STALE_HANDOFF_FAILURE_CODE,
    active_lifecycle_state,
    is_active_handoff_phase,
    is_final_handoff_phase,
    is_retryable_mobility_failure,
    moving_lifecycle_state,
    owner_direction_blocker,
    stale_handoff_outcome,
    target_owner_for_direction,
    visible_failure_last_error,
    visible_failure_status_detail,
)


def test_handoff_phase_classification_keeps_cleanup_failed_active() -> None:
    assert is_final_handoff_phase(HANDOFF_PHASE_COMPLETED)
    assert is_final_handoff_phase(HANDOFF_PHASE_HANDOFF_FAILED)
    assert is_active_handoff_phase(HANDOFF_PHASE_CLEANUP_FAILED)


def test_owner_direction_compatibility() -> None:
    assert target_owner_for_direction(DIRECTION_LOCAL_TO_CLOUD) == OWNER_CLOUD
    assert target_owner_for_direction(DIRECTION_CLOUD_TO_LOCAL) == OWNER_LOCAL
    assert owner_direction_blocker(owner=OWNER_LOCAL, direction=DIRECTION_LOCAL_TO_CLOUD) is None
    assert owner_direction_blocker(owner=OWNER_CLOUD, direction=DIRECTION_CLOUD_TO_LOCAL) is None
    assert (
        owner_direction_blocker(owner=OWNER_CLOUD, direction=DIRECTION_LOCAL_TO_CLOUD)
        == "workspace is not currently local-owned"
    )
    assert (
        owner_direction_blocker(owner=OWNER_LOCAL, direction=DIRECTION_CLOUD_TO_LOCAL)
        == "workspace is not currently cloud-owned"
    )


def test_owner_direction_rejects_unknown_direction() -> None:
    with pytest.raises(ValueError, match="unsupported handoff direction"):
        target_owner_for_direction("teleport")


def test_lifecycle_state_helpers_follow_owner_and_target_owner() -> None:
    assert active_lifecycle_state(OWNER_LOCAL) == LIFECYCLE_LOCAL_ACTIVE
    assert active_lifecycle_state(OWNER_CLOUD) == LIFECYCLE_CLOUD_ACTIVE
    assert moving_lifecycle_state(OWNER_CLOUD) == LIFECYCLE_MOVING


def test_retryability_requires_failed_lifecycle_without_active_handoff() -> None:
    assert is_retryable_mobility_failure(
        lifecycle_state=LIFECYCLE_HANDOFF_FAILED,
        has_active_handoff=False,
    )
    assert not is_retryable_mobility_failure(
        lifecycle_state=LIFECYCLE_HANDOFF_FAILED,
        has_active_handoff=True,
    )
    assert not is_retryable_mobility_failure(
        lifecycle_state=LIFECYCLE_CLEANUP_FAILED,
        has_active_handoff=False,
    )


def test_stale_expiry_before_finalize_fails_handoff_and_clears_active_pointer() -> None:
    outcome = stale_handoff_outcome(finalized_at=None, cleanup_completed_at=None)

    assert outcome.phase == HANDOFF_PHASE_HANDOFF_FAILED
    assert outcome.lifecycle_state == LIFECYCLE_HANDOFF_FAILED
    assert outcome.failure_code == STALE_HANDOFF_FAILURE_CODE
    assert outcome.keep_active_handoff is False


def test_stale_expiry_after_finalize_marks_cleanup_failed_and_keeps_active_pointer() -> None:
    outcome = stale_handoff_outcome(
        finalized_at=datetime.now(UTC),
        cleanup_completed_at=None,
    )

    assert outcome.phase == HANDOFF_PHASE_CLEANUP_FAILED
    assert outcome.lifecycle_state == LIFECYCLE_CLEANUP_FAILED
    assert outcome.failure_code == STALE_CLEANUP_FAILURE_CODE
    assert outcome.keep_active_handoff is True


def test_failure_visibility_truncates_status_and_last_error_separately() -> None:
    detail = "x" * 2100

    assert visible_failure_status_detail(detail) == "x" * 255
    assert visible_failure_last_error(detail) == "x" * 2000
    assert visible_failure_status_detail("") is None
    assert visible_failure_last_error("") == ""
