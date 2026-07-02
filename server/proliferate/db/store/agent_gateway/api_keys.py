"""Personal agent API key pool persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_PROVIDERS,
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_API_KEY_STATUS_REVOKED,
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
)
from proliferate.db.models.cloud.agent_gateway import AgentApiKey
from proliferate.db.store.agent_gateway.mappers import api_key_record
from proliferate.db.store.agent_gateway.records import AgentApiKeyRecord
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow


def build_redacted_hint(payload: str) -> str:
    """A safe display hint like ``sk-...abc4`` built from the raw key."""
    tail = payload[-4:] if len(payload) >= 4 else payload
    prefix = payload.split("-", 1)[0] if "-" in payload[:12] else ""
    shown_prefix = f"{prefix}-" if prefix and len(prefix) <= 8 else ""
    return f"{shown_prefix}...{tail}"


async def create_agent_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    provider: str,
    display_name: str,
    payload: str,
) -> AgentApiKeyRecord:
    if provider not in AGENT_API_KEY_PROVIDERS:
        raise ValueError(f"Unsupported agent API key provider: {provider}")
    if not payload:
        raise ValueError("Agent API key payload must not be empty.")
    row = AgentApiKey(
        user_id=user_id,
        provider=provider,
        display_name=display_name,
        payload_ciphertext=encrypt_text(payload),
        payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        redacted_hint=build_redacted_hint(payload),
        status=AGENT_API_KEY_STATUS_ACTIVE,
    )
    db.add(row)
    await db.flush()
    return api_key_record(row)


async def revoke_agent_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> AgentApiKeyRecord | None:
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.status != AGENT_API_KEY_STATUS_REVOKED:
        now = utcnow()
        row.status = AGENT_API_KEY_STATUS_REVOKED
        row.revoked_at = now
        row.updated_at = now
        await db.flush()
    return api_key_record(row)


async def list_agent_api_keys(
    db: AsyncSession,
    *,
    user_id: UUID,
    include_revoked: bool = False,
) -> list[AgentApiKeyRecord]:
    query = select(AgentApiKey).where(AgentApiKey.user_id == user_id)
    if not include_revoked:
        query = query.where(AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE)
    rows = (await db.execute(query.order_by(AgentApiKey.created_at))).scalars().all()
    return [api_key_record(row) for row in rows]


async def get_agent_api_key_decrypted(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> tuple[AgentApiKeyRecord, str] | None:
    """Internal-use fetch of the raw key payload for materialization."""
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.user_id == user_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return api_key_record(row), decrypt_text(row.payload_ciphertext)
