from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.managed_sandboxes import (
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_ready,
)
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxHandle,
    SandboxProviderError,
    SandboxProviderKind,
    SandboxRuntimeContext,
)
from proliferate.server.cloud.errors import CloudApiError
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
        del sandbox, path, content

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
    monkeypatch.setattr(service, "get_configured_sandbox_provider", lambda: provider)

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
