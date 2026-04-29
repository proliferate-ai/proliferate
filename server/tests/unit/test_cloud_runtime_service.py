from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.integrations.sandbox.base import ProviderSandboxState
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime import service as runtime_service
from proliferate.utils.crypto import encrypt_text


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
        runtime_token_ciphertext=encrypt_text("runtime-token"),
        anyharness_workspace_id="workspace-123",
    )


class _FakeProvider:
    async def connect_running_sandbox(self, _sandbox_id: str) -> object:
        return object()

    async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
        return ProviderSandboxState(
            external_sandbox_id=sandbox_id,
            state="running",
            started_at=None,
            end_at=None,
            observed_at=datetime.now(UTC),
            metadata={},
        )

    async def resolve_runtime_context(self, _sandbox: object) -> SimpleNamespace:
        return SimpleNamespace(
            home_dir="/home/user",
            runtime_workdir="/home/user/workspace",
            runtime_binary_path="/home/user/anyharness",
            base_env={"HOME": "/home/user"},
        )


async def _unblocked_billing_snapshot(_billing_subject_id) -> SimpleNamespace:
    return SimpleNamespace(billing_mode=BILLING_MODE_ENFORCE, active_spend_hold=False)


@pytest.mark.asyncio
async def test_sync_workspace_credentials_requires_active_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()

    async def _no_sandbox(_workspace: CloudWorkspace) -> None:
        return None

    monkeypatch.setattr(runtime_service, "load_active_sandbox_for_workspace", _no_sandbox)
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
async def test_sync_workspace_credentials_swallows_reconcile_failure_after_file_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()
    calls: list[str] = []

    async def _load_active_sandbox(_workspace: CloudWorkspace) -> SimpleNamespace:
        return SimpleNamespace(provider="e2b", external_sandbox_id="sandbox-123")

    async def _ensure_ready(_workspace: CloudWorkspace, **_kwargs: object) -> str:
        calls.append("ensure")
        return "https://runtime.invalid"

    async def _write_files(_provider: object, _sandbox: object, **_kwargs: object) -> None:
        calls.append("write")

    async def _reconcile(*_args: object, **_kwargs: object) -> None:
        calls.append("reconcile")
        raise RuntimeError("codex install failed")

    async def _payloads(_user_id) -> dict[str, object]:
        return {
            "codex": {
                "authMode": "file",
                "files": {".codex/auth.json": '{"access_token":"opaque"}'},
            }
        }

    monkeypatch.setattr(runtime_service, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(
        runtime_service,
        "get_billing_snapshot_for_subject",
        _unblocked_billing_snapshot,
    )
    monkeypatch.setattr(runtime_service, "get_sandbox_provider", lambda _kind: _FakeProvider())
    monkeypatch.setattr(runtime_service, "load_active_cloud_credential_payloads", _payloads)
    monkeypatch.setattr(runtime_service, "ensure_workspace_runtime_ready", _ensure_ready)
    monkeypatch.setattr(runtime_service, "write_credential_files", _write_files)
    monkeypatch.setattr(runtime_service, "reconcile_remote_agents", _reconcile)

    await runtime_service.sync_workspace_credentials(workspace)

    assert calls == ["ensure", "write", "reconcile"]


@pytest.mark.asyncio
async def test_sync_workspace_credentials_still_fails_when_file_write_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()

    async def _load_active_sandbox(_workspace: CloudWorkspace) -> SimpleNamespace:
        return SimpleNamespace(provider="e2b", external_sandbox_id="sandbox-123")

    async def _boom(_provider: object, _sandbox: object, **_kwargs: object) -> None:
        raise RuntimeError("write failed")

    async def _payloads(_user_id) -> dict[str, object]:
        return {
            "codex": {
                "authMode": "file",
                "files": {".codex/auth.json": '{"access_token":"opaque"}'},
            }
        }

    async def _ensure_ready(_workspace: CloudWorkspace, **_kwargs: object) -> str:
        return "https://runtime.invalid"

    monkeypatch.setattr(runtime_service, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(
        runtime_service,
        "get_billing_snapshot_for_subject",
        _unblocked_billing_snapshot,
    )
    monkeypatch.setattr(runtime_service, "get_sandbox_provider", lambda _kind: _FakeProvider())
    monkeypatch.setattr(runtime_service, "load_active_cloud_credential_payloads", _payloads)
    monkeypatch.setattr(runtime_service, "ensure_workspace_runtime_ready", _ensure_ready)
    monkeypatch.setattr(runtime_service, "write_credential_files", _boom)

    with pytest.raises(RuntimeError, match="write failed"):
        await runtime_service.sync_workspace_credentials(workspace)
