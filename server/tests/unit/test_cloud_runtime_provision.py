from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.models.cloud import CloudCredential, CloudWorkspace
from proliferate.db.store import cloud_credentials, cloud_workspaces, users
from proliferate.integrations.sandbox import SandboxProviderKind
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime import bootstrap as runtime_bootstrap
from proliferate.server.cloud.runtime import provision as runtime_provision
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.credentials import (
    ClaudeProvisionCredential,
    CodexProvisionCredential,
    ProvisionCredentials,
)
from proliferate.server.cloud.runtime.models import CloudProvisionInput
from proliferate.utils.crypto import encrypt_json


def _make_user(*, email: str, display_name: str | None = "Cloud Tester") -> User:
    return User(
        email=email,
        hashed_password="hashed-password",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name=display_name,
    )


def _make_workspace(user_id: uuid.UUID) -> CloudWorkspace:
    return CloudWorkspace(
        user_id=user_id,
        billing_subject_id=user_id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        status="queued",
        status_detail="Queued",
        last_error=None,
        template_version="v1",
        runtime_generation=0,
    )


@pytest.fixture
def _patched_session_factory(monkeypatch: pytest.MonkeyPatch, test_engine) -> None:
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(cloud_credentials.db_engine, "async_session_factory", factory)
    monkeypatch.setattr(cloud_workspaces.db_engine, "async_session_factory", factory)
    monkeypatch.setattr(users.db_engine, "async_session_factory", factory)


class TestLoadProvisionInput:
    @pytest.mark.asyncio
    async def test_returns_none_when_workspace_missing(self, _patched_session_factory) -> None:
        result = await runtime_provision._load_provision_input(uuid.uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_workspace_user_missing(
        self,
        db_session,
        _patched_session_factory,
    ) -> None:
        workspace = _make_workspace(uuid.uuid4())
        db_session.add(workspace)
        await db_session.commit()

        result = await runtime_provision._load_provision_input(workspace.id)
        assert result is None

    @pytest.mark.asyncio
    async def test_raises_when_github_token_missing(
        self,
        db_session,
        monkeypatch: pytest.MonkeyPatch,
        _patched_session_factory,
    ) -> None:
        user = _make_user(email="missing-gh@example.com")
        db_session.add(user)
        await db_session.commit()

        class _GithubAccount:
            access_token = None

        monkeypatch.setattr(
            runtime_provision,
            "get_linked_github_account",
            lambda _user: _GithubAccount(),
        )

        workspace = _make_workspace(user.id)
        db_session.add(workspace)
        await db_session.commit()

        with pytest.raises(CloudApiError) as exc_info:
            await runtime_provision._load_provision_input(workspace.id)

        assert exc_info.value.code == "github_link_required"
        assert exc_info.value.status_code == 400
        assert exc_info.value.message == "Linked GitHub account is missing an access token."

    @pytest.mark.asyncio
    async def test_raises_when_supported_credentials_missing(
        self,
        db_session,
        _patched_session_factory,
    ) -> None:
        user = _make_user(email="missing-creds@example.com")
        db_session.add(user)
        await db_session.commit()

        db_session.add(
            OAuthAccount(
                user_id=user.id,
                oauth_name="github",
                access_token="github-token",
                account_id="gh-123",
                account_email="missing-creds@example.com",
            )
        )
        workspace = _make_workspace(user.id)
        db_session.add(workspace)
        await db_session.commit()

        with pytest.raises(CloudApiError) as exc_info:
            await runtime_provision._load_provision_input(workspace.id)

        assert exc_info.value.code == "missing_supported_credentials"
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_loads_provision_input_with_decrypted_supported_credentials(
        self,
        db_session,
        _patched_session_factory,
    ) -> None:
        user = _make_user(email="provision-input@example.com")
        db_session.add(user)
        await db_session.commit()

        db_session.add(
            OAuthAccount(
                user_id=user.id,
                oauth_name="github",
                access_token="github-token",
                account_id="gh-123",
                account_email="provision-input@example.com",
            )
        )
        workspace = _make_workspace(user.id)
        db_session.add(workspace)
        db_session.add(
            CloudCredential(
                user_id=user.id,
                provider="claude",
                auth_mode="env",
                payload_ciphertext=encrypt_json(
                    {
                        "authMode": "env",
                        "envVars": {"ANTHROPIC_API_KEY": "anthropic-key"},
                    }
                ),
                payload_format="json-v1",
            )
        )
        await db_session.commit()

        result = await runtime_provision._load_provision_input(workspace.id)

        assert result is not None
        assert result.workspace_id == workspace.id
        assert result.user_id == user.id
        assert result.github_token == "github-token"
        assert result.git_user_name == "Cloud Tester"
        assert result.git_user_email == "provision-input@example.com"
        assert len(result.anyharness_data_key) > 10
        assert result.credentials.synced_providers == ("claude",)
        assert result.credentials.claude == ClaudeProvisionCredential(api_key="anthropic-key")


class TestResolveGitIdentity:
    def test_prefers_github_account_email_and_display_name(self) -> None:
        git_user_name, git_user_email = runtime_provision._resolve_git_identity(
            _make_user(email="user@example.com", display_name="Cloud Tester"),
            SimpleNamespace(account_email="github@example.com"),
        )

        assert git_user_name == "Cloud Tester"
        assert git_user_email == "github@example.com"

    def test_falls_back_to_user_email_local_part_for_name(self) -> None:
        git_user_name, git_user_email = runtime_provision._resolve_git_identity(
            _make_user(email="fallback-name@example.com", display_name=""),
            SimpleNamespace(account_email=None),
        )

        assert git_user_name == "fallback-name"
        assert git_user_email == "fallback-name@example.com"

    def test_falls_back_to_default_name_when_email_has_no_local_part(self) -> None:
        git_user_name, git_user_email = runtime_provision._resolve_git_identity(
            _make_user(email="@example.com", display_name=None),
            SimpleNamespace(account_email=None),
        )

        assert git_user_name == "Proliferate User"
        assert git_user_email == "@example.com"

    def test_raises_when_no_usable_email_exists(self) -> None:
        with pytest.raises(CloudApiError) as exc_info:
            runtime_provision._resolve_git_identity(
                _make_user(email="", display_name=None),
                SimpleNamespace(account_email=None),
            )

        assert exc_info.value.code == "git_identity_required"
        assert exc_info.value.status_code == 400


class TestWorkspaceStatusLogging:
    @pytest.mark.asyncio
    async def test_set_workspace_status_persists_and_logs_resolved_detail(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        persisted: list[tuple[uuid.UUID, object, str]] = []
        logged: list[tuple[str, dict[str, object]]] = []
        workspace_id = uuid.uuid4()

        async def _update_workspace_status_by_id(
            _workspace_id: uuid.UUID,
            status: object,
            detail: str,
        ) -> None:
            persisted.append((_workspace_id, status, detail))

        monkeypatch.setattr(
            runtime_provision,
            "update_workspace_status_by_id",
            _update_workspace_status_by_id,
        )
        monkeypatch.setattr(
            runtime_provision,
            "log_cloud_event",
            lambda message, **fields: logged.append((message, fields)),
        )

        await runtime_provision._set_workspace_status(
            workspace_id,
            runtime_provision.WorkspaceStatus.provisioning,
            detail="Checking template readiness",
        )

        assert persisted == [
            (
                workspace_id,
                runtime_provision.WorkspaceStatus.provisioning,
                "Checking template readiness",
            )
        ]
        assert logged == [
            (
                "cloud workspace status updated",
                {
                    "workspace_id": workspace_id,
                    "status": "provisioning",
                    "detail": "Checking template readiness",
                },
            )
        ]


def _make_provision_input(*, codex_enabled: bool) -> CloudProvisionInput:
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
        anyharness_data_key=generate_anyharness_data_key(),
        credentials=ProvisionCredentials(
            claude=ClaudeProvisionCredential(api_key="anthropic-key"),
            codex=CodexProvisionCredential(auth_json="{}") if codex_enabled else None,
        ),
        repo_env_vars={},
    )


class TestPrepareRuntimeTemplate:
    @pytest.mark.asyncio
    async def test_preinstalled_template_uses_fast_path(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        statuses: list[str] = []

        async def _set_workspace_status(_workspace_id, _status, detail: str) -> None:
            statuses.append(detail)

        async def _check_binary_preinstalled(*args, **kwargs) -> bool:
            calls.append("check_binary")
            return True

        async def _check_node_runtime(*args, **kwargs) -> str:
            calls.append("check_node")
            return "22.15.0"

        async def _stage_runtime_binary(*args, **kwargs) -> Path:
            calls.append("stage_binary")
            return Path("/tmp/anyharness")

        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(
            runtime_provision,
            "check_binary_preinstalled",
            _check_binary_preinstalled,
        )
        monkeypatch.setattr(runtime_provision, "stage_runtime_binary", _stage_runtime_binary)
        monkeypatch.setattr(runtime_provision, "check_node_runtime", _check_node_runtime)

        tracker = runtime_provision._StepTracker(workspace_id=uuid.uuid4())
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace()
        connected = SimpleNamespace(
            sandbox=object(),
            runtime_context=SimpleNamespace(
                home_dir="/home/user",
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
        )

        await runtime_provision._prepare_runtime_template(tracker, ctx, provider, connected)

        assert calls == ["check_binary"]
        assert statuses == [
            "Using prebuilt AnyHarness binary",
            "Using prebuilt Node.js runtime",
        ]
        step_0 = runtime_provision.ProvisionStep.check_preinstalled_runtime
        assert tracker.metrics[0].step == step_0
        assert tracker.metrics[1].step == runtime_provision.ProvisionStep.stage_runtime_binary
        assert tracker.metrics[2].step == runtime_provision.ProvisionStep.check_node_runtime

    @pytest.mark.asyncio
    async def test_fallback_bootstrap_checks_and_stages_runtime(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []

        async def _noop_status(*args, **kwargs) -> None:
            return None

        async def _check_binary_preinstalled(*args, **kwargs) -> bool:
            calls.append("check_binary")
            return False

        async def _check_node_runtime(*args, **kwargs) -> str:
            calls.append("check_node")
            return "22.15.0"

        async def _stage_runtime_binary(*args, **kwargs) -> Path:
            calls.append("stage_binary")
            return Path("/tmp/anyharness")

        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _noop_status)
        monkeypatch.setattr(
            runtime_provision,
            "check_binary_preinstalled",
            _check_binary_preinstalled,
        )
        monkeypatch.setattr(runtime_provision, "stage_runtime_binary", _stage_runtime_binary)
        monkeypatch.setattr(runtime_provision, "check_node_runtime", _check_node_runtime)

        tracker = runtime_provision._StepTracker(workspace_id=uuid.uuid4())
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace()
        connected = SimpleNamespace(
            sandbox=object(),
            runtime_context=SimpleNamespace(
                home_dir="/home/user",
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
        )

        await runtime_provision._prepare_runtime_template(tracker, ctx, provider, connected)

        assert calls == ["check_binary", "stage_binary", "check_node"]


class TestCheckBinaryPreinstalled:
    @pytest.mark.asyncio
    async def test_returns_false_when_template_binary_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        binary_path = tmp_path / "anyharness"
        binary_path.write_bytes(b"current-runtime")

        calls: list[str] = []

        async def _run_sandbox_command_logged(*args, **kwargs):
            calls.append(kwargs["label"])
            return SimpleNamespace(exit_code=1, stdout="", stderr="")

        monkeypatch.setattr(
            runtime_bootstrap,
            "resolve_local_runtime_binary_path",
            lambda: binary_path,
        )
        monkeypatch.setattr(
            runtime_bootstrap,
            "run_sandbox_command_logged",
            _run_sandbox_command_logged,
        )

        result = await runtime_bootstrap.check_binary_preinstalled(
            SimpleNamespace(),
            object(),
            workspace_id=uuid.uuid4(),
            runtime_context=SimpleNamespace(runtime_binary_path="/home/user/anyharness"),
        )

        assert result is False
        assert calls == ["check_runtime_binary"]

    @pytest.mark.asyncio
    async def test_returns_true_when_template_binary_hash_matches(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        binary_path = tmp_path / "anyharness"
        binary_path.write_bytes(b"current-runtime")
        binary_hash = hashlib.sha256(binary_path.read_bytes()).hexdigest()

        calls: list[str] = []

        async def _run_sandbox_command_logged(*args, **kwargs):
            calls.append(kwargs["label"])
            if kwargs["label"] == "check_runtime_binary":
                return SimpleNamespace(exit_code=0, stdout="", stderr="")
            if kwargs["label"] == "check_runtime_binary_sha256":
                return SimpleNamespace(exit_code=0, stdout=f"{binary_hash}\n", stderr="")
            raise AssertionError(f"unexpected label: {kwargs['label']}")

        monkeypatch.setattr(
            runtime_bootstrap,
            "resolve_local_runtime_binary_path",
            lambda: binary_path,
        )
        monkeypatch.setattr(
            runtime_bootstrap,
            "run_sandbox_command_logged",
            _run_sandbox_command_logged,
        )

        result = await runtime_bootstrap.check_binary_preinstalled(
            SimpleNamespace(),
            object(),
            workspace_id=uuid.uuid4(),
            runtime_context=SimpleNamespace(runtime_binary_path="/home/user/anyharness"),
        )

        assert result is True
        assert calls == ["check_runtime_binary", "check_runtime_binary_sha256"]

    @pytest.mark.asyncio
    async def test_returns_true_when_template_binary_exists_without_local_binary(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []

        async def _run_sandbox_command_logged(*args, **kwargs):
            calls.append(kwargs["label"])
            if kwargs["label"] == "check_runtime_binary":
                return SimpleNamespace(exit_code=0, stdout="", stderr="")
            raise AssertionError(f"unexpected label: {kwargs['label']}")

        def _resolve_local_runtime_binary_path() -> Path:
            raise RuntimeError("missing local binary")

        monkeypatch.setattr(
            runtime_bootstrap,
            "resolve_local_runtime_binary_path",
            _resolve_local_runtime_binary_path,
        )
        monkeypatch.setattr(
            runtime_bootstrap,
            "run_sandbox_command_logged",
            _run_sandbox_command_logged,
        )

        result = await runtime_bootstrap.check_binary_preinstalled(
            SimpleNamespace(),
            object(),
            workspace_id=uuid.uuid4(),
            runtime_context=SimpleNamespace(runtime_binary_path="/home/user/anyharness"),
        )

        assert result is True
        assert calls == ["check_runtime_binary"]

    @pytest.mark.asyncio
    async def test_returns_false_when_template_binary_hash_differs(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        binary_path = tmp_path / "anyharness"
        binary_path.write_bytes(b"current-runtime")

        calls: list[str] = []

        async def _run_sandbox_command_logged(*args, **kwargs):
            calls.append(kwargs["label"])
            if kwargs["label"] == "check_runtime_binary":
                return SimpleNamespace(exit_code=0, stdout="", stderr="")
            if kwargs["label"] == "check_runtime_binary_sha256":
                return SimpleNamespace(exit_code=0, stdout="deadbeef\n", stderr="")
            raise AssertionError(f"unexpected label: {kwargs['label']}")

        monkeypatch.setattr(
            runtime_bootstrap,
            "resolve_local_runtime_binary_path",
            lambda: binary_path,
        )
        monkeypatch.setattr(
            runtime_bootstrap,
            "run_sandbox_command_logged",
            _run_sandbox_command_logged,
        )

        result = await runtime_bootstrap.check_binary_preinstalled(
            SimpleNamespace(),
            object(),
            workspace_id=uuid.uuid4(),
            runtime_context=SimpleNamespace(runtime_binary_path="/home/user/anyharness"),
        )

        assert result is False
        assert calls == ["check_runtime_binary", "check_runtime_binary_sha256"]


class TestBuildRuntimeLaunchScript:
    def test_daytona_launch_disables_runtime_cors(self) -> None:
        script = runtime_bootstrap.build_runtime_launch_script(
            SimpleNamespace(runtime_port=8457, runtime_endpoint_handles_cors=True),
            SimpleNamespace(
                runtime_workdir="/root/workspace",
                runtime_binary_path="/root/anyharness",
                base_env={"HOME": "/root"},
            ),
            {"ANYHARNESS_BEARER_TOKEN": "token"},
        )

        assert "serve --require-bearer-auth --disable-cors --host 0.0.0.0 --port 8457" in script

    def test_e2b_launch_keeps_runtime_cors_enabled(self) -> None:
        script = runtime_bootstrap.build_runtime_launch_script(
            SimpleNamespace(runtime_port=8457, runtime_endpoint_handles_cors=False),
            SimpleNamespace(
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
            {"ANYHARNESS_BEARER_TOKEN": "token"},
        )

        assert "serve --require-bearer-auth --host 0.0.0.0 --port 8457" in script
        assert "--disable-cors" not in script


class TestBuildDetachedRuntimeLaunchCommand:
    def test_launch_command_does_not_sleep_before_health_probe(self) -> None:
        command = runtime_provision.build_detached_runtime_launch_command(
            SimpleNamespace(home_dir="/home/user")
        )

        expected = "nohup /home/user/start-anyharness.sh"
        assert expected in command
        assert "sleep 2" not in command


class TestLaunchAndConnectRuntime:
    @pytest.mark.asyncio
    async def test_launch_runtime_verifies_auth_after_health_before_reconcile(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        wait_kwargs: dict[str, object] = {}
        tracker = runtime_provision._StepTracker(workspace_id=uuid.uuid4())
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace(
            write_file=None,
            resolve_runtime_endpoint=None,
            runtime_endpoint_handles_cors=False,
            runtime_port=8457,
        )
        connected = SimpleNamespace(
            handle=SimpleNamespace(sandbox_id="sandbox-123"),
            sandbox=object(),
            endpoint=SimpleNamespace(runtime_url="https://runtime.invalid"),
            runtime_context=SimpleNamespace(
                home_dir="/home/user",
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
        )

        async def _write_file(*_args, **_kwargs) -> None:
            calls.append("write_file")

        async def _run_sandbox_command_logged(*_args, **kwargs):
            calls.append(str(kwargs["label"]))
            return SimpleNamespace()

        async def _resolve_runtime_endpoint(_sandbox) -> SimpleNamespace:
            calls.append("resolve_runtime_endpoint")
            return SimpleNamespace(runtime_url="https://runtime.invalid")

        async def _wait_for_runtime_health(*_args, **_kwargs) -> None:
            calls.append("wait_for_runtime_health")
            wait_kwargs.update(_kwargs)

        async def _verify_runtime_auth_enforced(*_args, **_kwargs) -> None:
            calls.append("verify_runtime_auth_enforced")

        async def _reconcile_remote_agents(*_args, **_kwargs) -> list[str]:
            calls.append("reconcile_remote_agents")
            return ["claude", "codex"]

        async def _resolve_remote_workspace(*_args, **_kwargs) -> str:
            calls.append("resolve_remote_workspace")
            return "workspace-123"

        provider.write_file = _write_file
        provider.resolve_runtime_endpoint = _resolve_runtime_endpoint

        monkeypatch.setattr(
            runtime_provision, "run_sandbox_command_logged", _run_sandbox_command_logged
        )
        monkeypatch.setattr(
            runtime_provision, "assert_command_succeeded", lambda *_args, **_kwargs: None
        )
        monkeypatch.setattr(runtime_provision, "wait_for_runtime_health", _wait_for_runtime_health)
        monkeypatch.setattr(
            runtime_provision,
            "verify_runtime_auth_enforced",
            _verify_runtime_auth_enforced,
        )
        monkeypatch.setattr(runtime_provision, "reconcile_remote_agents", _reconcile_remote_agents)
        monkeypatch.setattr(
            runtime_provision, "resolve_remote_workspace", _resolve_remote_workspace
        )

        await runtime_provision._launch_and_connect_runtime(
            tracker,
            ctx,
            provider,
            connected,
        )

        assert calls == [
            "write_file",
            "chmod_runtime_launcher",
            "launch_runtime_nohup",
            "resolve_runtime_endpoint",
            "wait_for_runtime_health",
            "verify_runtime_auth_enforced",
            "reconcile_remote_agents",
            "resolve_remote_workspace",
        ]
        assert wait_kwargs["required_successes"] == 1
        assert wait_kwargs["delay_seconds"] == 0.5


class TestProvisionWorkspaceGitSetup:
    @pytest.mark.asyncio
    async def test_provision_workspace_marks_error_when_load_input_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        workspace_id = uuid.uuid4()
        errors: list[str] = []

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            raise CloudApiError(
                "git_identity_required",
                "A usable email address is required to configure cloud git commits.",
                status_code=400,
            )

        async def _mark_workspace_error_by_id(
            _workspace_id,
            message: str,
            **_kwargs: object,
        ) -> None:
            errors.append(message)

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(
            runtime_provision,
            "mark_workspace_error_by_id",
            _mark_workspace_error_by_id,
        )
        monkeypatch.setattr(runtime_provision, "log_cloud_event", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            runtime_provision,
            "_log_provision_summary",
            lambda *args, **kwargs: None,
        )

        with pytest.raises(CloudApiError) as exc_info:
            await runtime_provision.provision_workspace(workspace_id)

        assert exc_info.value.code == "git_identity_required"
        assert errors == ["A usable email address is required to configure cloud git commits."]

    @pytest.mark.asyncio
    async def test_provision_workspace_configures_git_identity_after_checkout(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )
        sandbox_record = SimpleNamespace(id=uuid.uuid4())
        connected = SimpleNamespace(
            handle=SimpleNamespace(
                sandbox_id="sandbox-123",
                provider=SimpleNamespace(value="daytona"),
                template_version="v1",
            ),
            sandbox=object(),
            endpoint=SimpleNamespace(runtime_url="https://runtime.example"),
            runtime_context=SimpleNamespace(runtime_workdir="/home/user/workspace"),
        )
        handshake = SimpleNamespace(
            runtime_token="runtime-token",
            ready_agents=["claude", "codex"],
            anyharness_workspace_id="workspace-123",
        )

        async def _noop_status(*args, **kwargs) -> None:
            return None

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _create_and_connect_sandbox(*args, **kwargs):
            return connected

        async def _create_and_attach_sandbox_for_workspace(*args, **kwargs):
            return sandbox_record

        async def _prepare_runtime_template(*args, **kwargs) -> None:
            calls.append("prepare_runtime_template")

        async def _write_credential_files(*args, **kwargs) -> None:
            calls.append("write_credential_files")

        async def _clone_repository(*args, **kwargs) -> None:
            calls.append("clone_repository")

        async def _checkout_cloud_branch(*args, **kwargs) -> None:
            calls.append("checkout_cloud_branch")

        async def _configure_git_identity(*args, **kwargs) -> None:
            calls.append("configure_git_identity")

        async def _launch_and_connect_runtime(*args, **kwargs):
            calls.append("launch_runtime")
            return connected, handshake

        async def _finalize_workspace_provision_for_ids(*args, **kwargs) -> None:
            calls.append("finalize_workspace")

        async def _load_cloud_workspace_by_id(*args, **kwargs):
            return None

        async def _apply_workspace_repo_config_after_provision(*args, **kwargs) -> None:
            return None

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _noop_status)
        monkeypatch.setattr(
            runtime_provision,
            "_create_and_connect_sandbox",
            _create_and_connect_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision,
            "create_and_attach_sandbox_for_workspace",
            _create_and_attach_sandbox_for_workspace,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_prepare_runtime_template",
            _prepare_runtime_template,
        )
        monkeypatch.setattr(runtime_provision, "write_credential_files", _write_credential_files)
        monkeypatch.setattr(runtime_provision, "clone_repository", _clone_repository)
        monkeypatch.setattr(runtime_provision, "checkout_cloud_branch", _checkout_cloud_branch)
        monkeypatch.setattr(runtime_provision, "configure_git_identity", _configure_git_identity)
        monkeypatch.setattr(
            runtime_provision,
            "_launch_and_connect_runtime",
            _launch_and_connect_runtime,
        )
        monkeypatch.setattr(
            runtime_provision,
            "finalize_workspace_provision_for_ids",
            _finalize_workspace_provision_for_ids,
        )
        monkeypatch.setattr(
            runtime_provision,
            "load_cloud_workspace_by_id",
            _load_cloud_workspace_by_id,
        )
        monkeypatch.setattr(
            runtime_provision,
            "apply_workspace_repo_config_after_provision",
            _apply_workspace_repo_config_after_provision,
        )
        monkeypatch.setattr(runtime_provision, "log_cloud_event", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            runtime_provision,
            "_log_provision_summary",
            lambda *args, **kwargs: None,
        )

        await runtime_provision.provision_workspace(ctx.workspace_id)

        assert calls == [
            "prepare_runtime_template",
            "write_credential_files",
            "clone_repository",
            "checkout_cloud_branch",
            "configure_git_identity",
            "launch_runtime",
            "finalize_workspace",
        ]
