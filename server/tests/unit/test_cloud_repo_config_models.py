from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from proliferate.server.cloud.repo_config.domain.status import (
    CloudRepoFileMetadataValue,
    CloudWorkspaceRepoConfigStatusValue,
    CloudWorkspaceSetupRunValue,
)
from proliferate.server.cloud.repo_config.models import (
    resync_cloud_workspace_files_payload,
    run_cloud_workspace_setup_payload,
    workspace_repo_config_status_payload,
)


def test_workspace_repo_config_status_payload_uses_transport_value() -> None:
    workspace_id = uuid4()
    applied_at = datetime(2026, 5, 9, 10, 30, tzinfo=UTC)
    file_updated_at = datetime(2026, 5, 9, 10, 0, tzinfo=UTC)
    value = CloudWorkspaceRepoConfigStatusValue(
        workspace_id=workspace_id,
        current_repo_files_version=3,
        repo_files_applied_version=2,
        repo_files_applied_at=applied_at,
        files_out_of_sync=True,
        tracked_files=(
            CloudRepoFileMetadataValue(
                relative_path="scripts/setup.sh",
                content_sha256="abc123",
                byte_size=42,
                updated_at=file_updated_at,
                last_synced_at=file_updated_at,
            ),
        ),
        env_var_keys=("API_BASE_URL",),
        post_ready_phase="applying_files",
        post_ready_files_total=4,
        post_ready_files_applied=2,
        post_ready_started_at=applied_at,
        post_ready_completed_at=None,
        last_apply_failed_path="scripts/setup.sh",
        last_apply_error="failed",
    )

    payload = workspace_repo_config_status_payload(value)

    assert payload.current_repo_files_version == 3
    assert payload.repo_files_applied_version == 2
    assert payload.repo_files_applied_at == applied_at.isoformat()
    assert payload.files_out_of_sync is True
    assert payload.env_var_keys == ["API_BASE_URL"]
    assert payload.tracked_files[0].relative_path == "scripts/setup.sh"
    assert payload.tracked_files[0].updated_at == file_updated_at.isoformat()
    assert payload.last_apply_failed_path == "scripts/setup.sh"
    assert payload.last_apply_error == "failed"

    resync_payload = resync_cloud_workspace_files_payload(value)
    assert resync_payload.workspace_id == str(workspace_id)
    assert resync_payload.current_repo_files_version == payload.current_repo_files_version


def test_run_cloud_workspace_setup_payload_uses_transport_value() -> None:
    workspace_id = uuid4()

    payload = run_cloud_workspace_setup_payload(
        CloudWorkspaceSetupRunValue(
            workspace_id=workspace_id,
            command="pnpm install",
            terminal_id="terminal-1",
            command_run_id="run-1",
            status="running",
        )
    )

    assert payload.workspace_id == str(workspace_id)
    assert payload.command == "pnpm install"
    assert payload.terminal_id == "terminal-1"
    assert payload.command_run_id == "run-1"
    assert payload.status == "running"
