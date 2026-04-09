"""Base contracts for cloud sandbox providers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable


class SandboxProviderKind(StrEnum):
    e2b = "e2b"
    daytona = "daytona"


class SandboxProviderError(RuntimeError):
    """Raised when sandbox provider configuration or operations are invalid."""


@dataclass(frozen=True)
class SandboxHandle:
    provider: SandboxProviderKind
    sandbox_id: str
    template_version: str


@dataclass(frozen=True)
class RuntimeEndpoint:
    runtime_url: str


@dataclass(frozen=True)
class SandboxRuntimeContext:
    home_dir: str
    runtime_workdir: str
    runtime_binary_path: str
    base_env: dict[str, str]


@dataclass(frozen=True)
class ProviderSandboxState:
    external_sandbox_id: str
    state: str
    started_at: datetime | None
    end_at: datetime | None
    observed_at: datetime
    metadata: dict[str, str]


@runtime_checkable
class SandboxProvider(Protocol):
    @property
    def kind(self) -> SandboxProviderKind: ...

    @property
    def template_version(self) -> str: ...

    @property
    def runtime_port(self) -> int: ...

    @property
    def runtime_endpoint_handles_cors(self) -> bool: ...

    @property
    def runtime_workdir(self) -> str: ...

    @property
    def runtime_binary_path(self) -> str: ...

    @property
    def user_home(self) -> str: ...

    @property
    def preserves_processes_on_resume(self) -> bool: ...

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> SandboxHandle: ...

    async def connect_running_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any: ...

    async def resume_sandbox(
        self,
        sandbox_id: str,
        *,
        timeout_seconds: int | None = None,
    ) -> Any: ...

    async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState | None: ...

    async def list_sandbox_states(self) -> list[ProviderSandboxState]: ...

    async def resolve_runtime_endpoint(self, sandbox: Any) -> RuntimeEndpoint: ...

    async def resolve_runtime_context(self, sandbox: Any) -> SandboxRuntimeContext: ...

    async def pause_sandbox(self, sandbox_id: str) -> None: ...

    async def destroy_sandbox(self, sandbox_id: str) -> None: ...

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
    ) -> Any: ...

    async def write_file(self, sandbox: Any, path: str, content: bytes | str) -> None: ...
