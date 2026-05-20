from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import NoReturn, Protocol

from proliferate.constants.cloud import (
    CLAUDE_ALLOWED_AUTH_FILES,
    CODEX_ALLOWED_AUTH_FILES,
    GEMINI_ALLOWED_AUTH_FILES,
    CloudAgentKind,
)
from proliferate.server.cloud.agent_auth.domain.file_validation import (
    decode_base64_json,
    has_portable_claude_file,
    has_portable_codex_file,
    has_portable_gemini_file,
)
from proliferate.server.cloud.agent_auth.domain.types import SyncedCredentialAuthMode
from proliferate.server.cloud.agent_auth.errors import AgentAuthError

FileContentValidator = Callable[[dict[str, object], str], bool]
EnvPayloadNormalizer = Callable[[Mapping[str, str]], dict[str, str]]


class SyncedCredentialFileInput(Protocol):
    relative_path: str
    content_base64: str


@dataclass(frozen=True)
class SyncedCredentialProviderSpec:
    provider: CloudAgentKind
    allowed_env_vars: frozenset[str]
    allowed_file_paths: frozenset[str]
    env_normalizer: EnvPayloadNormalizer | None = None
    file_validator: FileContentValidator | None = None


@dataclass(frozen=True)
class NormalizedSyncedCredentialPayload:
    auth_mode: SyncedCredentialAuthMode
    payload: dict[str, object]


_CREDENTIAL_SPECS: dict[CloudAgentKind, SyncedCredentialProviderSpec] = {
    "claude": SyncedCredentialProviderSpec(
        provider="claude",
        allowed_env_vars=frozenset({"ANTHROPIC_API_KEY"}),
        allowed_file_paths=CLAUDE_ALLOWED_AUTH_FILES,
        env_normalizer=lambda env_vars: _normalize_claude_env_payload(env_vars),
        file_validator=has_portable_claude_file,
    ),
    "codex": SyncedCredentialProviderSpec(
        provider="codex",
        allowed_env_vars=frozenset(),
        allowed_file_paths=CODEX_ALLOWED_AUTH_FILES,
        file_validator=lambda data, _relative_path: has_portable_codex_file(data),
    ),
    "gemini": SyncedCredentialProviderSpec(
        provider="gemini",
        allowed_env_vars=frozenset(
            {
                "GEMINI_API_KEY",
                "GOOGLE_API_KEY",
                "GOOGLE_GENAI_USE_VERTEXAI",
            }
        ),
        allowed_file_paths=GEMINI_ALLOWED_AUTH_FILES,
        env_normalizer=lambda env_vars: _normalize_gemini_env_payload(env_vars),
        file_validator=has_portable_gemini_file,
    ),
}


def normalize_synced_credential_payload(
    *,
    agent_kind: CloudAgentKind,
    auth_mode: SyncedCredentialAuthMode,
    env_vars: Mapping[str, str] | None,
    files: Sequence[SyncedCredentialFileInput] | None,
) -> NormalizedSyncedCredentialPayload:
    spec = _provider_spec(agent_kind)
    if auth_mode == "env":
        if not isinstance(env_vars, Mapping):
            _invalid_payload(f"{spec.provider.capitalize()} sync requires env vars.")
        normalized_env_vars = _normalize_env_payload(spec, env_vars)
        return NormalizedSyncedCredentialPayload(
            auth_mode="env",
            payload={
                "provider": agent_kind,
                "authMode": "env",
                "envVars": normalized_env_vars,
            },
        )

    normalized_files = _normalize_file_payload(spec, files)
    return NormalizedSyncedCredentialPayload(
        auth_mode="file",
        payload={
            "provider": agent_kind,
            "authMode": "file",
            "files": normalized_files,
        },
    )


def redacted_synced_payload_summary(
    *,
    agent_kind: CloudAgentKind,
    payload: dict[str, object],
) -> dict[str, object]:
    auth_mode = payload.get("authMode")
    summary: dict[str, object] = {
        "source": "agent_auth_synced",
        "authMode": auth_mode if auth_mode in ("env", "file") else "file",
    }
    env_vars = payload.get("envVars")
    if isinstance(env_vars, Mapping):
        summary["envVarNames"] = sorted(key for key in env_vars if isinstance(key, str))
    files = payload.get("files")
    if isinstance(files, Mapping):
        paths = sorted(path for path in files if isinstance(path, str))
        summary["fileCount"] = len(paths)
        summary["filePaths"] = paths
    summary["agentKind"] = agent_kind
    return summary


def _provider_spec(provider: CloudAgentKind) -> SyncedCredentialProviderSpec:
    spec = _CREDENTIAL_SPECS.get(provider)
    if spec is None:
        _invalid_payload(f"Native auth sync is not supported for agent '{provider}'.")
    return spec


def _normalize_env_payload(
    spec: SyncedCredentialProviderSpec,
    env_vars: Mapping[str, str],
) -> dict[str, str]:
    if spec.env_normalizer is None:
        _invalid_payload(f"Env credential sync is not supported for agent '{spec.provider}'.")

    env_var_names = set(env_vars.keys())
    unexpected = sorted(env_var_names - spec.allowed_env_vars)
    if unexpected:
        unexpected_vars = ", ".join(unexpected)
        _invalid_payload(
            f"{spec.provider.capitalize()} sync does not allow env vars: {unexpected_vars}."
        )

    normalized_input = {
        key: value for key, value in env_vars.items() if key in spec.allowed_env_vars
    }
    if not normalized_input:
        _invalid_payload(f"{spec.provider.capitalize()} sync requires at least one env var.")
    return spec.env_normalizer(normalized_input)


def _normalize_file_payload(
    spec: SyncedCredentialProviderSpec,
    files: Sequence[SyncedCredentialFileInput] | None,
) -> dict[str, str]:
    if not isinstance(files, list) or not files:
        _invalid_payload(
            f"{spec.provider.capitalize()} file sync requires at least one auth file."
        )

    decoded_files: dict[str, str] = {}
    for entry in files:
        relative_path = entry.relative_path
        if relative_path not in spec.allowed_file_paths:
            _invalid_payload(
                f"File path '{relative_path}' is not an approved "
                f"{spec.provider.capitalize()} auth file."
            )
        try:
            decoded = decode_base64_json(entry.content_base64)
            parsed = json.loads(decoded)
        except Exception as exc:
            raise AgentAuthError(
                "File must be valid base64-encoded JSON.",
                code="invalid_payload",
                status_code=400,
            ) from exc
        if not isinstance(parsed, dict) or (
            spec.file_validator is not None and not spec.file_validator(parsed, relative_path)
        ):
            _invalid_payload(
                f"File '{relative_path}' does not contain portable "
                f"{spec.provider.capitalize()} credentials for cloud use."
            )
        decoded_files[relative_path] = decoded

    return decoded_files


def _normalize_claude_env_payload(env_vars: Mapping[str, str]) -> dict[str, str]:
    api_key = env_vars.get("ANTHROPIC_API_KEY")
    if not api_key:
        _invalid_payload("Claude sync requires ANTHROPIC_API_KEY.")
    return {"ANTHROPIC_API_KEY": api_key}


def _normalize_gemini_env_payload(env_vars: Mapping[str, str]) -> dict[str, str]:
    has_gemini_api_key = bool(env_vars.get("GEMINI_API_KEY"))
    has_google_api_key = bool(env_vars.get("GOOGLE_API_KEY"))
    uses_vertex_ai = env_vars.get("GOOGLE_GENAI_USE_VERTEXAI") == "true"

    if has_gemini_api_key and has_google_api_key:
        _invalid_payload("Gemini sync must use either GEMINI_API_KEY or GOOGLE_API_KEY, not both.")
    if has_google_api_key and not uses_vertex_ai:
        _invalid_payload("Gemini GOOGLE_API_KEY sync requires GOOGLE_GENAI_USE_VERTEXAI=true.")
    if uses_vertex_ai and not has_google_api_key:
        _invalid_payload("GOOGLE_GENAI_USE_VERTEXAI=true requires GOOGLE_API_KEY for Gemini sync.")
    if has_gemini_api_key and "GOOGLE_GENAI_USE_VERTEXAI" in env_vars:
        _invalid_payload("Gemini API key sync must not include GOOGLE_GENAI_USE_VERTEXAI.")
    if not has_gemini_api_key and not has_google_api_key:
        _invalid_payload("Gemini sync requires GEMINI_API_KEY or GOOGLE_API_KEY.")
    return dict(env_vars)


def _invalid_payload(message: str) -> NoReturn:
    raise AgentAuthError(message, code="invalid_payload", status_code=400)
