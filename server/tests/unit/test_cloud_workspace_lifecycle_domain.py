from __future__ import annotations

from proliferate.constants.cloud import (
    CloudWorkspaceStatus,
    SETUP_RUN_DEFAULT_FAILURE_ERROR,
    SETUP_RUN_MISSING_WORKSPACE_ERROR,
    SETUP_RUN_STATUS_STALE,
    SETUP_RUN_SUPERSEDED_ERROR,
    WorkspacePostReadyPhase,
)
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    VALID_STATUS_TRANSITIONS,
    decide_workspace_start_after_validation,
    decide_workspace_status_transition,
    provider_failure_debug_state,
    start_request_should_return_existing,
)
from proliferate.server.cloud.workspaces.domain.post_ready import (
    repo_config_apply_started,
    repo_config_completed,
    repo_config_empty_completed,
    repo_config_file_failed,
    repo_config_file_progress,
    repo_config_files_version_applied,
    repo_setup_start_failed,
    repo_setup_starting,
)
from proliferate.server.cloud.workspaces.domain.setup_runs import (
    classify_setup_run_finalization,
    setup_run_has_active_workspace_token,
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


def test_post_ready_patch_builders_capture_repo_apply_status_decisions() -> None:
    started = repo_config_apply_started(3)
    progress = repo_config_file_progress(2)
    failed = repo_config_file_failed(relative_path="setup.sh", error="boom")
    version_applied = repo_config_files_version_applied(7)
    empty_completed = repo_config_empty_completed()
    completed = repo_config_completed(
        files_total=3,
        files_version=7,
        clear_apply_token=True,
    )

    assert started.phase == WorkspacePostReadyPhase.applying_files
    assert started.files_total == 3
    assert started.files_applied == 0
    assert started.mark_started is True
    assert started.status_detail == "Applying repo config"
    assert progress.phase is None
    assert progress.files_applied == 2
    assert progress.set_failed_path is True
    assert progress.set_failed_error is True
    assert failed.phase == WorkspacePostReadyPhase.failed
    assert failed.failed_path == "setup.sh"
    assert failed.failed_error == "boom"
    assert failed.mark_completed is True
    assert failed.status_detail == "Repo config apply failed"
    assert version_applied.files_version == 7
    assert version_applied.mark_applied_now is True
    assert empty_completed.phase == WorkspacePostReadyPhase.completed
    assert empty_completed.files_total == 0
    assert empty_completed.files_version == 0
    assert empty_completed.clear_apply_token is False
    assert completed.phase == WorkspacePostReadyPhase.completed
    assert completed.files_total == 3
    assert completed.files_applied == 3
    assert completed.files_version == 7
    assert completed.clear_apply_token is True
    assert completed.status_detail == "Ready"


def test_post_ready_patch_builders_capture_setup_status_decisions() -> None:
    starting = repo_setup_starting("apply-token")
    failed = repo_setup_start_failed("start failed")

    assert starting.phase == WorkspacePostReadyPhase.starting_setup
    assert starting.apply_token == "apply-token"
    assert starting.mark_started is True
    assert starting.clear_completed_at is True
    assert starting.status_detail == "Starting repo setup"
    assert failed.phase == WorkspacePostReadyPhase.failed
    assert failed.failed_error == "start failed"
    assert failed.clear_apply_token is True
    assert failed.mark_completed is True
    assert failed.status_detail == "Repo setup failed to start"


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
