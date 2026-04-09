from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Literal, NoReturn
from uuid import UUID

from proliferate.constants.cloud import CLAUDE_ALLOWED_AUTH_FILES, SUPPORTED_CLOUD_AGENTS
from proliferate.db.models.cloud import CloudCredential
from proliferate.db.store.cloud_credentials import (
    load_cloud_credentials_for_user,
    persist_cloud_credential_delete,
    persist_cloud_credential_sync,
)
from proliferate.server.cloud.credentials.models import (
    CredentialStatus,
    CredentialStatusRecord,
    SyncClaudeCredentialRequest,
    SyncClaudeEnvCredentialRequest,
    SyncClaudeFileCredentialRequest,
    SyncCodexCredentialRequest,
    build_credential_statuses,
    credential_status_payload,
)
from proliferate.server.cloud.credentials.validation import (
    decode_base64_json,
    has_portable_claude_file,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.crypto import decrypt_json, encrypt_json


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


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


async def sync_claude_credential_for_user(
    user_id: UUID,
    body: SyncClaudeCredentialRequest,
) -> Literal["env", "file"]:
    if body.auth_mode == "env":
        if not isinstance(body, SyncClaudeEnvCredentialRequest):
            raise CloudApiError(
                "invalid_payload", "Expected env credential payload", status_code=422
            )
        api_key = body.env_vars.get("ANTHROPIC_API_KEY")
        if not api_key:
            _invalid_payload("Claude cloud sync requires ANTHROPIC_API_KEY.")
        await persist_cloud_credential_sync(
            user_id,
            "claude",
            encrypt_json(
                {
                    "provider": "claude",
                    "authMode": "env",
                    "envVars": {"ANTHROPIC_API_KEY": api_key},
                }
            ),
            "env",
        )
        return "env"

    if not isinstance(body, SyncClaudeFileCredentialRequest):
        raise CloudApiError("invalid_payload", "Expected file credential payload", status_code=422)
    if not body.files:
        _invalid_payload("Claude file sync requires at least one auth file.")

    decoded_files: dict[str, str] = {}
    for entry in body.files:
        if entry.relative_path not in CLAUDE_ALLOWED_AUTH_FILES:
            _invalid_payload(
                f"File path '{entry.relative_path}' is not an approved Claude auth file."
            )
        try:
            decoded = decode_base64_json(entry.content_base64)
            parsed = json.loads(decoded)
        except Exception as exc:
            raise CloudApiError(
                "invalid_payload",
                f"File '{entry.relative_path}' must be valid base64-encoded JSON.",
                status_code=400,
            ) from exc
        if not isinstance(parsed, dict) or not has_portable_claude_file(
            parsed, entry.relative_path
        ):
            _invalid_payload(
                f"File '{entry.relative_path}' does not contain portable Claude"
                " credentials for cloud use."
            )
        # By the time the desktop uploads a file payload, the local source
        # backend has already been normalized away. Cloud persists only the
        # portable runtime-home-relative file contents.
        decoded_files[entry.relative_path] = decoded

    await persist_cloud_credential_sync(
        user_id,
        "claude",
        encrypt_json(
            {
                "provider": "claude",
                "authMode": "file",
                "files": decoded_files,
            }
        ),
        "file",
    )
    return "file"


async def sync_codex_credential_for_user(
    user_id: UUID,
    body: SyncCodexCredentialRequest,
) -> Literal["file"]:
    auth_file = next(
        (item for item in body.files if item.relative_path == ".codex/auth.json"),
        None,
    )
    if auth_file is None:
        _invalid_payload("Codex cloud sync requires a .codex/auth.json file.")
    try:
        decoded = decode_base64_json(auth_file.content_base64)
        json.loads(decoded)
    except Exception as exc:
        raise CloudApiError(
            "invalid_payload",
            "Codex cloud sync requires valid base64-encoded JSON.",
            status_code=400,
        ) from exc
    await persist_cloud_credential_sync(
        user_id,
        "codex",
        encrypt_json(
            {
                "provider": "codex",
                "authMode": "file",
                "files": {".codex/auth.json": decoded},
            }
        ),
        "file",
    )
    return "file"


async def delete_cloud_credential_for_user(
    user_id: UUID,
    provider: Literal["claude", "codex"],
) -> None:
    await persist_cloud_credential_delete(user_id, provider)
