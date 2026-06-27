from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.managed_sandboxes import (
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_ready,
)
from proliferate.integrations.anyharness import RemoteAgentAuthConfigApplyResult
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxHandle,
    SandboxProviderError,
    SandboxProviderKind,
    SandboxRuntimeContext,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.agent_auth.models import DesktopAgentAuthConfigApplyResponse
from proliferate.server.cloud.managed_sandboxes import service


async def _create_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"managed-sandbox-service-{uuid.uuid4().hex}@proliferate.dev",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


class _FakeSandboxProvider:
    kind = SandboxProviderKind.e2b
    template_version = "test-template-version"
    runtime_port = 8457
    runtime_endpoint_handles_cors = False
    runtime_workdir = "/home/user/workspace"
    runtime_binary_path = "/home/user/anyharness"
    user_home = "/home/user"
    preserves_processes_on_resume = True

    def __init__(self) -> None:
        self.create_calls = 0
        self.destroyed: list[str] = []
        self.writes: list[tuple[str, str]] = []

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> SandboxHandle:
        self.create_calls += 1
        return SandboxHandle(
            provider=SandboxProviderKind.e2b,
            sandbox_id="e2b-created-before-health-failure",
            template_version=self.template_version,
        )

    async def connect_running_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> object:
        del sandbox_id, timeout_seconds
        return object()

    async def resume_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> object:
        del sandbox_id, timeout_seconds
        return object()

    async def resolve_runtime_endpoint(self, sandbox: Any) -> RuntimeEndpoint:
        del sandbox
        return RuntimeEndpoint(runtime_url="https://runtime.example.invalid")

    async def resolve_runtime_context(self, sandbox: Any) -> SandboxRuntimeContext:
        del sandbox
        return SandboxRuntimeContext(
            home_dir="/home/user",
            runtime_workdir="/home/user/workspace",
            runtime_binary_path="/home/user/anyharness",
            base_env={"HOME": "/home/user"},
        )

    async def write_file(self, sandbox: Any, path: str, content: bytes | str) -> None:
        del sandbox
        self.writes.append((path, content.decode() if isinstance(content, bytes) else content))

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)


@pytest.mark.asyncio
async def test_ensure_persists_e2b_id_when_runtime_launch_fails(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    provider = _FakeSandboxProvider()
    monkeypatch.setattr(service.settings, "e2b_template_name", "test-template")
    _patch_supervised_runtime_launch_dependencies(monkeypatch)
    monkeypatch.setattr(service, "get_configured_sandbox_provider", lambda: provider)
    monkeypatch.setattr(service, "check_runtime_bundle_preinstalled", _async_return(True))

    async def _command_ok(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    async def _health_failed(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("health failed after provider create")

    monkeypatch.setattr(service, "run_sandbox_command_logged", _command_ok)
    monkeypatch.setattr(service, "wait_for_runtime_health", _health_failed)

    with pytest.raises(CloudApiError, match="health failed"):
        await service.ensure_managed_sandbox_ready(db_session, user)

    sandbox = await load_personal_managed_sandbox(db_session, user.id)
    assert sandbox is not None
    assert sandbox.status == "error"
    assert sandbox.e2b_sandbox_id == "e2b-created-before-health-failure"
    assert sandbox.last_error is not None


@pytest.mark.asyncio
async def test_destroy_failure_does_not_hide_live_provider_sandbox(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    billing_subject = await ensure_personal_billing_subject(db_session, user.id)
    sandbox = await ensure_personal_managed_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="test-template",
    )
    ready = await mark_managed_sandbox_ready(
        db_session,
        sandbox.id,
        e2b_sandbox_id="e2b-destroy-fails",
        e2b_template_ref="test-template",
        anyharness_base_url="https://runtime.example.invalid",
        anyharness_bearer_token_ciphertext="token",
        anyharness_data_key_ciphertext="data-key",
    )
    assert ready is not None

    class _FailingDestroyProvider(_FakeSandboxProvider):
        async def destroy_sandbox(self, sandbox_id: str) -> None:
            raise SandboxProviderError(f"could not destroy {sandbox_id}")

    monkeypatch.setattr(
        service,
        "get_configured_sandbox_provider",
        lambda: _FailingDestroyProvider(),
    )

    with pytest.raises(CloudApiError, match="could not destroy"):
        await service.destroy_managed_sandbox(db_session, user)

    loaded = await load_personal_managed_sandbox(db_session, user.id)
    assert loaded is not None
    assert loaded.status == "error"
    assert loaded.destroyed_at is None
    assert loaded.e2b_sandbox_id == "e2b-destroy-fails"


def _async_return(value: object):
    async def _inner(*_args: object, **_kwargs: object) -> object:
        return value

    return _inner


def _patch_supervised_runtime_launch_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        service,
        "cloud_worker_base_url",
        lambda: "https://worker-control.example.invalid",
    )

    async def _ensure_runtime_target_enrollment(*_args: object, **kwargs: object) -> object:
        return SimpleNamespace(
            target_id=kwargs["target_id"],
            enrollment_token="enrollment-token",
        )

    monkeypatch.setattr(
        service,
        "ensure_runtime_target_enrollment",
        _ensure_runtime_target_enrollment,
    )


@pytest.mark.asyncio
async def test_managed_runtime_stages_stale_bundle_before_launch(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    provider = _FakeSandboxProvider()
    calls: list[str] = []

    async def _command_ok(*_args: object, **kwargs: object) -> SimpleNamespace:
        calls.append(str(kwargs.get("label")))
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    async def _stage_bundle(*_args: object, **_kwargs: object) -> dict[str, object]:
        calls.append("stage_runtime_bundle")
        return {"anyharness": object(), "worker": object(), "supervisor": object()}

    monkeypatch.setattr(service.settings, "e2b_template_name", "test-template")
    _patch_supervised_runtime_launch_dependencies(monkeypatch)
    monkeypatch.setattr(service, "get_configured_sandbox_provider", lambda: provider)
    monkeypatch.setattr(service, "run_sandbox_command_logged", _command_ok)
    monkeypatch.setattr(service, "check_runtime_bundle_preinstalled", _async_return(False))
    monkeypatch.setattr(service, "stage_runtime_bundle", _stage_bundle)
    monkeypatch.setattr(service, "wait_for_runtime_health", _async_return(None))
    monkeypatch.setattr(service, "verify_runtime_auth_enforced", _async_return(None))
    monkeypatch.setattr(service, "_prepare_managed_runtime_integrations", _async_return(None))

    ready = await service.ensure_managed_sandbox_ready(db_session, user)

    assert ready.status == "ready"
    assert "managed_runtime_stop_previous" in calls
    assert "stage_runtime_bundle" in calls
    assert calls.index("managed_runtime_stop_previous") < calls.index("stage_runtime_bundle")
    assert calls.index("stage_runtime_bundle") < calls.index("managed_runtime_launch_supervisor")


@pytest.mark.asyncio
async def test_managed_runtime_launch_applies_target_auth_config_and_agents(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    provider = _FakeSandboxProvider()
    calls: list[tuple[str, object]] = []
    revision_id = uuid.uuid4()

    async def _command_ok(*_args: object, **kwargs: object) -> SimpleNamespace:
        calls.append(("command", kwargs.get("label")))
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    async def _selected_agent_kinds(*_args: object, **_kwargs: object) -> tuple[str, ...]:
        return ("claude",)

    async def _agent_auth_apply_request(*_args: object, **_kwargs: object):
        calls.append(("agent_auth_request", True))
        return DesktopAgentAuthConfigApplyResponse.model_validate(
            {
                "applyRequest": {
                    "externalAuthScope": {
                        "provider": "proliferate-cloud",
                        "id": "profile-id",
                        "targetId": "target-id",
                    },
                    "revision": 0,
                    "selections": [],
                },
                "syncedFiles": [
                    {
                        "relativePath": ".claude/cloud-auth.json",
                        "content": '{"ok":true}',
                    }
                ],
            }
        )

    async def _apply_agent_auth_config(
        runtime_url: str,
        access_token: str,
        body: dict[str, object],
    ) -> RemoteAgentAuthConfigApplyResult:
        calls.append(("agent_auth_apply", (runtime_url, bool(access_token), body)))
        return RemoteAgentAuthConfigApplyResult(
            applied=True,
            revision=int(body["revision"]),
            status="applied",
            selection_count=len(body.get("selections", [])),
        )

    async def _refresh_runtime_config(*_args: object, **_kwargs: object) -> SimpleNamespace:
        calls.append(("runtime_config_refresh", True))
        return SimpleNamespace(
            current_revision=SimpleNamespace(
                revision_id=str(revision_id),
                sequence=3,
            )
        )

    async def _runtime_config_body(*_args: object, **kwargs: object) -> dict[str, object]:
        calls.append(("runtime_config_body", True))
        calls.append(("runtime_config_source", kwargs.get("source")))
        return {"revision": {"id": str(revision_id), "sequence": 3}}

    async def _apply_runtime_config(
        runtime_url: str,
        access_token: str,
        body: dict[str, object],
        *,
        workspace_id: uuid.UUID | None = None,
    ) -> dict[str, object]:
        calls.append(
            ("runtime_config_apply", (runtime_url, bool(access_token), body, workspace_id))
        )
        return {"status": "applied", "applied": True}

    async def _reconcile_agents(
        runtime_url: str,
        access_token: str,
        *,
        workspace_id: uuid.UUID | None = None,
        required_agent_kinds: tuple[str, ...],
        auth_overlay_agent_kinds: tuple[str, ...],
    ) -> list[str]:
        calls.append(
            (
                "reconcile_agents",
                (
                    runtime_url,
                    bool(access_token),
                    workspace_id,
                    required_agent_kinds,
                    auth_overlay_agent_kinds,
                ),
            )
        )
        return list(required_agent_kinds)

    monkeypatch.setattr(service.settings, "e2b_template_name", "test-template")
    _patch_supervised_runtime_launch_dependencies(monkeypatch)
    monkeypatch.setattr(service, "get_configured_sandbox_provider", lambda: provider)
    monkeypatch.setattr(service, "run_sandbox_command_logged", _command_ok)
    monkeypatch.setattr(service, "check_runtime_bundle_preinstalled", _async_return(True))
    monkeypatch.setattr(service, "wait_for_runtime_health", _async_return(None))
    monkeypatch.setattr(service, "verify_runtime_auth_enforced", _async_return(None))
    monkeypatch.setattr(service, "selected_agent_auth_agent_kinds", _selected_agent_kinds)
    monkeypatch.setattr(
        service,
        "desktop_agent_auth_config_apply_request",
        _agent_auth_apply_request,
    )
    monkeypatch.setattr(service, "apply_agent_auth_config", _apply_agent_auth_config)
    monkeypatch.setattr(service, "runtime_config_fragment_for_profile", _async_return(None))
    monkeypatch.setattr(service, "refresh_profile_runtime_config", _refresh_runtime_config)
    monkeypatch.setattr(service, "runtime_config_apply_request_for_revision", _runtime_config_body)
    monkeypatch.setattr(service, "apply_remote_runtime_config", _apply_runtime_config)
    monkeypatch.setattr(service, "reconcile_remote_agents", _reconcile_agents)

    await service.ensure_managed_sandbox_ready(db_session, user)

    profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
    )
    assert profile.primary_target_id is not None

    worker_config = next(
        content
        for path, content in provider.writes
        if path.endswith("/.proliferate/worker/config.toml")
    )
    assert 'cloud_base_url = "https://worker-control.example.invalid"' in worker_config
    assert 'enrollment_token = "enrollment-token"' in worker_config
    supervisor_config = next(
        content
        for path, content in provider.writes
        if path.endswith("/.proliferate/supervisor/config.toml")
    )
    assert f'ANYHARNESS_RUNTIME_TARGET_ID = "{profile.primary_target_id}"' in supervisor_config
    assert (
        "/home/user/.claude/cloud-auth.json",
        '{"ok":true}',
    ) in provider.writes
    assert ("agent_auth_request", True) in calls
    assert any(name == "agent_auth_apply" for name, _payload in calls)
    assert ("runtime_config_source", "desktop") in calls
    assert any(name == "runtime_config_apply" for name, _payload in calls)
    assert any(
        name == "reconcile_agents" and payload[3] == ("claude",) and payload[4] == ("claude",)
        for name, payload in calls
    )


@pytest.mark.asyncio
async def test_provider_unavailable_error_is_retryable_and_cooldowned(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)

    class _UnavailableProvider(_FakeSandboxProvider):
        async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> SandboxHandle:
            self.create_calls += 1
            raise SandboxProviderError("503: b'no healthy upstream'")

    provider = _UnavailableProvider()
    monkeypatch.setattr(service.settings, "e2b_template_name", "test-template")
    monkeypatch.setattr(service, "get_configured_sandbox_provider", lambda: provider)
    monkeypatch.setattr(service, "_PROVIDER_UNAVAILABLE_COOLDOWN_SECONDS", 60)

    with pytest.raises(CloudApiError) as first_error:
        await service.ensure_managed_sandbox_ready(db_session, user)

    assert first_error.value.code == "managed_sandbox_provider_unavailable"
    assert first_error.value.status_code == 503
    assert first_error.value.headers["Retry-After"] == "60"
    assert provider.create_calls == 1

    sandbox = await load_personal_managed_sandbox(db_session, user.id)
    assert sandbox is not None
    assert sandbox.status == "error"
    assert sandbox.last_error == "503: b'no healthy upstream'"

    with pytest.raises(CloudApiError) as second_error:
        await service.ensure_managed_sandbox_ready(db_session, user)

    assert second_error.value.code == "managed_sandbox_provider_unavailable"
    assert second_error.value.status_code == 503
    assert 1 <= int(second_error.value.headers["Retry-After"]) <= 60
    assert provider.create_calls == 1
