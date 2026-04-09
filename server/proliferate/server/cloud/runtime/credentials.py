"""Typed credential normalization for cloud runtime provisioning."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from proliferate.constants.cloud import CLAUDE_ALLOWED_AUTH_FILES
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.sandbox_exec import run_sandbox_command_logged


@dataclass(frozen=True)
class ProvisionFile:
    relative_path: str
    content: str


@dataclass(frozen=True)
class ClaudeProvisionCredential:
    api_key: str | None = None
    auth_files: tuple[ProvisionFile, ...] = ()


@dataclass(frozen=True)
class CodexProvisionCredential:
    auth_json: str | None = None


@dataclass(frozen=True)
class ProvisionCredentials:
    claude: ClaudeProvisionCredential | None = None
    codex: CodexProvisionCredential | None = None

    @property
    def synced_providers(self) -> tuple[str, ...]:
        providers: list[str] = []
        if self.claude is not None:
            providers.append("claude")
        if self.codex is not None:
            providers.append("codex")
        return tuple(providers)


def _mapping_value(payload: object) -> Mapping[str, object]:
    if isinstance(payload, Mapping):
        return payload
    return {}


def _normalize_claude_credential(payload: object) -> ClaudeProvisionCredential | None:
    data = _mapping_value(payload)
    if not data:
        return None

    api_key: str | None = None
    auth_files: list[ProvisionFile] = []
    auth_mode = data.get("authMode")

    if auth_mode == "env":
        env_vars = data.get("envVars")
        if isinstance(env_vars, Mapping):
            candidate = env_vars.get("ANTHROPIC_API_KEY")
            if isinstance(candidate, str) and candidate:
                api_key = candidate

    if auth_mode == "file":
        files = data.get("files")
        if isinstance(files, Mapping):
            for relative_path, content in files.items():
                if (
                    isinstance(relative_path, str)
                    and isinstance(content, str)
                    and relative_path in CLAUDE_ALLOWED_AUTH_FILES
                ):
                    auth_files.append(ProvisionFile(relative_path=relative_path, content=content))

    return ClaudeProvisionCredential(api_key=api_key, auth_files=tuple(auth_files))


def _normalize_codex_credential(payload: object) -> CodexProvisionCredential | None:
    data = _mapping_value(payload)
    if not data:
        return None

    auth_json: str | None = None
    files = data.get("files")
    if isinstance(files, Mapping):
        candidate = files.get(".codex/auth.json")
        if isinstance(candidate, str) and candidate:
            auth_json = candidate

    return CodexProvisionCredential(auth_json=auth_json)


def normalize_provision_credentials(
    credential_payloads: Mapping[str, object],
) -> ProvisionCredentials:
    return ProvisionCredentials(
        claude=_normalize_claude_credential(credential_payloads.get("claude")),
        codex=_normalize_codex_credential(credential_payloads.get("codex")),
    )


async def write_credential_files(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    credentials: ProvisionCredentials,
    runtime_context: SandboxRuntimeContext,
) -> None:
    if credentials.claude is not None:
        for file in credentials.claude.auth_files:
            # File-backed credentials are already normalized to paths relative
            # to the sandbox runtime home before they reach provisioning.
            sandbox_path = f"{runtime_context.home_dir}/{file.relative_path}"
            parent_dir = str(Path(sandbox_path).parent)
            label = "mkdir_" + file.relative_path.replace("/", "_").replace(".", "_")
            await run_sandbox_command_logged(
                provider,
                sandbox,
                workspace_id=workspace_id,
                label=label,
                command=f"mkdir -p {parent_dir}",
                runtime_context=runtime_context,
                timeout_seconds=30,
            )
            await provider.write_file(sandbox, sandbox_path, file.content.encode("utf-8"))

    if credentials.codex is not None and credentials.codex.auth_json:
        codex_dir = f"{runtime_context.home_dir}/.codex"
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="mkdir_codex_dir",
            command=f"mkdir -p {codex_dir}",
            runtime_context=runtime_context,
            timeout_seconds=30,
        )
        await provider.write_file(
            sandbox,
            f"{codex_dir}/auth.json",
            credentials.codex.auth_json.encode("utf-8"),
        )
