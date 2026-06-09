"""Read-only loaders for agent-auth-owned synced credentials."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentAuthSyncedCredentialRecord,
)
from proliferate.server.cloud.agent_auth.domain.status import (
    CredentialStatusRecord,
    build_credential_statuses,
)
from proliferate.server.cloud.agent_auth.domain.synced_payload import (
    synced_payload_provider_matches,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.utils.crypto import decrypt_json


async def list_synced_credential_statuses_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> list[CredentialStatusRecord]:
    credentials = await list_selected_synced_credentials_for_request(db, user_id)
    return build_credential_statuses(credentials)


async def list_selected_synced_credentials_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> list[AgentAuthSyncedCredentialRecord]:
    credentials = await store.list_selected_personal_synced_credentials_for_user(db, user_id)
    return [_synced_credential_record(credential) for credential in credentials]


async def load_synced_credential_statuses(user_id: UUID) -> list[CredentialStatusRecord]:
    async with db_engine.async_session_factory() as db:
        return await list_synced_credential_statuses_for_request(db, user_id)


async def load_selected_synced_credentials_for_user(
    user_id: UUID,
) -> list[AgentAuthSyncedCredentialRecord]:
    async with db_engine.async_session_factory() as db:
        return await list_selected_synced_credentials_for_request(db, user_id)


def _synced_credential_record(
    credential: AgentAuthCredentialRecord,
) -> AgentAuthSyncedCredentialRecord:
    payload = _decrypt_synced_payload(credential)
    auth_mode = payload.get("authMode")
    if auth_mode not in {"env", "file"}:
        raise AgentAuthError(
            "Synced credential payload is invalid.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    return AgentAuthSyncedCredentialRecord(
        id=credential.id,
        provider=credential.credential_provider_id,
        auth_mode=auth_mode,
        payload_ciphertext=credential.payload_ciphertext or "",
        payload_format=f"agent-auth-json-v1:revision:{credential.revision}",
        revoked_at=credential.revoked_at,
        last_synced_at=credential.updated_at,
        updated_at=credential.updated_at,
    )


def _decrypt_synced_payload(credential: AgentAuthCredentialRecord) -> dict[str, object]:
    if credential.payload_ciphertext is None:
        raise AgentAuthError(
            "Synced credential is missing its source payload.",
            code="synced_credential_source_missing",
            status_code=409,
        )
    payload = decrypt_json(credential.payload_ciphertext)
    if not isinstance(payload, dict) or not synced_payload_provider_matches(
        payload_provider=payload.get("provider"),
        credential_provider_id=credential.credential_provider_id,
        redacted_summary_json=credential.redacted_summary_json,
    ):
        raise AgentAuthError(
            "Synced credential payload is invalid.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    return payload
