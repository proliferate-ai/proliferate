from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from proliferate.server.cloud.runtime.domain.credential_revision import (
    EMPTY_FILES_REVISION,
    EMPTY_PROCESS_REVISION,
    CredentialRevisionPlan,
    build_credential_revision_plan,
    classify_credential_freshness,
    decide_process_credential_restart,
)
from proliferate.server.cloud.runtime.domain.provider_events import (
    is_stale_provider_event,
    provider_event_kind,
)
from proliferate.server.cloud.runtime.domain.reconnect_policy import (
    SandboxReconnectAction,
    endpoint_health_wait_config,
    reconnect_action_for_sandbox_state,
    restart_health_wait_config,
    should_persist_rotated_runtime_url,
)
from proliferate.server.cloud.runtime.domain.runtime_state import (
    RuntimeLifecycleChange,
    runtime_endpoint_rotated_update,
    runtime_generation_changes_for,
    runtime_process_relaunched_update,
    runtime_provider_destroyed_update,
)


def test_credential_revision_plan_filters_supported_active_credentials() -> None:
    file_id = uuid4()
    process_id = uuid4()
    revoked_id = uuid4()
    unsupported_id = uuid4()
    records = [
        SimpleNamespace(
            id=file_id,
            provider="codex",
            auth_mode="file",
            payload_format="json-v1",
            revoked_at=None,
        ),
        SimpleNamespace(
            id=process_id,
            provider="claude",
            auth_mode="env",
            payload_format="json-v1",
            revoked_at=None,
        ),
        SimpleNamespace(
            id=revoked_id,
            provider="gemini",
            auth_mode="env",
            payload_format="json-v1",
            revoked_at=datetime.now(UTC),
        ),
        SimpleNamespace(
            id=unsupported_id,
            provider="other",
            auth_mode="env",
            payload_format="json-v1",
            revoked_at=None,
        ),
    ]

    plan = build_credential_revision_plan(records)

    assert plan.missing_credentials is False
    assert str(file_id) in plan.files_revision
    assert str(process_id) in plan.process_revision
    assert str(revoked_id) not in plan.process_revision
    assert str(unsupported_id) not in plan.process_revision


def test_credential_revision_plan_uses_empty_revisions_when_no_credentials() -> None:
    plan = build_credential_revision_plan([])

    assert plan.files_revision == EMPTY_FILES_REVISION
    assert plan.process_revision == EMPTY_PROCESS_REVISION
    assert plan.missing_credentials is True


def test_credential_freshness_treats_legacy_running_runtime_as_current() -> None:
    decision = classify_credential_freshness(
        runtime_status="running",
        active_sandbox_id=uuid4(),
        files_applied_revision=None,
        process_applied_revision=None,
        credential_last_error=None,
        credential_last_error_at=None,
        credential_files_applied_at=None,
        credential_process_applied_at=None,
        revisions=CredentialRevisionPlan(
            files_revision="credential-files:v1:file",
            process_revision="credential-process:v1:process",
            missing_credentials=False,
        ),
    )

    assert decision.status == "current"
    assert decision.files_current is True
    assert decision.process_current is True
    assert decision.requires_restart is False


def test_credential_freshness_prioritizes_apply_failure_before_restart() -> None:
    decision = classify_credential_freshness(
        runtime_status="running",
        active_sandbox_id=uuid4(),
        files_applied_revision="credential-files:v1:old",
        process_applied_revision="credential-process:v1:old",
        credential_last_error="sanitized",
        credential_last_error_at=None,
        credential_files_applied_at=None,
        credential_process_applied_at=None,
        revisions=CredentialRevisionPlan(
            files_revision="credential-files:v1:new",
            process_revision="credential-process:v1:new",
            missing_credentials=False,
        ),
    )

    assert decision.status == "apply_failed"
    assert decision.requires_restart is True


def test_process_credential_restart_decision_blocks_disallowed_and_live_sessions() -> None:
    assert (
        decide_process_credential_restart(
            requires_restart=False,
            allow_process_restart=True,
            runtime_has_live_sessions=False,
        ).reason
        == "not_required"
    )
    assert (
        decide_process_credential_restart(
            requires_restart=True,
            allow_process_restart=False,
            runtime_has_live_sessions=False,
        ).reason
        == "restart_disallowed"
    )
    assert (
        decide_process_credential_restart(
            requires_restart=True,
            allow_process_restart=True,
            runtime_has_live_sessions=True,
        ).reason
        == "live_sessions"
    )
    assert (
        decide_process_credential_restart(
            requires_restart=True,
            allow_process_restart=True,
            runtime_has_live_sessions=False,
        ).allowed
        is True
    )


def test_reconnect_policy_classifies_sandbox_state_and_provider_waits() -> None:
    assert reconnect_action_for_sandbox_state(" Running ") == SandboxReconnectAction.connect
    assert reconnect_action_for_sandbox_state("stopped") == SandboxReconnectAction.resume
    assert reconnect_action_for_sandbox_state("destroyed") == SandboxReconnectAction.unavailable

    assert endpoint_health_wait_config("daytona").total_attempts == 30
    assert endpoint_health_wait_config("e2b").total_attempts == 4
    assert restart_health_wait_config(SimpleNamespace(value="daytona")).total_attempts == 45
    assert restart_health_wait_config("e2b").total_attempts == 12

    assert should_persist_rotated_runtime_url("https://old.invalid", "https://new.invalid")
    assert not should_persist_rotated_runtime_url(
        "https://runtime.invalid",
        "https://runtime.invalid",
    )


def test_runtime_generation_updates_distinguish_url_rotation_from_identity_change() -> None:
    assert runtime_generation_changes_for(RuntimeLifecycleChange.url_rotated) is False
    assert runtime_generation_changes_for(RuntimeLifecycleChange.process_relaunched) is True
    assert runtime_generation_changes_for(RuntimeLifecycleChange.provider_destroyed) is True

    assert runtime_endpoint_rotated_update("https://fresh.invalid") == {
        "runtime_url": "https://fresh.invalid",
    }
    assert runtime_process_relaunched_update("https://fresh.invalid") == {
        "runtime_url": "https://fresh.invalid",
        "increment_runtime_generation": True,
    }
    assert runtime_provider_destroyed_update() == {
        "status": "error",
        "runtime_url": None,
        "runtime_token_ciphertext": None,
        "active_sandbox_id": None,
        "increment_runtime_generation": True,
        "last_error": "Provider reported sandbox killed.",
    }


def test_provider_event_classification_and_stale_precedence() -> None:
    event_time = datetime.now(UTC)

    assert provider_event_kind("sandbox.lifecycle.killed") == "killed"
    assert provider_event_kind("sandbox.lifecycle.ignored") is None
    assert provider_event_kind("other.event") is None
    assert is_stale_provider_event(
        last_event_at=event_time,
        last_event_kind="paused",
        incoming_event_at=event_time - timedelta(seconds=1),
        incoming_event_kind="killed",
    )
    assert not is_stale_provider_event(
        last_event_at=event_time,
        last_event_kind="paused",
        incoming_event_at=event_time,
        incoming_event_kind="killed",
    )
    assert is_stale_provider_event(
        last_event_at=event_time,
        last_event_kind="killed",
        incoming_event_at=event_time,
        incoming_event_kind="paused",
    )
