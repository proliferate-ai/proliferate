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
from proliferate.server.cloud.credentials.domain.file_validation import (
    decode_base64_json,
    has_portable_claude_file,
    has_portable_codex_file,
    has_portable_gemini_file,
)
from proliferate.server.cloud.credentials.domain.types import CloudCredentialAuthMode
from proliferate.server.cloud.errors import CloudApiError

FileContentValidator = Callable[[dict[str, object], str], bool]
EnvPayloadNormalizer = Callable[[Mapping[str, str]], dict[str, str]]


class CloudCredentialFileInput(Protocol):
    relative_path: str
    content_base64: str


@dataclass(frozen=True)
class CredentialProviderSpec:
    provider: CloudAgentKind
    allowed_env_vars: frozenset[str]
    allowed_file_paths: frozenset[str]
    env_normalizer: EnvPayloadNormalizer | None = None
    file_validator: FileContentValidator | None = None


@dataclass(frozen=True)
class NormalizedCloudCredentialPayload:
    auth_mode: CloudCredentialAuthMode
    payload: dict[str, object]


_CREDENTIAL_SPECS: dict[CloudAgentKind, CredentialProviderSpec] = {
    "claude": CredentialProviderSpec(
        provider="claude",
        allowed_env_vars=frozenset({"ANTHROPIC_API_KEY"}),
        allowed_file_paths=CLAUDE_ALLOWED_AUTH_FILES,
        env_normalizer=lambda env_vars: _normalize_claude_env_payload(env_vars),
        file_validator=has_portable_claude_file,
    ),
    "codex": CredentialProviderSpec(
        provider="codex",
        allowed_env_vars=frozenset(),
        allowed_file_paths=CODEX_ALLOWED_AUTH_FILES,
        file_validator=lambda data, _relative_path: has_portable_codex_file(data),
    ),
    "gemini": CredentialProviderSpec(
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


def normalize_cloud_credential_payload(
    *,
    provider: CloudAgentKind,
    auth_mode: CloudCredentialAuthMode,
    env_vars: Mapping[str, str] | None,
    files: Sequence[CloudCredentialFileInput] | None,
) -> NormalizedCloudCredentialPayload:
    spec = _provider_spec(provider)
    if auth_mode == "env":
        if not isinstance(env_vars, Mapping):
            _invalid_payload(f"{spec.provider.capitalize()} cloud sync requires env vars.")
        normalized_env_vars = _normalize_env_payload(spec, env_vars)
        return NormalizedCloudCredentialPayload(
            auth_mode="env",
            payload={
                "provider": provider,
                "authMode": "env",
                "envVars": normalized_env_vars,
            },
        )

    normalized_files = _normalize_file_payload(spec, files)
    return NormalizedCloudCredentialPayload(
        auth_mode="file",
        payload={
            "provider": provider,
            "authMode": "file",
            "files": normalized_files,
        },
    )


def _provider_spec(provider: CloudAgentKind) -> CredentialProviderSpec:
    return _CREDENTIAL_SPECS[provider]


def _normalize_env_payload(
    spec: CredentialProviderSpec,
    env_vars: Mapping[str, str],
) -> dict[str, str]:
    if spec.env_normalizer is None:
        _invalid_payload(f"Env credential sync is not supported for provider '{spec.provider}'.")

    env_var_names = set(env_vars.keys())
    unexpected = sorted(env_var_names - spec.allowed_env_vars)
    if unexpected:
        unexpected_vars = ", ".join(unexpected)
        _invalid_payload(
            f"{spec.provider.capitalize()} cloud sync does not allow env vars: {unexpected_vars}."
        )

    normalized_input = {
        key: value for key, value in env_vars.items() if key in spec.allowed_env_vars
    }
    if not normalized_input:
        _invalid_payload(f"{spec.provider.capitalize()} cloud sync requires at least one env var.")
    return spec.env_normalizer(normalized_input)


def _normalize_file_payload(
    spec: CredentialProviderSpec,
    files: Sequence[CloudCredentialFileInput] | None,
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
            raise CloudApiError(
                "invalid_payload",
                f"File '{relative_path}' must be valid base64-encoded JSON.",
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
        _invalid_payload("Claude cloud sync requires ANTHROPIC_API_KEY.")
    return {"ANTHROPIC_API_KEY": api_key}


def _normalize_gemini_env_payload(env_vars: Mapping[str, str]) -> dict[str, str]:
    has_gemini_api_key = bool(env_vars.get("GEMINI_API_KEY"))
    has_google_api_key = bool(env_vars.get("GOOGLE_API_KEY"))
    uses_vertex_ai = env_vars.get("GOOGLE_GENAI_USE_VERTEXAI") == "true"

    if has_gemini_api_key and has_google_api_key:
        _invalid_payload(
            "Gemini cloud sync must use either GEMINI_API_KEY or GOOGLE_API_KEY, not both."
        )
    if has_google_api_key and not uses_vertex_ai:
        _invalid_payload("Gemini GOOGLE_API_KEY sync requires GOOGLE_GENAI_USE_VERTEXAI=true.")
    if uses_vertex_ai and not has_google_api_key:
        _invalid_payload(
            "GOOGLE_GENAI_USE_VERTEXAI=true requires GOOGLE_API_KEY for Gemini cloud sync."
        )
    if has_gemini_api_key and "GOOGLE_GENAI_USE_VERTEXAI" in env_vars:
        _invalid_payload("Gemini API key sync must not include GOOGLE_GENAI_USE_VERTEXAI.")
    if not has_gemini_api_key and not has_google_api_key:
        _invalid_payload("Gemini cloud sync requires GEMINI_API_KEY or GOOGLE_API_KEY.")
    return dict(env_vars)


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)
