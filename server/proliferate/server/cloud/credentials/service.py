from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import NoReturn
from uuid import UUID

from proliferate.constants.cloud import (
    CLAUDE_ALLOWED_AUTH_FILES,
    CODEX_ALLOWED_AUTH_FILES,
    GEMINI_ALLOWED_AUTH_FILES,
    SUPPORTED_CLOUD_AGENTS,
)
from proliferate.db.models.cloud import CloudCredential
from proliferate.db.store.cloud_credentials import (
    load_cloud_credentials_for_user,
    persist_cloud_credential_delete,
    persist_cloud_credential_if_changed,
)
from proliferate.server.cloud.credentials.models import (
    CloudAgentKind,
    CloudCredentialAuthMode,
    CredentialStatus,
    CredentialStatusRecord,
    SyncCloudCredentialRequest,
    build_credential_statuses,
    credential_status_payload,
)
from proliferate.server.cloud.credentials.validation import (
    decode_base64_json,
    has_portable_claude_file,
    has_portable_codex_file,
    has_portable_gemini_file,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.crypto import decrypt_json, encrypt_json

FileContentValidator = Callable[[dict[str, object], str], bool]
EnvPayloadNormalizer = Callable[[Mapping[str, str]], dict[str, str]]


@dataclass(frozen=True)
class CredentialProviderSpec:
    provider: CloudAgentKind
    default_auth_mode: CloudCredentialAuthMode
    allowed_env_vars: frozenset[str]
    allowed_file_paths: frozenset[str]
    env_normalizer: EnvPayloadNormalizer | None = None
    file_validator: FileContentValidator | None = None


_CREDENTIAL_SPECS: dict[CloudAgentKind, CredentialProviderSpec] = {
    "claude": CredentialProviderSpec(
        provider="claude",
        default_auth_mode="env",
        allowed_env_vars=frozenset({"ANTHROPIC_API_KEY"}),
        allowed_file_paths=CLAUDE_ALLOWED_AUTH_FILES,
        env_normalizer=lambda env_vars: _normalize_claude_env_payload(env_vars),
        file_validator=has_portable_claude_file,
    ),
    "codex": CredentialProviderSpec(
        provider="codex",
        default_auth_mode="file",
        allowed_env_vars=frozenset(),
        allowed_file_paths=CODEX_ALLOWED_AUTH_FILES,
        file_validator=lambda data, _relative_path: has_portable_codex_file(data),
    ),
    "gemini": CredentialProviderSpec(
        provider="gemini",
        default_auth_mode="env",
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


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


def _provider_spec(provider: CloudAgentKind) -> CredentialProviderSpec:
    return _CREDENTIAL_SPECS[provider]


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


async def list_cloud_credentials(
    user_id: UUID,
) -> list[CredentialStatus]:
    statuses = await load_cloud_credential_statuses(user_id)
    return [credential_status_payload(status) for status in statuses]


async def load_cloud_credential_statuses(
    user_id: UUID,
) -> list[CredentialStatusRecord]:
    return build_credential_statuses(await load_cloud_credentials_for_user(user_id))


async def load_active_cloud_credential_payloads(
    user_id: UUID,
) -> Mapping[str, object]:
    records = await load_cloud_credentials_for_user(user_id)
    return _active_credential_payloads(records)


def _active_credential_payloads(
    records: list[CloudCredential],
) -> Mapping[str, object]:
    return {
        record.provider: decrypt_json(record.payload_ciphertext)
        for record in records
        if record.provider in SUPPORTED_CLOUD_AGENTS and record.revoked_at is None
    }


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
    body: SyncCloudCredentialRequest,
) -> dict[str, str]:
    files = getattr(body, "files", None)
    if not isinstance(files, list) or not files:
        _invalid_payload(
            f"{spec.provider.capitalize()} file sync requires at least one auth file."
        )

    decoded_files: dict[str, str] = {}
    for entry in files:
        relative_path = getattr(entry, "relative_path", None)
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


async def sync_cloud_credential_for_user(
    user_id: UUID,
    provider: CloudAgentKind,
    body: SyncCloudCredentialRequest,
) -> CloudCredentialAuthMode:
    spec = _provider_spec(provider)
    if body.auth_mode == "env":
        env_vars = getattr(body, "env_vars", None)
        if not isinstance(env_vars, Mapping):
            _invalid_payload(f"{spec.provider.capitalize()} cloud sync requires env vars.")
        normalized_env_vars = _normalize_env_payload(spec, env_vars)
        payload = {
            "provider": provider,
            "authMode": "env",
            "envVars": normalized_env_vars,
        }
        await _persist_cloud_credential_if_changed(
            user_id=user_id,
            provider=provider,
            payload=payload,
            auth_mode="env",
        )
        return "env"

    normalized_files = _normalize_file_payload(spec, body)
    payload = {
        "provider": provider,
        "authMode": "file",
        "files": normalized_files,
    }
    await _persist_cloud_credential_if_changed(
        user_id=user_id,
        provider=provider,
        payload=payload,
        auth_mode="file",
    )
    return "file"


async def _persist_cloud_credential_if_changed(
    *,
    user_id: UUID,
    provider: CloudAgentKind,
    payload: Mapping[str, object],
    auth_mode: CloudCredentialAuthMode,
) -> None:
    stored_payload = dict(payload)
    await persist_cloud_credential_if_changed(
        user_id,
        provider,
        encrypt_json(stored_payload),
        auth_mode,
        lambda payload_ciphertext: decrypt_json(payload_ciphertext) == stored_payload,
    )


async def delete_cloud_credential_for_user(
    user_id: UUID,
    provider: CloudAgentKind,
) -> None:
    await persist_cloud_credential_delete(user_id, provider)
