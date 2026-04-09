"""E2B-backed sandbox provider."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any

import httpx

from proliferate.config import settings
from proliferate.constants.sandbox.e2b import (
    E2B_RUNTIME_BINARY_PATH,
    E2B_RUNTIME_PORT,
    E2B_RUNTIME_WORKDIR,
    E2B_TEMPLATE_NAME,
    E2B_TEMPLATE_VERSION,
    E2B_TIMEOUT_SECONDS,
    E2B_USER_HOME,
)
from proliferate.integrations.sandbox.base import (
    ProviderSandboxState,
    RuntimeEndpoint,
    SandboxHandle,
    SandboxProviderKind,
    SandboxRuntimeContext,
)
from proliferate.server.billing.models import utcnow

logger = logging.getLogger("proliferate.cloud.e2b")

_E2B_API_BASE_URL = "https://api.e2b.app"


class E2BRuntimeError(RuntimeError):
    pass


def _load_sdk() -> type[Any]:
    try:
        from e2b import Sandbox  # type: ignore[import-untyped]
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise E2BRuntimeError(
            "E2B SDK is not installed in this environment. "
            "Install the server dependencies to enable cloud provisioning."
        ) from exc
    return Sandbox


def _load_command_exit_exception() -> type[BaseException] | tuple[type[BaseException], ...]:
    try:
        from e2b.sandbox.commands.command_handle import (  # type: ignore[import-untyped]
            CommandExitException,
        )
    except ImportError:  # pragma: no cover - depends on sdk layout
        return ()
    return CommandExitException


def _try_timeout_variants(
    fn: Any,
    base_args: tuple[Any, ...],
    base_kwargs: dict[str, Any],
    timeout_seconds: int | None,
    *,
    label: str,
) -> Any:
    if timeout_seconds is None:
        attempts = [dict(base_kwargs)]
    else:
        attempts = [
            {**base_kwargs, "timeout": timeout_seconds},
            {**base_kwargs, "timeoutMs": timeout_seconds * 1000},
            {**base_kwargs, "timeout_ms": timeout_seconds * 1000},
            dict(base_kwargs),
        ]
    last_type_error: TypeError | None = None
    for kwargs in attempts:
        try:
            return fn(*base_args, **kwargs)
        except TypeError as exc:
            last_type_error = exc
            continue
    if last_type_error is not None:
        raise last_type_error
    raise E2BRuntimeError(f"E2B {label} failed before returning a result")


def _coerce_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _normalize_metadata(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, str] = {}
    for key, item in value.items():
        if isinstance(key, str) and item is not None:
            normalized[key] = str(item)
    return normalized


def _normalize_state(value: object) -> str:
    return str(value or "").strip().lower()


def _state_from_payload(payload: dict[str, Any]) -> ProviderSandboxState | None:
    sandbox_id = payload.get("sandboxId") or payload.get("sandbox_id") or payload.get("id")
    if not sandbox_id:
        return None
    return ProviderSandboxState(
        external_sandbox_id=str(sandbox_id),
        state=_normalize_state(payload.get("state")),
        started_at=_coerce_datetime(payload.get("startedAt") or payload.get("started_at")),
        end_at=_coerce_datetime(payload.get("endAt") or payload.get("end_at")),
        observed_at=utcnow(),
        metadata=_normalize_metadata(payload.get("metadata")),
    )


class E2BSandboxProvider:
    @property
    def kind(self) -> SandboxProviderKind:
        return SandboxProviderKind.e2b

    @property
    def template_version(self) -> str:
        return E2B_TEMPLATE_VERSION

    @property
    def preserves_processes_on_resume(self) -> bool:
        return True

    @property
    def runtime_endpoint_handles_cors(self) -> bool:
        return False

    @property
    def runtime_workdir(self) -> str:
        return E2B_RUNTIME_WORKDIR

    @property
    def runtime_binary_path(self) -> str:
        return E2B_RUNTIME_BINARY_PATH

    @property
    def user_home(self) -> str:
        return E2B_USER_HOME

    @property
    def runtime_port(self) -> int:
        return E2B_RUNTIME_PORT

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> SandboxHandle:
        return await asyncio.to_thread(self._create_sandbox, metadata)

    async def connect_running_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any:
        return await asyncio.to_thread(self._connect, sandbox_id, timeout_seconds)

    async def resume_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any:
        return await asyncio.to_thread(self._connect, sandbox_id, timeout_seconds)

    async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState | None:
        return await asyncio.to_thread(self._get_sandbox_state, sandbox_id)

    async def list_sandbox_states(self) -> list[ProviderSandboxState]:
        async with httpx.AsyncClient(base_url=_E2B_API_BASE_URL, timeout=30.0) as client:
            response = await client.get(
                "/sandboxes",
                headers={"X-API-Key": self._require_api_key()},
            )
            response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            raw_items = payload.get("sandboxes") or payload.get("data") or []
        else:
            raw_items = payload
        if not isinstance(raw_items, list):
            return []
        states: list[ProviderSandboxState] = []
        for item in raw_items:
            if isinstance(item, dict):
                state = _state_from_payload(item)
                if state is not None:
                    states.append(state)
        return states

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
        if not settings.e2b_api_key:
            raise E2BRuntimeError(
                "E2B is not configured for this server. Set E2B_API_KEY "
                "in server/.env or server/.env.local."
            )
        return settings.e2b_api_key

    def _template_name(self) -> str:
        configured = settings.e2b_template_name.strip()
        return configured or E2B_TEMPLATE_NAME

    def _create_sandbox(self, metadata: dict[str, str] | None) -> SandboxHandle:
        Sandbox = _load_sdk()
        api_key = self._require_api_key()
        template_name = self._template_name()
        create_started = time.perf_counter()
        logger.info(
            "e2b sandbox create started template=%s timeout_seconds=%s",
            template_name,
            E2B_TIMEOUT_SECONDS,
        )
        sandbox = _try_timeout_variants(
            lambda **kw: Sandbox.create(template_name, **kw),
            (),
            {
                "api_key": api_key,
                "metadata": metadata or {},
                "lifecycle": {"on_timeout": "pause", "auto_resume": False},
            },
            E2B_TIMEOUT_SECONDS,
            label="sandbox create",
        )
        sandbox_id = getattr(sandbox, "sandbox_id", None) or getattr(sandbox, "sandboxId", None)
        if not sandbox_id:
            raise E2BRuntimeError("E2B sandbox create did not return a sandbox id")
        logger.info(
            "e2b sandbox create finished template=%s sandbox_id=%s elapsed_ms=%s",
            template_name,
            sandbox_id,
            int((time.perf_counter() - create_started) * 1000),
        )
        return SandboxHandle(
            provider=self.kind,
            sandbox_id=str(sandbox_id),
            template_version=self.template_version,
        )

    def _connect(self, sandbox_id: str, timeout_seconds: int | None = None) -> Any:
        Sandbox = _load_sdk()
        api_key = self._require_api_key()
        connect_fn = getattr(Sandbox, "connect", None)
        if connect_fn is None:
            raise E2BRuntimeError("E2B SDK does not expose Sandbox.connect")
        connect_started = time.perf_counter()
        logger.info("e2b sandbox connect started sandbox_id=%s", sandbox_id)
        sandbox = _try_timeout_variants(
            lambda **kw: connect_fn(sandbox_id, **kw),
            (),
            {"api_key": api_key},
            timeout_seconds,
            label="sandbox connect",
        )
        logger.info(
            "e2b sandbox connect finished sandbox_id=%s elapsed_ms=%s",
            sandbox_id,
            int((time.perf_counter() - connect_started) * 1000),
        )
        return sandbox

    def _get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState | None:
        Sandbox = _load_sdk()
        api_key = self._require_api_key()
        get_info = getattr(Sandbox, "get_info", None)
        if get_info is None:
            return None
        info = get_info(sandbox_id, api_key=api_key)
        payload: dict[str, Any] = {}
        for key in (
            "sandbox_id",
            "sandboxId",
            "state",
            "started_at",
            "startedAt",
            "end_at",
            "endAt",
            "metadata",
        ):
            value = getattr(info, key, None)
            if value is not None:
                payload[key] = value
        if not payload:
            return None
        return _state_from_payload(payload)

    def _resolve_runtime_endpoint(self, sandbox: Any) -> RuntimeEndpoint:
        return RuntimeEndpoint(runtime_url=f"https://{self._get_host(sandbox, self.runtime_port)}")

    def _resolve_runtime_context(self, sandbox: Any) -> SandboxRuntimeContext:
        del sandbox
        home_dir = self.user_home
        return SandboxRuntimeContext(
            home_dir=home_dir,
            runtime_workdir=self.runtime_workdir,
            runtime_binary_path=self.runtime_binary_path,
            base_env={"HOME": home_dir},
        )

    def _pause_sandbox(self, sandbox_id: str) -> None:
        Sandbox = _load_sdk()
        pause_fn = getattr(Sandbox, "pause", None)
        if pause_fn is None:
            raise E2BRuntimeError("E2B SDK does not expose Sandbox.pause")
        pause_fn(sandbox_id, api_key=self._require_api_key())

    def _destroy_sandbox(self, sandbox_id: str) -> None:
        Sandbox = _load_sdk()
        kill_fn = getattr(Sandbox, "kill", None) or getattr(Sandbox, "close", None)
        if kill_fn is None:
            raise E2BRuntimeError("E2B SDK does not expose Sandbox.kill/close")
        kill_fn(sandbox_id, api_key=self._require_api_key())

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
        commands = getattr(sandbox, "commands", None)
        if commands is None or not hasattr(commands, "run"):
            raise E2BRuntimeError("E2B sandbox object does not expose commands.run")
        base_kwargs: dict[str, Any] = {}
        if user:
            base_kwargs["user"] = user
        if cwd:
            base_kwargs["cwd"] = cwd
        if envs:
            base_kwargs["envs"] = envs
        if background:
            base_kwargs["background"] = True
        command_exit_exception = _load_command_exit_exception()
        try:
            return _try_timeout_variants(
                commands.run,
                (command,),
                base_kwargs,
                timeout_seconds,
                label="commands.run",
            )
        except command_exit_exception as exc:
            return exc

    def _write_file(self, sandbox: Any, path: str, content: bytes | str) -> None:
        files = getattr(sandbox, "files", None)
        if files is None or not hasattr(files, "write"):
            raise E2BRuntimeError("E2B sandbox object does not expose files.write")
        files.write(path, content)

    def _get_host(self, sandbox: Any, port: int) -> str:
        get_host = getattr(sandbox, "get_host", None) or getattr(sandbox, "getHost", None)
        if get_host is None:
            raise E2BRuntimeError("E2B sandbox object does not expose get_host/getHost")
        return str(get_host(port))
