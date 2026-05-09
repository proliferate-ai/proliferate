from __future__ import annotations

from proliferate.constants.cloud import (
    CloudWorkspaceStatus,
    SETUP_RUN_DEFAULT_FAILURE_ERROR,
    SETUP_RUN_MISSING_WORKSPACE_ERROR,
    SETUP_RUN_STATUS_STALE,
    SETUP_RUN_SUPERSEDED_ERROR,
    WorkspacePostReadyPhase,
    classify_setup_run_finalization,
    setup_run_has_active_workspace_token,
)
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    VALID_STATUS_TRANSITIONS,
    decide_workspace_start_after_validation,
    decide_workspace_status_transition,
    provider_failure_debug_state,
    start_request_should_return_existing,
)


def test_workspace_status_transition_table_allows_current_lifecycle_edges() -> None:
    expected = {
        CloudWorkspaceStatus.pending: {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        },
        CloudWorkspaceStatus.materializing: {
            CloudWorkspaceStatus.ready,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        },
        CloudWorkspaceStatus.ready: {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        },
        CloudWorkspaceStatus.archived: {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.error,
        },
        CloudWorkspaceStatus.error: {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
        },
    }

    expected_transitions = {status: frozenset(targets) for status, targets in expected.items()}
    assert expected_transitions == VALID_STATUS_TRANSITIONS
    for current, targets in expected.items():
        for target in targets:
            decision = decide_workspace_status_transition(current.value, target)
            assert decision.allowed is True
            assert decision.status_detail == target.value.replace("_", " ").title()


def test_workspace_status_transition_rejects_representative_denied_edges() -> None:
    denied_edges = (
        (CloudWorkspaceStatus.pending, CloudWorkspaceStatus.ready),
        (CloudWorkspaceStatus.archived, CloudWorkspaceStatus.ready),
        (CloudWorkspaceStatus.error, CloudWorkspaceStatus.ready),
    )

    for current, target in denied_edges:
        decision = decide_workspace_status_transition(current.value, target)
        assert decision.allowed is False
        assert decision.error_code == "invalid_status_transition"
        assert decision.status_code == 409


def test_unknown_workspace_status_is_treated_as_error_for_recovery() -> None:
    allowed = decide_workspace_status_transition("unknown", CloudWorkspaceStatus.materializing)
    denied = decide_workspace_status_transition("unknown", CloudWorkspaceStatus.ready)

    assert allowed.allowed is True
    assert allowed.current_status == CloudWorkspaceStatus.error
    assert denied.allowed is False
    assert denied.current_status == CloudWorkspaceStatus.error


def test_workspace_start_decision_preserves_current_behavior_by_status() -> None:
    materializing = decide_workspace_start_after_validation(
        CloudWorkspaceStatus.materializing.value,
        ready_at_exists=False,
    )
    pending = decide_workspace_start_after_validation(
        CloudWorkspaceStatus.pending.value,
        ready_at_exists=False,
    )
    ready = decide_workspace_start_after_validation(
        CloudWorkspaceStatus.ready.value,
        ready_at_exists=True,
    )
    archived = decide_workspace_start_after_validation(
        CloudWorkspaceStatus.archived.value,
        ready_at_exists=True,
    )

    assert start_request_should_return_existing(CloudWorkspaceStatus.materializing.value)
    assert materializing.action == "return_current"
    assert pending.action == "queue_pending"
    assert pending.clear_last_error is True
    assert pending.refresh_repo_env_snapshot is True
    assert pending.schedule_provision is True
    assert ready.action == "return_ready"
    assert ready.schedule_provision is False
    assert archived.action == "restart_materializing"
    assert archived.target_status == CloudWorkspaceStatus.materializing
    assert archived.status_detail == "Preparing runtime"


def test_setup_run_active_token_requires_matching_token_command_and_phase() -> None:
    assert setup_run_has_active_workspace_token(
        workspace_apply_token="token",
        workspace_phase=WorkspacePostReadyPhase.starting_setup.value,
        run_apply_token="token",
        command_run_id="command-1",
    )
    assert not setup_run_has_active_workspace_token(
        workspace_apply_token="other",
        workspace_phase=WorkspacePostReadyPhase.starting_setup.value,
        run_apply_token="token",
        command_run_id="command-1",
    )
    assert not setup_run_has_active_workspace_token(
        workspace_apply_token="token",
        workspace_phase=WorkspacePostReadyPhase.completed.value,
        run_apply_token="token",
        command_run_id="command-1",
    )
    assert not setup_run_has_active_workspace_token(
        workspace_apply_token="token",
        workspace_phase=WorkspacePostReadyPhase.starting_setup.value,
        run_apply_token="token",
        command_run_id="",
    )


def test_setup_run_finalization_classifies_stale_and_active_results() -> None:
    missing = classify_setup_run_finalization(
        workspace_exists=False,
        workspace_apply_token=None,
        workspace_phase=None,
        run_apply_token="token",
        command_run_id="command-1",
        final_status="succeeded",
        success=True,
        last_error=None,
        setup_script_version=4,
    )
    stale = classify_setup_run_finalization(
        workspace_exists=True,
        workspace_apply_token="new-token",
        workspace_phase=WorkspacePostReadyPhase.starting_setup,
        run_apply_token="old-token",
        command_run_id="command-1",
        final_status="succeeded",
        success=True,
        last_error=None,
        setup_script_version=4,
    )
    failed = classify_setup_run_finalization(
        workspace_exists=True,
        workspace_apply_token="token",
        workspace_phase=WorkspacePostReadyPhase.starting_setup,
        run_apply_token="token",
        command_run_id="command-1",
        final_status="failed",
        success=False,
        last_error=None,
        setup_script_version=4,
    )

    assert missing.run_status == SETUP_RUN_STATUS_STALE
    assert missing.run_last_error == SETUP_RUN_MISSING_WORKSPACE_ERROR
    assert missing.should_update_workspace is False
    assert stale.run_status == SETUP_RUN_STATUS_STALE
    assert stale.run_last_error == SETUP_RUN_SUPERSEDED_ERROR
    assert stale.should_update_workspace is False
    assert failed.run_status == "failed"
    assert failed.should_update_workspace is True
    assert failed.workspace_update is not None
    assert failed.workspace_update.phase == WorkspacePostReadyPhase.failed
    assert failed.workspace_update.repo_files_last_error == SETUP_RUN_DEFAULT_FAILURE_ERROR


def test_provider_failure_debug_state_preserves_stop_but_clears_destroy() -> None:
    stop = provider_failure_debug_state("stop")
    destroy = provider_failure_debug_state("destroy")

    assert stop.sandbox_status == "error"
    assert stop.preserve_workspace_runtime_metadata is True
    assert stop.clear_workspace_runtime_metadata is False
    assert stop.clear_active_sandbox is False
    assert destroy.sandbox_status == "error"
    assert destroy.preserve_workspace_runtime_metadata is False
    assert destroy.clear_workspace_runtime_metadata is True
    assert destroy.clear_active_sandbox is True
