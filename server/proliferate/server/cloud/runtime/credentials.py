"""Typed credential normalization for cloud runtime provisioning."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from proliferate.constants.cloud import (
    CLAUDE_ALLOWED_AUTH_FILES,
    CODEX_ALLOWED_AUTH_FILES,
    GEMINI_ALLOWED_AUTH_FILES,
)
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.sandbox_exec import run_sandbox_command_logged


@dataclass(frozen=True)
class ProvisionFile:
    relative_path: str
    content: str


@dataclass(frozen=True)
class ProvisionEnvVar:
    name: str
    value: str


@dataclass(frozen=True)
class ClaudeProvisionCredential:
    api_key: str | None = None
    auth_files: tuple[ProvisionFile, ...] = ()


@dataclass(frozen=True)
class CodexProvisionCredential:
    auth_json: str | None = None


@dataclass(frozen=True)
class GeminiProvisionCredential:
    env_vars: tuple[ProvisionEnvVar, ...] = ()
    auth_files: tuple[ProvisionFile, ...] = ()


@dataclass(frozen=True)
class ProvisionCredentials:
    claude: ClaudeProvisionCredential | None = None
    codex: CodexProvisionCredential | None = None
    gemini: GeminiProvisionCredential | None = None

    @property
    def synced_providers(self) -> tuple[str, ...]:
        providers: list[str] = []
        if self.claude is not None:
            providers.append("claude")
        if self.codex is not None:
            providers.append("codex")
        if self.gemini is not None:
            providers.append("gemini")
        return tuple(providers)

    def iter_env_vars(self) -> tuple[ProvisionEnvVar, ...]:
        env_vars: list[ProvisionEnvVar] = []
        if self.claude is not None and self.claude.api_key:
            env_vars.append(ProvisionEnvVar(name="ANTHROPIC_API_KEY", value=self.claude.api_key))
        if self.gemini is not None:
            env_vars.extend(self.gemini.env_vars)
        return tuple(env_vars)

    def iter_files(self) -> tuple[ProvisionFile, ...]:
        files: list[ProvisionFile] = []
        if self.claude is not None:
            files.extend(self.claude.auth_files)
        if self.codex is not None and self.codex.auth_json:
            files.append(ProvisionFile(relative_path=".codex/auth.json", content=self.codex.auth_json))
        if self.gemini is not None:
            files.extend(self.gemini.auth_files)
        return tuple(files)


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


def _normalize_gemini_credential(payload: object) -> GeminiProvisionCredential | None:
    data = _mapping_value(payload)
    if not data:
        return None

    env_vars: list[ProvisionEnvVar] = []
    auth_files: list[ProvisionFile] = []
    auth_mode = data.get("authMode")

    if auth_mode == "env":
        raw_env_vars = data.get("envVars")
        if isinstance(raw_env_vars, Mapping):
            for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI"):
                value = raw_env_vars.get(name)
                if isinstance(value, str) and value:
                    env_vars.append(ProvisionEnvVar(name=name, value=value))

    if auth_mode == "file":
        files = data.get("files")
        if isinstance(files, Mapping):
            for relative_path, content in files.items():
                if (
                    isinstance(relative_path, str)
                    and isinstance(content, str)
                    and relative_path in GEMINI_ALLOWED_AUTH_FILES
                ):
                    # Gemini CLI reads security.auth.selectedType from ~/.gemini/settings.json;
                    # "oauth-personal" is defined in google-gemini/gemini-cli packages/core/src/core/contentGenerator.ts.
                    auth_files.append(ProvisionFile(relative_path=relative_path, content=content))

    return GeminiProvisionCredential(
        env_vars=tuple(env_vars),
        auth_files=tuple(auth_files),
    )


def normalize_provision_credentials(
    credential_payloads: Mapping[str, object],
) -> ProvisionCredentials:
    return ProvisionCredentials(
        claude=_normalize_claude_credential(credential_payloads.get("claude")),
        codex=_normalize_codex_credential(credential_payloads.get("codex")),
        gemini=_normalize_gemini_credential(credential_payloads.get("gemini")),
    )


async def write_credential_files(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    credentials: ProvisionCredentials,
    runtime_context: SandboxRuntimeContext,
) -> None:
    for file in credentials.iter_files():
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
