from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_AGENTS,
    CloudAgentKind,
)
from proliferate.db.store.cloud_credentials import (
    delete_cloud_credential,
    get_user_cloud_credentials,
    sync_cloud_credential_if_changed,
)
from proliferate.server.cloud.credentials.domain.status import (
    CredentialStatusRecord,
    build_credential_statuses,
)
from proliferate.server.cloud.credentials.domain.sync_payload import (
    normalize_cloud_credential_payload,
)
from proliferate.server.cloud.credentials.domain.types import (
    CloudCredentialAuthMode,
)
from proliferate.server.cloud.credentials.models import (
    CredentialStatus,
    SyncCloudCredentialRequest,
    credential_status_payload,
)
from proliferate.server.cloud.credentials.session_loader import (
    load_cloud_credentials_for_user,
)
from proliferate.utils.crypto import decrypt_json, encrypt_json


async def list_cloud_credentials(
    db: AsyncSession,
    user_id: UUID,
) -> list[CredentialStatus]:
    statuses = await load_cloud_credential_statuses_for_request(db, user_id)
    return [credential_status_payload(status) for status in statuses]


async def load_cloud_credential_statuses_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> list[CredentialStatusRecord]:
    return build_credential_statuses(await get_user_cloud_credentials(db, user_id))


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
    records: Sequence[object],
) -> Mapping[str, object]:
    return {
        provider: decrypt_json(payload_ciphertext)
        for record in records
        if (provider := getattr(record, "provider", None)) in SUPPORTED_CLOUD_AGENTS
        and getattr(record, "revoked_at", None) is None
        and isinstance(payload_ciphertext := getattr(record, "payload_ciphertext", None), str)
    }


async def sync_cloud_credential_for_user(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
    body: SyncCloudCredentialRequest,
) -> bool:
    normalized = normalize_cloud_credential_payload(
        provider=provider,
        auth_mode=body.auth_mode,
        env_vars=getattr(body, "env_vars", None),
        files=getattr(body, "files", None),
    )
    return await _persist_cloud_credential_if_changed(
        db,
        user_id=user_id,
        provider=provider,
        payload=normalized.payload,
        auth_mode=normalized.auth_mode,
    )


async def _persist_cloud_credential_if_changed(
    db: AsyncSession,
    *,
    user_id: UUID,
    provider: CloudAgentKind,
    payload: Mapping[str, object],
    auth_mode: CloudCredentialAuthMode,
) -> bool:
    stored_payload = dict(payload)
    return await sync_cloud_credential_if_changed(
        db,
        user_id,
        provider,
        encrypt_json(stored_payload),
        auth_mode,
        lambda payload_ciphertext: decrypt_json(payload_ciphertext) == stored_payload,
    )


async def delete_cloud_credential_for_user(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
) -> bool:
    return await delete_cloud_credential(db, user_id, provider)
