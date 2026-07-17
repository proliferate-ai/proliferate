"""Pure managed execution lifecycle decisions."""

from datetime import UTC, datetime, timedelta

from proliferate.server.workflows.domain.managed_execution import (
    FreshnessBasis,
    access_retry_delay_seconds,
    derive_freshness,
    delivery_error_action,
    observation_delay_seconds,
    projection_decision,
)


def test_run_put_failure_classification_distinguishes_truthful_outcomes() -> None:
    assert (
        delivery_error_action(
            checkpoint="run_put_started",
            code="workflow_execution_store_changed",
            retryable=False,
            authentication=False,
            previous_code=None,
        )
        == "target_lost"
    )
    assert (
        delivery_error_action(
            checkpoint="run_put_started",
            code="workflow_run_put_not_found",
            retryable=False,
            authentication=False,
            previous_code=None,
        )
        == "target_lost"
    )
    assert (
        delivery_error_action(
            checkpoint="run_put_started",
            code="workflow_run_put_rejected",
            retryable=False,
            authentication=False,
            previous_code=None,
        )
        == "fail"
    )
    assert (
        delivery_error_action(
            checkpoint="run_put_started",
            code="workflow_run_put_unreachable",
            retryable=True,
            authentication=False,
            previous_code=None,
        )
        == "retry"
    )


def test_pre_run_authentication_has_one_persisted_retry() -> None:
    code = "workflow_runtime_authentication_failed"
    assert (
        delivery_error_action(
            checkpoint="workspace_put_started",
            code=code,
            retryable=True,
            authentication=True,
            previous_code=None,
        )
        == "retry"
    )
    assert (
        delivery_error_action(
            checkpoint="workspace_put_started",
            code=code,
            retryable=True,
            authentication=True,
            previous_code=code,
        )
        == "fail"
    )


def test_access_retry_schedule_caps_at_sixty_seconds() -> None:
    assert [access_retry_delay_seconds(index) for index in range(6)] == [
        5,
        10,
        20,
        40,
        60,
        60,
    ]


def test_projection_decision_pins_full_monotonic_matrix() -> None:
    stored = {"stateVersion": 4, "status": "running"}
    assert (
        projection_decision(
            stored_version=4,
            stored_projection=stored,
            incoming_version=5,
            incoming_projection={"stateVersion": 5, "status": "completed"},
        )
        == "apply"
    )
    assert (
        projection_decision(
            stored_version=4,
            stored_projection=stored,
            incoming_version=4,
            incoming_projection=stored,
        )
        == "heartbeat"
    )
    assert (
        projection_decision(
            stored_version=4,
            stored_projection=stored,
            incoming_version=4,
            incoming_projection={"stateVersion": 4, "status": "failed"},
        )
        == "conflict"
    )
    assert (
        projection_decision(
            stored_version=4,
            stored_projection=stored,
            incoming_version=3,
            incoming_projection={"stateVersion": 3, "status": "accepted"},
        )
        == "stale"
    )


def test_freshness_matrix_uses_only_server_observation_time() -> None:
    now = datetime(2026, 7, 16, 12, tzinfo=UTC)
    stale_after = timedelta(seconds=60)
    assert (
        derive_freshness(
            basis=FreshnessBasis.PENDING,
            execution_status=None,
            latest_observed_at=None,
            now=now,
            stale_after=stale_after,
        )
        == "pending"
    )
    assert (
        derive_freshness(
            basis=FreshnessBasis.LIVE,
            execution_status="running",
            latest_observed_at=now - timedelta(seconds=60),
            now=now,
            stale_after=stale_after,
        )
        == "live"
    )
    assert (
        derive_freshness(
            basis=FreshnessBasis.LIVE,
            execution_status="running",
            latest_observed_at=now - timedelta(seconds=61),
            now=now,
            stale_after=stale_after,
        )
        == "stale"
    )
    assert (
        derive_freshness(
            basis=FreshnessBasis.UNREACHABLE,
            execution_status="running",
            latest_observed_at=now,
            now=now,
            stale_after=stale_after,
        )
        == "unreachable"
    )
    assert (
        derive_freshness(
            basis=FreshnessBasis.TARGET_LOST,
            execution_status="running",
            latest_observed_at=now,
            now=now,
            stale_after=stale_after,
        )
        == "target_lost"
    )
    assert (
        derive_freshness(
            basis=FreshnessBasis.LIVE,
            execution_status="completed",
            latest_observed_at=now - timedelta(days=30),
            now=now,
            stale_after=stale_after,
        )
        == "live"
    )


def test_observation_delay_resets_and_caps() -> None:
    assert observation_delay_seconds(advanced=True, unchanged_count=99) == 1
    assert [
        observation_delay_seconds(advanced=False, unchanged_count=count) for count in range(6)
    ] == [1, 1, 2, 4, 8, 10]


def test_workflow_attempt_metric_is_bounded_and_secret_free() -> None:
    from proliferate.server.workflows.worker.telemetry import build_attempt_metric

    payload = build_attempt_metric("observe", "workflow_runtime_unreachable")
    assert payload == {
        "managed_workflow_attempt": {
            "operation": "observe",
            "safe_code": "workflow_runtime_unreachable",
            "count": 1,
        }
    }
    assert "secret" not in str(payload)
