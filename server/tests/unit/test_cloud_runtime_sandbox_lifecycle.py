from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from proliferate.integrations.sandbox import SandboxProviderKind
from proliferate.server.cloud.runtime.models import CloudProvisionInput
from proliferate.server.cloud.runtime.provisioning import sandbox_lifecycle


def _make_provision_input() -> CloudProvisionInput:
    return CloudProvisionInput(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        github_token="github-token",
        git_user_name="Cloud Tester",
        git_user_email="cloud-tester@example.com",
        anyharness_data_key="data-key",
        sandbox_profile_id=uuid.uuid4(),
        target_id=uuid.uuid4(),
        required_agent_auth_revision=1,
        agent_auth_agent_kinds=("claude",),
        repo_env_vars={},
    )


class _FakeDbSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def begin(self):
        return self


class _FakeTracker:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object, dict[str, object]]] = []

    def begin(self, step: object, **fields: object) -> None:
        self.calls.append(("begin", step, fields))

    def complete(self, **fields: object) -> None:
        self.calls.append(("complete", "", fields))


@pytest.mark.asyncio
async def test_create_and_connect_sandbox_binds_usage_before_connect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _make_provision_input()
    sandbox_record = SimpleNamespace(id=uuid.uuid4(), billing_subject_id=uuid.uuid4())
    calls: list[tuple[str, object]] = []

    class _Provider(SimpleNamespace):
        async def create_sandbox(self, *, metadata: dict[str, str]):
            calls.append(("create", metadata))
            return SimpleNamespace(
                provider=SandboxProviderKind.daytona,
                sandbox_id="sandbox-123",
                template_version="v1",
            )

        async def connect_running_sandbox(self, sandbox_id: str):
            calls.append(("connect", sandbox_id))
            return SimpleNamespace(remote="sandbox")

        async def resolve_runtime_context(self, sandbox: object):
            calls.append(("context", sandbox))
            return SimpleNamespace(runtime_workdir="/home/user/workspace")

        async def resolve_runtime_endpoint(self, sandbox: object):
            calls.append(("endpoint", sandbox))
            return SimpleNamespace(runtime_url="https://runtime.example")

    async def _bind_allocated_sandbox(
        _db: object, sandbox_id: uuid.UUID, **kwargs: object
    ) -> None:
        calls.append(("bind", {"sandbox_id": sandbox_id, **kwargs}))

    async def _record_cloud_sandbox_usage_started(**kwargs: object) -> None:
        calls.append(("usage_started", kwargs))

    async def _set_workspace_status(*args: object, **kwargs: object) -> None:
        calls.append(("status", {"args": args, **kwargs}))

    monkeypatch.setattr(
        sandbox_lifecycle.db_engine,
        "async_session_factory",
        lambda: _FakeDbSession(),
    )
    monkeypatch.setattr(sandbox_lifecycle, "bind_allocated_sandbox", _bind_allocated_sandbox)
    monkeypatch.setattr(
        sandbox_lifecycle,
        "record_cloud_sandbox_usage_started",
        _record_cloud_sandbox_usage_started,
    )

    result = await sandbox_lifecycle.create_and_connect_sandbox(
        _FakeTracker(),
        ctx,
        _Provider(kind=SandboxProviderKind.daytona, template_version="v1"),
        sandbox_record=sandbox_record,
        set_workspace_status=_set_workspace_status,
    )

    assert [name for name, _ in calls] == [
        "create",
        "bind",
        "usage_started",
        "status",
        "connect",
        "context",
        "endpoint",
    ]
    metadata = calls[0][1]
    assert metadata["target_id"] == str(ctx.target_id)
    assert calls[1][1]["status"] == "provisioning"
    assert calls[2][1]["opened_by"] == "provision"
    assert result.handle.sandbox_id == "sandbox-123"
    assert result.endpoint.runtime_url == "https://runtime.example"


@pytest.mark.asyncio
async def test_connect_existing_profile_sandbox_resumes_and_persists_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _make_provision_input()
    active_sandbox = SimpleNamespace(
        id=uuid.uuid4(),
        external_sandbox_id="sandbox-123",
        provider=SandboxProviderKind.daytona.value,
        template_version="template-v2",
    )
    runtime_access = SimpleNamespace(
        cloud_sandbox_id=active_sandbox.id,
        runtime_token_ciphertext="encrypted-runtime-token",
        anyharness_data_key_ciphertext="encrypted-data-key",
    )
    calls: list[tuple[str, object]] = []

    class _Provider(SimpleNamespace):
        async def get_sandbox_state(self, sandbox_id: str):
            calls.append(("state", sandbox_id))
            return SimpleNamespace(state="paused", started_at="started-at")

        async def resume_sandbox(self, sandbox_id: str):
            calls.append(("resume", sandbox_id))
            return SimpleNamespace(remote="sandbox")

        async def connect_running_sandbox(self, sandbox_id: str):
            calls.append(("connect", sandbox_id))
            return SimpleNamespace(remote="sandbox")

        async def resolve_runtime_context(self, sandbox: object):
            calls.append(("context", sandbox))
            return SimpleNamespace(runtime_workdir="/home/user/workspace")

        async def resolve_runtime_endpoint(self, sandbox: object):
            calls.append(("endpoint", sandbox))
            return SimpleNamespace(runtime_url="https://runtime.example")

    async def _load_active_sandbox_for_profile_target(_db: object, **kwargs: object):
        calls.append(("load_sandbox", kwargs))
        return active_sandbox

    async def _load_active_runtime_access_for_target(_db: object, **kwargs: object):
        calls.append(("load_access", kwargs))
        return runtime_access

    async def _mark_sandbox_running(sandbox_id: uuid.UUID, started_at: object) -> None:
        calls.append(("mark_running", {"sandbox_id": sandbox_id, "started_at": started_at}))

    async def _persist_target_runtime_access(*args: object, **kwargs: object) -> None:
        calls.append(("persist_access", kwargs))

    async def _save_runtime_environment_updates(
        runtime_environment_id: uuid.UUID, updates: dict[str, object]
    ) -> None:
        calls.append(
            (
                "save_runtime",
                {"runtime_environment_id": runtime_environment_id, "updates": updates},
            )
        )

    monkeypatch.setattr(
        sandbox_lifecycle.db_engine,
        "async_session_factory",
        lambda: _FakeDbSession(),
    )
    monkeypatch.setattr(
        sandbox_lifecycle.cloud_sandboxes,
        "load_active_sandbox_for_profile_target",
        _load_active_sandbox_for_profile_target,
    )
    monkeypatch.setattr(
        sandbox_lifecycle.targets_store,
        "load_active_runtime_access_for_target",
        _load_active_runtime_access_for_target,
    )
    monkeypatch.setattr(sandbox_lifecycle, "mark_sandbox_running", _mark_sandbox_running)
    monkeypatch.setattr(
        sandbox_lifecycle,
        "persist_target_runtime_access",
        _persist_target_runtime_access,
    )
    monkeypatch.setattr(
        sandbox_lifecycle,
        "save_runtime_environment_updates",
        _save_runtime_environment_updates,
    )
    monkeypatch.setattr(sandbox_lifecycle, "decrypt_text", lambda _value: "runtime-token")

    result = await sandbox_lifecycle.connect_existing_profile_sandbox(
        _FakeTracker(),
        ctx,
        _Provider(kind=SandboxProviderKind.daytona, template_version="v1"),
    )

    assert result is not None
    connected, sandbox_record_id, runtime_token = result
    assert sandbox_record_id == active_sandbox.id
    assert runtime_token == "runtime-token"
    assert connected.handle.template_version == "template-v2"
    assert ("resume", "sandbox-123") in calls
    assert not any(name == "connect" for name, _ in calls)
    assert ("mark_running", {"sandbox_id": active_sandbox.id, "started_at": "started-at"}) in calls
    persist_call = next(payload for name, payload in calls if name == "persist_access")
    assert persist_call["sandbox_record_id"] == active_sandbox.id
    assert persist_call["runtime_url"] == "https://runtime.example"
    save_call = next(payload for name, payload in calls if name == "save_runtime")
    assert save_call["updates"]["active_sandbox_id"] == active_sandbox.id
