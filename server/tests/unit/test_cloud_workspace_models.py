import uuid

import pytest

from proliferate.db.models.cloud import CloudWorkspace
from proliferate.server.cloud.workspaces import models as workspace_models
from proliferate.server.cloud.workspaces.models import workspace_summary_payload


def _workspace(*, origin_json: str | None) -> CloudWorkspace:
    return CloudWorkspace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        billing_subject_id=uuid.uuid4(),
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="cloud-branch",
        git_base_branch="main",
        origin_json=origin_json,
        status="queued",
        status_detail="Queued",
        last_error=None,
        template_version="v1",
        runtime_generation=0,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        repo_post_ready_started_at=None,
        repo_post_ready_completed_at=None,
        repo_files_last_failed_path=None,
    )


def test_workspace_summary_projects_origin_when_present() -> None:
    payload = workspace_summary_payload(
        _workspace(origin_json='{"kind":"human","entrypoint":"cloud"}')
    )

    assert payload.origin is not None
    assert payload.origin.model_dump() == {"kind": "human", "entrypoint": "cloud"}


def test_workspace_summary_keeps_null_origin_for_legacy_rows() -> None:
    payload = workspace_summary_payload(_workspace(origin_json=None))

    assert payload.origin is None
    assert payload.creator_context is None


def test_workspace_summary_projects_creator_context_when_present() -> None:
    payload = workspace_summary_payload(
        _workspace(origin_json='{"kind":"system","entrypoint":"cloud"}'),
        creator_context=workspace_models.WorkspaceCreatorContext(
            kind="automation",
            automation_id="automation-1",
            automation_run_id="run-1",
            label="Daily Check",
        ),
    )

    assert payload.creator_context is not None
    assert payload.creator_context.model_dump() == {
        "kind": "automation",
        "automation_id": "automation-1",
        "automation_run_id": "run-1",
        "source_session_id": None,
        "source_session_workspace_id": None,
        "session_link_id": None,
        "source_workspace_id": None,
        "label": "Daily Check",
    }


def test_workspace_summary_drops_malformed_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    warnings: list[tuple[str, dict[str, object]]] = []

    def _capture_warning(message: str, **kwargs: object) -> None:
        warnings.append((message, kwargs))

    monkeypatch.setattr(workspace_models.logger, "warning", _capture_warning)

    workspace = _workspace(origin_json='{"kind":"automation","entrypoint":"cloud"}')
    payload = workspace_summary_payload(workspace)

    assert payload.origin is None
    assert warnings[0][0] == "invalid cloud workspace origin JSON"
    assert warnings[0][1]["extra"]["table"] == "cloud_workspace"
    assert warnings[0][1]["extra"]["row_id"] == str(workspace.id)
