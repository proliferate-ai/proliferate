"""Daytona-backed sandbox provider."""

from __future__ import annotations

import asyncio
import logging
import shlex
import tempfile
import time
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

import urllib3

from proliferate.config import settings
from proliferate.constants.sandbox.daytona import (
    DAYTONA_AUTO_ARCHIVE_INTERVAL_MINUTES,
    DAYTONA_AUTO_DELETE_INTERVAL_MINUTES,
    DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
    DAYTONA_CREATE_TIMEOUT_SECONDS,
    DAYTONA_DELETE_TIMEOUT_SECONDS,
    DAYTONA_RUNTIME_BINARY_PATH,
    DAYTONA_RUNTIME_PORT,
    DAYTONA_RUNTIME_WORKDIR,
    DAYTONA_START_TIMEOUT_SECONDS,
    DAYTONA_STOP_TIMEOUT_SECONDS,
    DAYTONA_TEMPLATE_NAME,
    DAYTONA_TEMPLATE_VERSION,
    DAYTONA_USER_HOME,
)
from proliferate.integrations.sandbox.base import (
    ProviderSandboxState,
    RuntimeEndpoint,
    SandboxHandle,
    SandboxProviderKind,
    SandboxRuntimeContext,
)
from proliferate.server.billing.models import utcnow

logger = logging.getLogger("proliferate.cloud.daytona")

# Daytona currently caps signed preview URLs at 24 hours.
_SIGNED_PREVIEW_URL_LIFETIME_SECONDS = 24 * 60 * 60
_DAYTONA_CONNECT_RETRY_ATTEMPTS = 5
_DAYTONA_CONNECT_RETRY_BACKOFF_SECONDS = 0.5


class DaytonaRuntimeError(RuntimeError):
    pass


def _load_sdk() -> Any:
    try:
        from daytona import Daytona, DaytonaConfig  # type: ignore[import-untyped]
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise DaytonaRuntimeError(
            "Daytona SDK is not installed in this environment. "
            "Install the server dependencies to enable Daytona cloud provisioning."
        ) from exc
    return Daytona, DaytonaConfig


def _normalize_state(value: object) -> str:
    raw = str(value or "").strip().lower()
    if "." in raw:
        return raw.rsplit(".", 1)[-1]
    return raw


def _build_daytona_connect_retry() -> urllib3.Retry:
    return urllib3.Retry(
        total=_DAYTONA_CONNECT_RETRY_ATTEMPTS,
        connect=_DAYTONA_CONNECT_RETRY_ATTEMPTS,
        read=0,
        status=0,
        other=0,
        redirect=0,
        allowed_methods=None,
        backoff_factor=_DAYTONA_CONNECT_RETRY_BACKOFF_SECONDS,
        respect_retry_after_header=False,
    )


def _configure_generated_api_client_connect_retries(api_client: Any) -> None:
    if api_client is None:
        return
    configuration = getattr(api_client, "configuration", None)
    rest_client = getattr(api_client, "rest_client", None)
    if configuration is None or rest_client is None:
        return
    configuration.retries = _build_daytona_connect_retry()
    api_client.rest_client = type(rest_client)(configuration)


def _configure_daytona_client_connect_retries(client: Any) -> Any:
    _configure_generated_api_client_connect_retries(getattr(client, "_api_client", None))
    _configure_generated_api_client_connect_retries(getattr(client, "_toolbox_api_client", None))
    return client


class DaytonaSandboxProvider:
    @property
    def kind(self) -> SandboxProviderKind:
        return SandboxProviderKind.daytona

    @property
    def template_version(self) -> str:
        return DAYTONA_TEMPLATE_VERSION

    @property
    def preserves_processes_on_resume(self) -> bool:
        return False

    @property
    def runtime_endpoint_handles_cors(self) -> bool:
        return True

    @property
    def runtime_workdir(self) -> str:
        return DAYTONA_RUNTIME_WORKDIR

    @property
    def runtime_binary_path(self) -> str:
        return DAYTONA_RUNTIME_BINARY_PATH

    @property
    def user_home(self) -> str:
        return DAYTONA_USER_HOME

    @property
    def runtime_port(self) -> int:
        return DAYTONA_RUNTIME_PORT

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> SandboxHandle:
        return await asyncio.to_thread(self._create_sandbox, metadata)

    async def connect_running_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any:
        del timeout_seconds
        return await asyncio.to_thread(self._connect_running, sandbox_id)

    async def resume_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any:
        return await asyncio.to_thread(self._resume_sandbox, sandbox_id, timeout_seconds)

    async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState | None:
        return await asyncio.to_thread(self._get_sandbox_state, sandbox_id)

    async def list_sandbox_states(self) -> list[ProviderSandboxState]:
        raise DaytonaRuntimeError("Daytona does not support batch sandbox observation in v1.")

    async def resolve_runtime_endpoint(self, sandbox: Any) -> RuntimeEndpoint:
        return await asyncio.to_thread(self._resolve_runtime_endpoint, sandbox)

    async def resolve_runtime_context(self, sandbox: Any) -> SandboxRuntimeContext:
        return await asyncio.to_thread(self._resolve_runtime_context, sandbox)

    async def pause_sandbox(self, sandbox_id: str) -> None:
        await asyncio.to_thread(self._pause_sandbox, sandbox_id)

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        await asyncio.to_thread(self._destroy_sandbox, sandbox_id)

    async def run_command(
        self,
        sandbox: Any,
        command: str,
        *,
        user: str | None = None,
        cwd: str | None = None,
        envs: dict[str, str] | None = None,
        background: bool = False,
        timeout_seconds: int | None = None,
    ) -> Any:
        return await asyncio.to_thread(
            self._run_command,
            sandbox,
            command,
            user,
            cwd,
            envs,
            background,
            timeout_seconds,
        )

    async def write_file(self, sandbox: Any, path: str, content: bytes | str) -> None:
        await asyncio.to_thread(self._write_file, sandbox, path, content)

    def _require_api_key(self) -> str:
        if not settings.daytona_api_key:
            raise DaytonaRuntimeError(
                "Daytona is not configured for this server. Set DAYTONA_API_KEY "
                "in server/.env or server/.env.local."
            )
        return settings.daytona_api_key

    def _get_client(self) -> Any:
        Daytona, DaytonaConfig = _load_sdk()
        config = DaytonaConfig(
            api_key=self._require_api_key(),
            api_url=settings.daytona_server_url,
            target=settings.daytona_target,
        )
        return _configure_daytona_client_connect_retries(Daytona(config))

    def _coerce_datetime(self, value: object) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None

    def _build_create_params(self, sdk: Any, metadata: dict[str, str] | None) -> Any:
        params_type = getattr(sdk, "CreateSandboxFromImageParams", None)
        if params_type is None:
            schemas = getattr(sdk, "schemas", None)
            params_type = getattr(schemas, "CreateSandboxFromImageParams", None)
        if params_type is None:
            raise DaytonaRuntimeError("Daytona SDK does not expose CreateSandboxFromImageParams.")
        return params_type(
            image=DAYTONA_TEMPLATE_NAME,
            auto_stop_interval=DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
            auto_archive_interval=DAYTONA_AUTO_ARCHIVE_INTERVAL_MINUTES,
            auto_delete_interval=DAYTONA_AUTO_DELETE_INTERVAL_MINUTES,
            labels=metadata or {},
        )

    def _create_sandbox(self, metadata: dict[str, str] | None) -> SandboxHandle:
        create_started = time.perf_counter()
        logger.info(
            "daytona sandbox create started template=%s",
            DAYTONA_TEMPLATE_NAME,
        )
        client = self._get_client()
        sdk = __import__("daytona")
        sandbox = client.create(
            self._build_create_params(sdk, metadata),
            timeout=DAYTONA_CREATE_TIMEOUT_SECONDS,
        )
        sandbox_id = getattr(sandbox, "id", None)
        if not sandbox_id:
            raise DaytonaRuntimeError("Daytona sandbox create did not return an id")
        logger.info(
            "daytona sandbox create finished sandbox_id=%s elapsed_ms=%s",
            sandbox_id,
            int((time.perf_counter() - create_started) * 1000),
        )
        return SandboxHandle(
            provider=self.kind,
            sandbox_id=str(sandbox_id),
            template_version=self.template_version,
        )

    def _connect_running(self, sandbox_id: str) -> Any:
        connect_started = time.perf_counter()
        logger.info("daytona sandbox connect started sandbox_id=%s", sandbox_id)
        client = self._get_client()
        sandbox = client.get(sandbox_id)
        state = _normalize_state(getattr(sandbox, "state", ""))
        if state != "started":
            raise DaytonaRuntimeError("Daytona sandbox is not currently running.")
        logger.info(
            "daytona sandbox connect finished sandbox_id=%s elapsed_ms=%s",
            sandbox_id,
            int((time.perf_counter() - connect_started) * 1000),
        )
        return sandbox

    def _resume_sandbox(self, sandbox_id: str, timeout_seconds: int | None = None) -> Any:
        sandbox = self._get_client().get(sandbox_id)
        sandbox.start(timeout=timeout_seconds or DAYTONA_START_TIMEOUT_SECONDS)
        refresh_data = getattr(sandbox, "refresh_data", None)
        if callable(refresh_data):
            refresh_data()
        return sandbox

    def _get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState | None:
        sandbox = self._get_client().get(sandbox_id)
        state = _normalize_state(getattr(sandbox, "state", ""))
        if not state:
            return None
        metadata = getattr(sandbox, "labels", None)
        normalized_metadata = (
            {str(key): str(value) for key, value in metadata.items()}
            if isinstance(metadata, dict)
            else {}
        )
        return ProviderSandboxState(
            external_sandbox_id=str(sandbox_id),
            state=state,
            started_at=self._coerce_datetime(getattr(sandbox, "started_at", None)),
            end_at=self._coerce_datetime(getattr(sandbox, "end_at", None)),
            observed_at=utcnow(),
            metadata=normalized_metadata,
        )

    def _resolve_runtime_endpoint(self, sandbox: Any) -> RuntimeEndpoint:
        create_signed_preview_url = getattr(sandbox, "create_signed_preview_url", None)
        get_signed_preview_url = getattr(sandbox, "get_signed_preview_url", None)
        preview_fn = create_signed_preview_url or get_signed_preview_url
        if preview_fn is None:
            raise DaytonaRuntimeError(
                "Daytona sandbox object does not expose a signed preview URL method."
            )
        preview_info = preview_fn(
            self.runtime_port,
            expires_in_seconds=_SIGNED_PREVIEW_URL_LIFETIME_SECONDS,
        )
        runtime_url = getattr(preview_info, "url", None) or str(preview_info)
        if not runtime_url:
            raise DaytonaRuntimeError("Daytona signed preview URL response was empty.")
        return RuntimeEndpoint(runtime_url=str(runtime_url))

    def _resolve_runtime_context(self, sandbox: Any) -> SandboxRuntimeContext:
        effective_home = self._detect_effective_home(sandbox)
        configured_home = self.user_home
        home_dir = (
            configured_home if self._directory_exists(sandbox, configured_home) else effective_home
        )
        workdir_name = PurePosixPath(self.runtime_workdir).name
        binary_name = PurePosixPath(self.runtime_binary_path).name
        return SandboxRuntimeContext(
            home_dir=home_dir,
            runtime_workdir=str(PurePosixPath(home_dir) / workdir_name),
            runtime_binary_path=str(PurePosixPath(home_dir) / binary_name),
            base_env={"HOME": home_dir},
        )

    def _pause_sandbox(self, sandbox_id: str) -> None:
        sandbox = self._get_client().get(sandbox_id)
        sandbox.stop(timeout=DAYTONA_STOP_TIMEOUT_SECONDS)

    def _destroy_sandbox(self, sandbox_id: str) -> None:
        client = self._get_client()
        sandbox = client.get(sandbox_id)
        delete_fn = getattr(sandbox, "delete", None)
        if callable(delete_fn):
            delete_fn(timeout=DAYTONA_DELETE_TIMEOUT_SECONDS)
            return
        client.delete(sandbox, timeout=DAYTONA_DELETE_TIMEOUT_SECONDS)

    def _run_command(
        self,
        sandbox: Any,
        command: str,
        user: str | None,
        cwd: str | None,
        envs: dict[str, str] | None,
        background: bool,
        timeout_seconds: int | None,
    ) -> Any:
        process = getattr(sandbox, "process", None)
        if process is None or not hasattr(process, "exec"):
            raise DaytonaRuntimeError("Daytona sandbox object does not expose process.exec")
        wrapped_command = command
        if background:
            wrapped_command = "sh -lc " + shlex.quote(f"{command} >/dev/null 2>&1 & echo $!")
        if user and user != "root":
            wrapped_command = (
                f"sudo -n -u {shlex.quote(user)} sh -lc {shlex.quote(wrapped_command)}"
            )
        kwargs: dict[str, Any] = {}
        if cwd:
            kwargs["cwd"] = cwd
        if envs:
            kwargs["env"] = envs
        if timeout_seconds is not None:
            kwargs["timeout"] = timeout_seconds
        return process.exec(wrapped_command, **kwargs)

    def _detect_effective_home(self, sandbox: Any) -> str:
        result = self._run_command(
            sandbox,
            'sh -lc \'printf "%s\\n" "$HOME"\'',
            None,
            None,
            None,
            False,
            30,
        )
        home_lines = self._result_stdout(result).strip().splitlines()
        if not home_lines:
            raise DaytonaRuntimeError("Daytona sandbox did not report an effective HOME.")
        return home_lines[0].strip()

    def _directory_exists(self, sandbox: Any, path: str) -> bool:
        result = self._run_command(
            sandbox,
            f"test -d {shlex.quote(path)}",
            None,
            None,
            None,
            False,
            30,
        )
        return self._result_exit_code(result) == 0

    def _result_exit_code(self, result: Any) -> int:
        return int(getattr(result, "exit_code", getattr(result, "exitCode", 0)))

    def _result_stdout(self, result: Any) -> str:
        stdout = getattr(result, "stdout", None)
        if stdout is not None:
            return str(stdout)
        artifacts = getattr(result, "artifacts", None)
        artifact_stdout = getattr(artifacts, "stdout", None)
        if artifact_stdout is not None:
            return str(artifact_stdout)
        rendered = getattr(result, "result", None)
        if rendered is not None:
            return str(rendered)
        return ""

    def _write_file(self, sandbox: Any, path: str, content: bytes | str) -> None:
        fs = getattr(sandbox, "fs", None)
        if fs is None or not hasattr(fs, "upload_file"):
            raise DaytonaRuntimeError("Daytona sandbox object does not expose fs.upload_file")
        payload = content.encode("utf-8") if isinstance(content, str) else content
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(payload)
            temp_path = Path(temp_file.name)
        try:
            fs.upload_file(str(temp_path), path)
        except TypeError:
            fs.upload_file(payload, path)
        finally:
            temp_path.unlink(missing_ok=True)
