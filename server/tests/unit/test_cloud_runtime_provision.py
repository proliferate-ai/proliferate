from __future__ import annotations

import hashlib
import shlex
import subprocess
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.cloud import AGENT_GATEWAY_CIPHERTEXT_KEY_ID
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store import cloud_workspaces, users
from proliferate.integrations.anyharness import ResolvedRemoteWorkspace
from proliferate.integrations.sandbox import SandboxProviderKind
from proliferate.server.cloud.agent_auth import session_loader as agent_auth_session_loader
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime import bootstrap as runtime_bootstrap
from proliferate.server.cloud.runtime import provision as runtime_provision
from proliferate.server.cloud.runtime import sandbox_exec as runtime_sandbox_exec
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.models import CloudProvisionInput
from proliferate.utils.crypto import encrypt_json


class TestCloudWorkerBaseUrl:
    def test_prefers_explicit_worker_base_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_worker_base_url",
            " https://worker.example.dev/ ",
        )
        monkeypatch.setattr(runtime_provision.settings, "api_base_url", "http://localhost:8076")
        monkeypatch.setattr(runtime_provision.settings, "cloud_mcp_oauth_callback_base_url", "")
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_mcp_oauth_callback_fallback_base_url",
            "http://localhost:8000",
        )

        assert runtime_provision._cloud_base_url() == "https://worker.example.dev"

    def test_rejects_local_only_worker_base_urls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(runtime_provision.settings, "cloud_worker_base_url", "")
        monkeypatch.setattr(runtime_provision.settings, "api_base_url", "http://localhost:8076")
        monkeypatch.setattr(runtime_provision.settings, "cloud_mcp_oauth_callback_base_url", "")
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_mcp_oauth_callback_fallback_base_url",
            "http://localhost:8000",
        )

        with pytest.raises(CloudApiError) as exc_info:
            runtime_provision._cloud_base_url()

        assert exc_info.value.code == "cloud_worker_base_url_required"
        assert exc_info.value.status_code == 400
        assert "CLOUD_WORKER_BASE_URL" in exc_info.value.message
        assert "API_BASE_URL=http://localhost:8076" in exc_info.value.message


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
    monkeypatch.setattr(
        agent_auth_session_loader.db_engine,
        "async_session_factory",
        factory,
    )
    monkeypatch.setattr(cloud_workspaces.db_engine, "async_session_factory", factory)
    monkeypatch.setattr(runtime_provision.db_engine, "async_session_factory", factory)
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
        _patched_session_factory,
    ) -> None:
        user = _make_user(email="missing-gh@example.com")
        db_session.add(user)
        await db_session.commit()

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
        profile = await agent_auth_store.ensure_personal_sandbox_profile(
            db_session,
            user_id=user.id,
            created_by_user_id=user.id,
        )
        credential = await agent_auth_store.create_agent_auth_credential(
            db_session,
            owner_scope="personal",
            owner_user_id=user.id,
            organization_id=None,
            created_by_user_id=user.id,
            agent_kind="claude",
            credential_kind="synced_path",
            display_name="Synced claude auth",
            redacted_summary_json='{"authMode":"file"}',
            status="ready",
            payload_ciphertext=encrypt_json(
                {
                    "provider": "claude",
                    "authMode": "file",
                    "files": {".claude.json": '{"apiKey":"sk-ant-test"}'},
                }
            ),
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        )
        await agent_auth_store.upsert_selection(
            db_session,
            sandbox_profile_id=profile.id,
            owner_scope="personal",
            agent_kind="claude",
            credential_id=credential.id,
            credential_share_id=None,
            materialization_mode="synced_files",
            selected_revision=credential.revision,
            status="active",
            last_error_code=None,
            last_error_message=None,
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
        assert result.sandbox_profile_id == profile.id
        assert result.required_agent_auth_revision == 0
        assert result.agent_auth_agent_kinds == ("claude",)


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
            runtime_provision.CloudWorkspaceStatus.materializing,
            detail="Checking template readiness",
        )

        assert persisted == [
            (
                workspace_id,
                runtime_provision.CloudWorkspaceStatus.materializing,
                "Checking template readiness",
            )
        ]
        assert logged == [
            (
                "cloud workspace status updated",
                {
                    "workspace_id": workspace_id,
                    "status": "materializing",
                    "detail": "Checking template readiness",
                },
            )
        ]


def _make_provision_input(*, codex_enabled: bool) -> CloudProvisionInput:
    sandbox_profile_id = uuid.uuid4()
    target_id = uuid.uuid4()
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
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        required_agent_auth_revision=1,
        agent_auth_agent_kinds=("claude", "codex") if codex_enabled else ("claude",),
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

        async def _check_runtime_bundle_preinstalled(*args, **kwargs) -> bool:
            calls.append("check_bundle")
            return True

        async def _check_node_runtime(*args, **kwargs) -> str:
            calls.append("check_node")
            return "22.15.0"

        async def _stage_runtime_bundle(*args, **kwargs) -> dict[str, Path]:
            calls.append("stage_binary")
            return {"anyharness": Path("/tmp/anyharness")}

        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(
            runtime_provision,
            "check_runtime_bundle_preinstalled",
            _check_runtime_bundle_preinstalled,
        )
        monkeypatch.setattr(runtime_provision, "stage_runtime_bundle", _stage_runtime_bundle)
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

        assert calls == ["check_bundle"]
        assert statuses == [
            "Using prebuilt runtime bundle",
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

        async def _check_runtime_bundle_preinstalled(*args, **kwargs) -> bool:
            calls.append("check_bundle")
            return False

        async def _check_node_runtime(*args, **kwargs) -> str:
            calls.append("check_node")
            return "22.15.0"

        async def _stage_runtime_bundle(*args, **kwargs) -> dict[str, Path]:
            calls.append("stage_binary")
            return {"anyharness": Path("/tmp/anyharness")}

        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _noop_status)
        monkeypatch.setattr(
            runtime_provision,
            "check_runtime_bundle_preinstalled",
            _check_runtime_bundle_preinstalled,
        )
        monkeypatch.setattr(runtime_provision, "stage_runtime_bundle", _stage_runtime_bundle)
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

        assert calls == ["check_bundle", "stage_binary", "check_node"]


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


class TestBuildSupervisorConfig:
    def test_supervisor_config_contains_runtime_worker_and_env(self) -> None:
        config = runtime_bootstrap.build_supervisor_config(
            SimpleNamespace(runtime_port=8457, runtime_endpoint_handles_cors=False),
            SimpleNamespace(
                home_dir="/home/user",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
            {"ANYHARNESS_BEARER_TOKEN": "token", "ANTHROPIC_API_KEY": "key"},
        )

        assert 'anyharness_binary = "/home/user/anyharness"' in config
        assert 'worker_binary = "/home/user/.proliferate/bin/proliferate-worker"' in config
        assert 'worker_config = "/home/user/.proliferate/worker/config.toml"' in config
        assert (
            'anyharness_args = ["serve", "--require-bearer-auth", "--host", '
            '"0.0.0.0", "--port", "8457"]'
        ) in config
        assert "[anyharness_env]" in config
        assert 'ANTHROPIC_API_KEY = "key"' in config
        assert 'ANYHARNESS_BEARER_TOKEN = "token"' in config
        assert 'HOME = "/home/user"' in config

    def test_supervisor_config_contains_target_sentry_env_when_configured(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(runtime_bootstrap.settings, "telemetry_mode", "hosted_product")
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_dsn",
            "https://target-sentry.example/123",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_environment",
            "production",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_release",
            "target@1.2.3",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_traces_sample_rate",
            0.5,
        )

        config = runtime_bootstrap.build_supervisor_config(
            SimpleNamespace(runtime_port=8457, runtime_endpoint_handles_cors=False),
            SimpleNamespace(
                home_dir="/home/user",
                runtime_binary_path="/home/user/anyharness",
                base_env={"HOME": "/home/user"},
            ),
            {"ANYHARNESS_BEARER_TOKEN": "token"},
        )

        assert "[process_env]" in config
        assert 'PROLIFERATE_TARGET_SENTRY_DSN = "https://target-sentry.example/123"' in config
        assert 'PROLIFERATE_TARGET_SENTRY_ENVIRONMENT = "production"' in config
        assert 'PROLIFERATE_TARGET_SENTRY_RELEASE = "target@1.2.3"' in config
        assert 'PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE = "0.5"' in config

    def test_redacted_supervisor_config_preview_hides_process_env(
        self,
        tmp_path: Path,
    ) -> None:
        config_path = tmp_path / "config.toml"
        config_path.write_text(
            "\n".join(
                [
                    'runtime_port = "8457"',
                    "",
                    "[anyharness_env]",
                    'ANYHARNESS_BEARER_TOKEN = "runtime-token"',
                    "",
                    "[process_env]",
                    'PROLIFERATE_TARGET_SENTRY_DSN = "https://target-sentry.example/123"',
                    'PROLIFERATE_TARGET_SENTRY_RELEASE = "target@1.2.3"',
                ]
            ),
            encoding="utf-8",
        )

        result = subprocess.run(
            runtime_sandbox_exec._redacted_supervisor_config_command(
                shlex.quote(str(config_path))
            ),
            shell=True,
            check=True,
            capture_output=True,
            text=True,
        )

        assert "runtime-token" not in result.stdout
        assert "target-sentry.example" not in result.stdout
        assert 'ANYHARNESS_BEARER_TOKEN = "<redacted>"' in result.stdout
        assert 'PROLIFERATE_TARGET_SENTRY_DSN = "<redacted>"' in result.stdout


class TestBuildDetachedSupervisorLaunchCommand:
    def test_launch_command_does_not_sleep_before_health_probe(self) -> None:
        command = runtime_bootstrap.build_detached_supervisor_launch_command(
            SimpleNamespace(home_dir="/home/user", runtime_binary_path="/home/user/anyharness")
        )

        expected = (
            "nohup /home/user/.proliferate/bin/proliferate-supervisor "
            "--config /home/user/.proliferate/supervisor/config.toml run"
        )
        assert expected in command
        assert "sleep 2" not in command

    def test_launch_command_exports_target_sentry_env_when_configured(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(runtime_bootstrap.settings, "telemetry_mode", "hosted_product")
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_dsn",
            "https://target-sentry.example/123",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_environment",
            "production",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_release",
            "target@1.2.3",
        )
        monkeypatch.setattr(
            runtime_bootstrap.settings,
            "cloud_target_sentry_traces_sample_rate",
            0.5,
        )

        command = runtime_bootstrap.build_detached_supervisor_launch_command(
            SimpleNamespace(home_dir="/home/user", runtime_binary_path="/home/user/anyharness")
        )

        assert "PROLIFERATE_TARGET_SENTRY_DSN=https://target-sentry.example/123" in command
        assert "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT=production" in command
        assert "PROLIFERATE_TARGET_SENTRY_RELEASE=target@1.2.3" in command
        assert "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE=0.5" in command


class TestLaunchAndConnectRuntime:
    @pytest.mark.asyncio
    async def test_launch_runtime_verifies_auth_after_health_before_reconcile(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        written_files: dict[str, str] = {}
        wait_kwargs: dict[str, object] = {}
        tracker = runtime_provision._StepTracker(workspace_id=uuid.uuid4())
        ctx = _make_provision_input(codex_enabled=True)
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_worker_base_url",
            "https://worker-control.invalid",
        )
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

        async def _write_file(_sandbox, path: str, content: str | bytes) -> None:
            calls.append("write_file")
            written_files[path] = content.decode() if isinstance(content, bytes) else content

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

        async def _wait_for_worker_target_online(target_id, **_kwargs) -> None:
            calls.append("wait_for_worker_target_online")
            assert target_id == enrollment_target_id
            assert _kwargs["workspace_id"] == ctx.workspace_id

        async def _reconcile_remote_agents(*_args, **_kwargs) -> list[str]:
            calls.append("reconcile_remote_agents")
            return ["claude", "codex"]

        async def _resolve_remote_workspace(*_args, **_kwargs) -> ResolvedRemoteWorkspace:
            calls.append("resolve_remote_workspace")
            return ResolvedRemoteWorkspace(workspace_id="workspace-123", repo_root_id="repo-1")

        async def _resolve_runtime_root_head_sha(*_args, **_kwargs) -> str:
            calls.append("resolve_runtime_root_head_sha")
            return "base-sha"

        async def _prepare_remote_mobility_destination(
            *_args, **_kwargs
        ) -> ResolvedRemoteWorkspace:
            calls.append("prepare_remote_mobility_destination")
            return ResolvedRemoteWorkspace(
                workspace_id="visible-workspace-123", repo_root_id="repo-1"
            )

        async def _set_workspace_status(*_args, **_kwargs) -> None:
            return None

        async def _sync_cloud_worktree_policy_to_runtime(*_args, **_kwargs) -> int:
            calls.append("sync_cloud_worktree_policy_to_runtime")
            assert _kwargs["run_deferred_startup_cleanup"] is True
            assert _kwargs["await_deferred_startup_cleanup"] is False
            return 20

        async def _request_agent_auth_refresh_and_wait(*_args, **_kwargs) -> None:
            calls.append("apply_agent_auth")

        async def _refresh_runtime_config_and_apply(*_args, **_kwargs) -> None:
            calls.append("apply_runtime_config")

        enrollment_target_id = uuid.uuid4()

        async def _ensure_runtime_target_enrollment(*_args, **_kwargs):
            calls.append("ensure_runtime_target_enrollment")
            return SimpleNamespace(target_id=enrollment_target_id, enrollment_token="enroll-token")

        provider.write_file = _write_file
        provider.resolve_runtime_endpoint = _resolve_runtime_endpoint

        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
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
        monkeypatch.setattr(
            runtime_provision,
            "_wait_for_worker_target_online",
            _wait_for_worker_target_online,
        )
        monkeypatch.setattr(runtime_provision, "reconcile_remote_agents", _reconcile_remote_agents)
        monkeypatch.setattr(
            runtime_provision, "resolve_remote_workspace", _resolve_remote_workspace
        )
        monkeypatch.setattr(
            runtime_provision,
            "resolve_runtime_root_head_sha",
            _resolve_runtime_root_head_sha,
        )
        monkeypatch.setattr(
            runtime_provision,
            "prepare_remote_mobility_destination",
            _prepare_remote_mobility_destination,
        )
        monkeypatch.setattr(
            runtime_provision,
            "sync_cloud_worktree_policy_to_runtime",
            _sync_cloud_worktree_policy_to_runtime,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_request_agent_auth_refresh_and_wait",
            _request_agent_auth_refresh_and_wait,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_refresh_runtime_config_and_apply",
            _refresh_runtime_config_and_apply,
        )
        monkeypatch.setattr(
            runtime_provision,
            "ensure_runtime_target_enrollment",
            _ensure_runtime_target_enrollment,
        )

        await runtime_provision._launch_and_connect_runtime(
            tracker,
            ctx,
            provider,
            connected,
            cloud_base_url="https://worker-control.invalid",
            cloud_sandbox_id=uuid.uuid4(),
            slot_generation=1,
        )

        assert calls == [
            "ensure_runtime_target_enrollment",
            "mkdir_runtime_bundle_config_dirs",
            "write_file",
            "write_file",
            "chmod_runtime_bundle_configs",
            "launch_runtime_supervisor",
            "resolve_runtime_endpoint",
            "wait_for_runtime_health",
            "verify_runtime_auth_enforced",
            "wait_for_worker_target_online",
            "apply_agent_auth",
            "apply_runtime_config",
            "sync_cloud_worktree_policy_to_runtime",
            "reconcile_remote_agents",
            "resolve_remote_workspace",
            "resolve_runtime_root_head_sha",
            "prepare_remote_mobility_destination",
        ]
        assert wait_kwargs["required_successes"] == 1
        assert wait_kwargs["delay_seconds"] == 0.5
        worker_config = written_files["/home/user/.proliferate/worker/config.toml"]
        assert 'cloud_base_url = "https://worker-control.invalid"' in worker_config
        assert 'anyharness_base_url = "http://127.0.0.1:8457"' in worker_config
        supervisor_config = written_files["/home/user/.proliferate/supervisor/config.toml"]
        assert 'anyharness_binary = "/home/user/anyharness"' in supervisor_config
        assert 'ANYHARNESS_BEARER_TOKEN = "' in supervisor_config


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
    async def test_provision_workspace_rejects_local_worker_base_url_before_allocating_sandbox(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ctx = _make_provision_input(codex_enabled=True)
        allocation_attempts: list[str] = []
        errors: list[str] = []
        provider = SimpleNamespace(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(allowed=True, message=None)

        async def _connect_existing_profile_slot(*args, **kwargs):
            return None

        async def _connect_existing_environment_sandbox(*args, **kwargs):
            return None

        async def _ensure_profile_slot(*args, **kwargs):
            allocation_attempts.append("ensure_profile_slot")
            return SimpleNamespace(id=uuid.uuid4(), slot_generation=1, external_sandbox_id=None)

        async def _mark_workspace_error_by_id(_workspace_id, message: str, **_kwargs):
            errors.append(message)

        async def _set_workspace_status(*args, **kwargs) -> None:
            return None

        monkeypatch.setattr(runtime_provision.settings, "cloud_worker_base_url", "")
        monkeypatch.setattr(runtime_provision.settings, "api_base_url", "http://localhost:8076")
        monkeypatch.setattr(runtime_provision.settings, "cloud_mcp_oauth_callback_base_url", "")
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_mcp_oauth_callback_fallback_base_url",
            "http://localhost:8000",
        )
        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "authorize_sandbox_start", _authorize_sandbox_start)
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_profile_slot",
            _connect_existing_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_environment_sandbox",
            _connect_existing_environment_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision.cloud_sandboxes,
            "ensure_profile_slot",
            _ensure_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "mark_workspace_error_by_id",
            _mark_workspace_error_by_id,
        )
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(runtime_provision, "log_cloud_event", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            runtime_provision,
            "_log_provision_summary",
            lambda *args, **kwargs: None,
        )

        with pytest.raises(CloudApiError) as exc_info:
            await runtime_provision.provision_workspace(ctx.workspace_id)

        assert exc_info.value.code == "cloud_worker_base_url_required"
        assert allocation_attempts == []
        assert errors == [exc_info.value.message]

    @pytest.mark.asyncio
    async def test_provision_workspace_configures_git_identity_after_checkout(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_worker_base_url",
            "https://worker-control.invalid",
        )
        calls: list[str] = []
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )
        sandbox_record = SimpleNamespace(id=uuid.uuid4(), slot_generation=1)
        slot_kwargs: dict[str, object] = {}
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
            root_anyharness_workspace_id="root-workspace-123",
            anyharness_repo_root_id="repo-root-123",
        )

        async def _noop_status(*args, **kwargs) -> None:
            return None

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _create_and_connect_sandbox(*args, **kwargs):
            return connected

        async def _connect_existing_environment_sandbox(*args, **kwargs):
            return None

        async def _connect_existing_profile_slot(*args, **kwargs):
            return None

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(allowed=True, message=None)

        async def _ensure_profile_slot(*args, **kwargs):
            slot_kwargs.update(kwargs)
            return sandbox_record

        async def _prepare_runtime_template(*args, **kwargs) -> None:
            calls.append("prepare_runtime_template")

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

        async def _save_runtime_environment_state(*args, **kwargs) -> None:
            return None

        async def _load_cloud_workspace_by_id(*args, **kwargs):
            return None

        async def _apply_workspace_repo_config_after_provision(*args, **kwargs) -> None:
            return None

        async def _save_runtime_environment_state(*args, **kwargs) -> None:
            return None

        async def _persist_target_runtime_access(*args, **kwargs) -> None:
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
            "_connect_existing_profile_slot",
            _connect_existing_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_environment_sandbox",
            _connect_existing_environment_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision,
            "authorize_sandbox_start",
            _authorize_sandbox_start,
        )
        monkeypatch.setattr(
            runtime_provision.cloud_sandboxes,
            "ensure_profile_slot",
            _ensure_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_prepare_runtime_template",
            _prepare_runtime_template,
        )
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
            "save_runtime_environment_state",
            _save_runtime_environment_state,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_persist_target_runtime_access",
            _persist_target_runtime_access,
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
        monkeypatch.setattr(
            runtime_provision,
            "save_runtime_environment_state",
            _save_runtime_environment_state,
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
            "clone_repository",
            "checkout_cloud_branch",
            "configure_git_identity",
            "launch_runtime",
            "finalize_workspace",
        ]
        assert slot_kwargs["status"] == "creating"

    @pytest.mark.asyncio
    async def test_provision_workspace_reuses_existing_runtime_without_relaunch(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[str] = []
        runtime_state_kwargs: list[dict[str, object]] = []
        ctx = _make_provision_input(codex_enabled=True)
        provider = SimpleNamespace(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )
        sandbox_record_id = uuid.uuid4()
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
            runtime_token="stored-runtime-token",
            ready_agents=["claude", "codex"],
            anyharness_workspace_id="workspace-123",
            root_anyharness_workspace_id="root-workspace-123",
            anyharness_repo_root_id="repo-root-123",
        )

        async def _noop_status(*args, **kwargs) -> None:
            return None

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _connect_existing_environment_sandbox(*args, **kwargs):
            calls.append("connect_existing_runtime")
            return connected, sandbox_record_id, 1, "stored-runtime-token"

        async def _connect_existing_profile_slot(*args, **kwargs):
            return None

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(allowed=True, message=None)

        async def _unexpected(*args, **kwargs):
            raise AssertionError("fresh sandbox/runtime path should not run")

        async def _attach_workspace_to_running_runtime(*args, runtime_token: str, **kwargs):
            calls.append(f"attach_workspace:{runtime_token}")
            return handshake

        async def _wait_for_worker_target_online(*args, **kwargs):
            calls.append("wait_worker_online")

        async def _request_agent_auth_refresh_and_wait(*args, **kwargs):
            calls.append("refresh_agent_auth")

        async def _refresh_runtime_config_and_apply(*args, **kwargs):
            calls.append("refresh_runtime_config")

        async def _finalize_workspace_provision_for_ids(*args, **kwargs) -> None:
            calls.append("finalize_workspace")

        async def _save_runtime_environment_state(*args, **kwargs) -> None:
            runtime_state_kwargs.append(kwargs)

        async def _load_cloud_workspace_by_id(*args, **kwargs):
            return None

        async def _apply_workspace_repo_config_after_provision(*args, **kwargs) -> None:
            return None

        async def _persist_target_runtime_access(*args, **kwargs) -> None:
            return None

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _noop_status)
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_profile_slot",
            _connect_existing_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_environment_sandbox",
            _connect_existing_environment_sandbox,
        )
        monkeypatch.setattr(runtime_provision, "authorize_sandbox_start", _authorize_sandbox_start)
        monkeypatch.setattr(runtime_provision, "_prepare_runtime_template", _unexpected)
        monkeypatch.setattr(runtime_provision, "clone_repository", _unexpected)
        monkeypatch.setattr(runtime_provision, "checkout_cloud_branch", _unexpected)
        monkeypatch.setattr(runtime_provision, "configure_git_identity", _unexpected)
        monkeypatch.setattr(runtime_provision, "_launch_and_connect_runtime", _unexpected)
        monkeypatch.setattr(
            runtime_provision,
            "_wait_for_worker_target_online",
            _wait_for_worker_target_online,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_request_agent_auth_refresh_and_wait",
            _request_agent_auth_refresh_and_wait,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_refresh_runtime_config_and_apply",
            _refresh_runtime_config_and_apply,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_attach_workspace_to_running_runtime",
            _attach_workspace_to_running_runtime,
        )
        monkeypatch.setattr(
            runtime_provision,
            "finalize_workspace_provision_for_ids",
            _finalize_workspace_provision_for_ids,
        )
        monkeypatch.setattr(
            runtime_provision,
            "save_runtime_environment_state",
            _save_runtime_environment_state,
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
        monkeypatch.setattr(
            runtime_provision,
            "_persist_target_runtime_access",
            _persist_target_runtime_access,
        )
        monkeypatch.setattr(runtime_provision, "log_cloud_event", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            runtime_provision,
            "_log_provision_summary",
            lambda *args, **kwargs: None,
        )

        await runtime_provision.provision_workspace(ctx.workspace_id)

        assert calls == [
            "connect_existing_runtime",
            "wait_worker_online",
            "refresh_agent_auth",
            "refresh_runtime_config",
            "attach_workspace:stored-runtime-token",
            "finalize_workspace",
        ]
        assert runtime_state_kwargs[-1]["increment_runtime_generation"] is False

    @pytest.mark.asyncio
    async def test_provision_workspace_blocks_when_authorization_denies_start(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        ctx = _make_provision_input(codex_enabled=True)
        errors: list[str] = []

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(
                allowed=False,
                message="Cloud usage is currently unavailable.",
            )

        provider = SimpleNamespace(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )

        async def _set_workspace_status(*args, **kwargs) -> None:
            return None

        async def _mark_workspace_error_by_id(
            _workspace_id,
            message: str,
            **_kwargs: object,
        ) -> None:
            errors.append(message)

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "authorize_sandbox_start", _authorize_sandbox_start)
        monkeypatch.setattr(
            runtime_provision,
            "mark_workspace_error_by_id",
            _mark_workspace_error_by_id,
        )
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(runtime_provision, "log_cloud_event", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            runtime_provision,
            "_log_provision_summary",
            lambda *args, **kwargs: None,
        )

        with pytest.raises(CloudApiError) as exc_info:
            await runtime_provision.provision_workspace(ctx.workspace_id)

        assert exc_info.value.code == "quota_exceeded"
        assert exc_info.value.message == "Cloud usage is currently unavailable."
        assert errors == ["Cloud usage is currently unavailable."]

    @pytest.mark.asyncio
    async def test_provision_workspace_cleans_up_new_sandbox_after_setup_failure(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_worker_base_url",
            "https://worker-control.invalid",
        )
        ctx = _make_provision_input(codex_enabled=True)
        sandbox_record = SimpleNamespace(
            id=uuid.uuid4(),
            external_sandbox_id=None,
            slot_generation=1,
        )
        connected = SimpleNamespace(
            handle=SimpleNamespace(
                sandbox_id="sandbox-provider-123",
                template_version="v1",
            ),
            sandbox=object(),
            endpoint=SimpleNamespace(runtime_url="https://runtime.invalid"),
        )
        destroyed: list[str] = []
        closed_usage: list[dict[str, object]] = []
        sandbox_statuses: list[tuple[object, str]] = []
        workspace_errors: list[dict[str, object]] = []

        class _Provider(SimpleNamespace):
            async def destroy_sandbox(self, sandbox_id: str) -> None:
                destroyed.append(sandbox_id)

        provider = _Provider(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(allowed=True, message=None)

        async def _connect_existing_environment_sandbox(*args, **kwargs):
            return None

        async def _connect_existing_profile_slot(*args, **kwargs):
            return None

        async def _ensure_profile_slot(*args, **kwargs):
            return sandbox_record

        async def _create_and_connect_sandbox(*args, **kwargs):
            return connected

        async def _prepare_runtime_template(*args, **kwargs) -> None:
            raise RuntimeError("template setup failed")

        async def _set_workspace_status(*args, **kwargs) -> None:
            return None

        async def _load_cloud_sandbox_by_id(_sandbox_id):
            return sandbox_record

        async def _close_usage_segment_for_sandbox(**kwargs):
            closed_usage.append(kwargs)

        async def _update_sandbox_status(sandbox, status: str, **_kwargs):
            sandbox_statuses.append((sandbox, status))

        async def _mark_workspace_error_by_id(_workspace_id, message: str, **kwargs):
            workspace_errors.append({"message": message, **kwargs})

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "authorize_sandbox_start", _authorize_sandbox_start)
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_profile_slot",
            _connect_existing_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_environment_sandbox",
            _connect_existing_environment_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision.cloud_sandboxes,
            "ensure_profile_slot",
            _ensure_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_create_and_connect_sandbox",
            _create_and_connect_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_prepare_runtime_template",
            _prepare_runtime_template,
        )
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(
            runtime_provision,
            "load_cloud_sandbox_by_id",
            _load_cloud_sandbox_by_id,
        )
        monkeypatch.setattr(
            runtime_provision,
            "close_usage_segment_for_sandbox",
            _close_usage_segment_for_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision,
            "update_sandbox_status",
            _update_sandbox_status,
        )
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

        with pytest.raises(RuntimeError, match="template setup failed"):
            await runtime_provision.provision_workspace(ctx.workspace_id)

        assert destroyed == ["sandbox-provider-123"]
        assert closed_usage == [
            {
                "sandbox_id": sandbox_record.id,
                "ended_at": closed_usage[0]["ended_at"],
                "closed_by": "provision_failure",
                "is_billable": False,
            }
        ]
        assert sandbox_statuses == [(sandbox_record, "destroyed")]
        assert workspace_errors == [
            {
                "message": "template setup failed",
                "clear_runtime_metadata": True,
                "clear_active_sandbox": True,
            }
        ]

    @pytest.mark.asyncio
    async def test_provision_workspace_preserves_unreusable_existing_profile_slot(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            runtime_provision.settings,
            "cloud_worker_base_url",
            "https://worker-control.invalid",
        )
        ctx = _make_provision_input(codex_enabled=True)
        sandbox_record = SimpleNamespace(
            id=uuid.uuid4(),
            external_sandbox_id="shared-slot-123",
            slot_generation=3,
        )
        destroyed: list[str] = []
        sandbox_statuses: list[tuple[object, str]] = []
        workspace_errors: list[dict[str, object]] = []

        class _Provider(SimpleNamespace):
            async def destroy_sandbox(self, sandbox_id: str) -> None:
                destroyed.append(sandbox_id)

        provider = _Provider(
            kind=SandboxProviderKind.daytona,
            template_version="v1",
        )

        async def _load_provision_input(_workspace_id, *, requested_base_sha=None):
            return ctx

        async def _authorize_sandbox_start(*args, **kwargs):
            return SimpleNamespace(allowed=True, message=None)

        async def _connect_existing_environment_sandbox(*args, **kwargs):
            return None

        async def _connect_existing_profile_slot(*args, **kwargs):
            return None

        async def _ensure_profile_slot(*args, **kwargs):
            return sandbox_record

        async def _unexpected_create(*args, **kwargs):
            raise AssertionError("fresh allocation must not overwrite an existing shared slot")

        async def _set_workspace_status(*args, **kwargs) -> None:
            return None

        async def _load_cloud_sandbox_by_id(_sandbox_id):
            return sandbox_record

        async def _update_sandbox_status(sandbox, status: str, **_kwargs):
            sandbox_statuses.append((sandbox, status))

        async def _mark_workspace_error_by_id(_workspace_id, message: str, **kwargs):
            workspace_errors.append({"message": message, **kwargs})

        monkeypatch.setattr(runtime_provision, "_load_provision_input", _load_provision_input)
        monkeypatch.setattr(runtime_provision, "get_configured_sandbox_provider", lambda: provider)
        monkeypatch.setattr(runtime_provision, "authorize_sandbox_start", _authorize_sandbox_start)
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_profile_slot",
            _connect_existing_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_connect_existing_environment_sandbox",
            _connect_existing_environment_sandbox,
        )
        monkeypatch.setattr(
            runtime_provision.cloud_sandboxes,
            "ensure_profile_slot",
            _ensure_profile_slot,
        )
        monkeypatch.setattr(
            runtime_provision,
            "_create_and_connect_sandbox",
            _unexpected_create,
        )
        monkeypatch.setattr(runtime_provision, "_set_workspace_status", _set_workspace_status)
        monkeypatch.setattr(
            runtime_provision,
            "load_cloud_sandbox_by_id",
            _load_cloud_sandbox_by_id,
        )
        monkeypatch.setattr(
            runtime_provision,
            "update_sandbox_status",
            _update_sandbox_status,
        )
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
            await runtime_provision.provision_workspace(ctx.workspace_id)

        assert exc_info.value.code == "cloud_slot_reuse_unavailable"
        assert destroyed == []
        assert sandbox_statuses == []
        assert workspace_errors == [
            {
                "message": "Existing managed cloud slot could not be reused safely.",
                "clear_runtime_metadata": True,
                "clear_active_sandbox": True,
            }
        ]
