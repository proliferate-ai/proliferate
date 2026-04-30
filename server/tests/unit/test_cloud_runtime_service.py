from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime import service as runtime_service


def _make_workspace() -> CloudWorkspace:
    user_id = uuid4()
    return CloudWorkspace(
        id=uuid4(),
        user_id=user_id,
        billing_subject_id=user_id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="cloud-branch",
        git_base_branch="main",
        status="ready",
        status_detail="Ready",
        last_error=None,
        template_version="v1",
        runtime_generation=1,
        active_sandbox_id=uuid4(),
        runtime_url="https://runtime.invalid",
        anyharness_workspace_id="workspace-123",
    )


async def _unblocked_billing_snapshot(_billing_subject_id) -> SimpleNamespace:
    return SimpleNamespace(billing_mode=BILLING_MODE_ENFORCE, active_spend_hold=False)


@pytest.mark.asyncio
async def test_sync_workspace_credentials_requires_runtime_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()

    async def _no_environment(_workspace: CloudWorkspace) -> None:
        return None

    monkeypatch.setattr(runtime_service, "load_runtime_environment_for_workspace", _no_environment)
    monkeypatch.setattr(
        runtime_service,
        "get_billing_snapshot_for_subject",
        _unblocked_billing_snapshot,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await runtime_service.sync_workspace_credentials(workspace)

    assert exc_info.value.code == "workspace_not_ready"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_sync_workspace_credentials_delegates_to_runtime_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()
    environment = SimpleNamespace(id=uuid4(), billing_subject_id=uuid4())
    calls: list[tuple[object, object, bool]] = []

    async def _environment(_workspace: CloudWorkspace) -> SimpleNamespace:
        return environment

    async def _ensure_current(
        runtime_environment_id: object,
        *,
        workspace_id: object,
        allow_process_restart: bool,
    ) -> None:
        calls.append((runtime_environment_id, workspace_id, allow_process_restart))

    monkeypatch.setattr(runtime_service, "load_runtime_environment_for_workspace", _environment)
    monkeypatch.setattr(
        runtime_service,
        "get_billing_snapshot_for_subject",
        _unblocked_billing_snapshot,
    )
    monkeypatch.setattr(
        runtime_service,
        "ensure_runtime_environment_credentials_current",
        _ensure_current,
    )

    await runtime_service.sync_workspace_credentials(workspace)

    assert calls == [(environment.id, workspace.id, True)]


@pytest.mark.asyncio
async def test_sync_workspace_credentials_propagates_freshness_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()
    environment = SimpleNamespace(id=uuid4(), billing_subject_id=uuid4())

    async def _environment(_workspace: CloudWorkspace) -> SimpleNamespace:
        return environment

    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("apply failed")

    monkeypatch.setattr(runtime_service, "load_runtime_environment_for_workspace", _environment)
    monkeypatch.setattr(
        runtime_service,
        "get_billing_snapshot_for_subject",
        _unblocked_billing_snapshot,
    )
    monkeypatch.setattr(
        runtime_service,
        "ensure_runtime_environment_credentials_current",
        _boom,
    )

    with pytest.raises(RuntimeError, match="apply failed"):
        await runtime_service.sync_workspace_credentials(workspace)
