from datetime import UTC, datetime, timedelta
import uuid

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_RUN_STATUS_CANCELLED,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ACTIVE_CLAIM_STATUSES,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE,
    RECLAIMABLE_STATUSES,
    TERMINAL_STATUSES,
    ClaimIdentity,
    automation_error_message,
    canonical_repo_identity,
    claim_identity_matches,
    claim_is_active,
    dispatch_uncertain_failure,
    is_expired_dispatching_claim,
    is_expired_reclaimable_claim,
    normalize_local_error_code,
    provisioning_workspace_transition,
)


def test_status_sets_preserve_dispatching_as_active_but_not_reclaimable() -> None:
    assert (
        frozenset(
            {
                AUTOMATION_RUN_STATUS_CLAIMED,
                AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                AUTOMATION_RUN_STATUS_CREATING_SESSION,
            }
        )
        == RECLAIMABLE_STATUSES
    )
    assert RECLAIMABLE_STATUSES | {AUTOMATION_RUN_STATUS_DISPATCHING} == ACTIVE_CLAIM_STATUSES
    assert (
        frozenset(
            {
                AUTOMATION_RUN_STATUS_DISPATCHED,
                AUTOMATION_RUN_STATUS_FAILED,
                AUTOMATION_RUN_STATUS_CANCELLED,
            }
        )
        == TERMINAL_STATUSES
    )


def test_expired_claim_classification_distinguishes_reclaim_and_dispatching() -> None:
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    expired_at = now - timedelta(seconds=1)

    assert claim_is_active(now + timedelta(seconds=1), now) is True
    assert claim_is_active(expired_at, now) is False
    assert is_expired_reclaimable_claim(
        AUTOMATION_RUN_STATUS_CREATING_SESSION,
        expired_at,
        now,
    )
    assert not is_expired_reclaimable_claim(
        AUTOMATION_RUN_STATUS_DISPATCHING,
        expired_at,
        now,
    )
    assert is_expired_dispatching_claim(
        AUTOMATION_RUN_STATUS_DISPATCHING,
        expired_at,
        now,
    )


def test_claim_identity_requires_current_claim_and_optional_user_scope() -> None:
    run_id = uuid.uuid4()
    claim_id = uuid.uuid4()
    user_id = uuid.uuid4()
    expected = ClaimIdentity(
        run_id=run_id,
        claim_id=claim_id,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind="desktop",
        user_id=user_id,
    )
    matching = ClaimIdentity(
        run_id=run_id,
        claim_id=claim_id,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind="desktop",
        user_id=user_id,
    )
    wrong_user = ClaimIdentity(
        run_id=run_id,
        claim_id=claim_id,
        execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
        executor_kind="desktop",
        user_id=uuid.uuid4(),
    )
    global_expected = ClaimIdentity(
        run_id=run_id,
        claim_id=claim_id,
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        executor_kind="cloud",
        user_id=None,
    )
    cloud_actual = ClaimIdentity(
        run_id=run_id,
        claim_id=claim_id,
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        executor_kind="cloud",
        user_id=uuid.uuid4(),
    )

    assert claim_identity_matches(expected, matching)
    assert not claim_identity_matches(expected, wrong_user)
    assert claim_identity_matches(global_expected, cloud_actual)


def test_transition_rules_encode_cloud_and_local_workspace_requirements() -> None:
    cloud = provisioning_workspace_transition(AUTOMATION_EXECUTION_TARGET_CLOUD)
    local = provisioning_workspace_transition(AUTOMATION_EXECUTION_TARGET_LOCAL)

    assert cloud.allowed_statuses == local.allowed_statuses
    assert cloud.requires_cloud_workspace is True
    assert cloud.requires_anyharness_workspace is False
    assert local.requires_cloud_workspace is False
    assert local.requires_anyharness_workspace is True


def test_error_mapping_and_local_code_normalization_are_domain_rules() -> None:
    failure = dispatch_uncertain_failure()

    assert failure.code == AUTOMATION_ERROR_DISPATCH_UNCERTAIN
    assert failure.message == AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE
    assert automation_error_message("local_prompt_send_failed").startswith("The local runtime")
    assert automation_error_message("unknown") == "The executor could not dispatch this run."
    assert normalize_local_error_code("dispatch_uncertain") == "dispatch_uncertain"
    assert normalize_local_error_code("local_prompt_send_failed") == "local_prompt_send_failed"
    assert normalize_local_error_code("raw/path/leak") == "local_unexpected_executor_error"


def test_canonical_repo_identity_normalizes_and_rejects_blank_parts() -> None:
    assert canonical_repo_identity(" GitHub ", " Proliferate-AI ", " Proliferate ") == (
        canonical_repo_identity("github", "proliferate-ai", "proliferate")
    )
    assert canonical_repo_identity("github", "", "proliferate") is None
