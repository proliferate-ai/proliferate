"""Personal agent API key vault persistence (titled secrets)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
    AGENT_API_KEY_KIND_API_KEY,
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_API_KEY_STATUS_REVOKED,
    AGENT_API_KEY_TYPED_KINDS,
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
)
from proliferate.db.models.agent_gateway import AgentApiKey
from proliferate.db.store.agent_gateway.mappers import api_key_record
from proliferate.db.store.agent_gateway.records import AgentApiKeyRecord
from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.lib.infra.time.wall_clock import utcnow


def build_redacted_hint(value: str) -> str:
    """A safe display hint like ``sk-...abc4`` built from the raw secret."""
    tail = value[-4:] if len(value) >= 4 else value
    prefix = value.split("-", 1)[0] if "-" in value[:12] else ""
    shown_prefix = f"{prefix}-" if prefix and len(prefix) <= 8 else ""
    return f"{shown_prefix}...{tail}"


async def create_agent_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    value: str,
) -> AgentApiKeyRecord:
    if not title.strip():
        raise ValueError("Agent API key title must not be empty.")
    if not value:
        raise ValueError("Agent API key value must not be empty.")
    row = AgentApiKey(
        user_id=user_id,
        title=title,
        kind=AGENT_API_KEY_KIND_API_KEY,
        value_ciphertext=encrypt_text(value, secret=settings.cloud_secret_key),
        encryption_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        redacted_hint=build_redacted_hint(value),
        status=AGENT_API_KEY_STATUS_ACTIVE,
    )
    db.add(row)
    await db.flush()
    return api_key_record(row)


async def create_agent_provider_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    kind: str,
    value: dict[str, str],
) -> AgentApiKeyRecord:
    """Create a typed vault entry (agent-auth.md's vault table).

    ``value`` is the field-spec's key -> entered-value map (D2's
    ``ProviderConfigCreatorSubmit.value``); it is JSON-encrypted verbatim, so
    the redacted hint cannot reuse ``build_redacted_hint``'s single-secret-tail
    convention — there is no one string to show a fragment of. The title is
    the only human-facing label for a typed entry, same as the redacted-hint
    caveat already documented for the bare-secret kind.
    """
    if not title.strip():
        raise ValueError("Agent API key title must not be empty.")
    if kind not in AGENT_API_KEY_TYPED_KINDS:
        raise ValueError(f"Unsupported provider-config kind: {kind}")
    if not value or not all(v.strip() for v in value.values()):
        raise ValueError("Provider-config values must be non-empty strings.")
    row = AgentApiKey(
        user_id=user_id,
        title=title,
        kind=kind,
        value_ciphertext=encrypt_json(value, secret=settings.cloud_secret_key),
        encryption_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        redacted_hint=f"{kind}:{len(value)} field(s)",
        status=AGENT_API_KEY_STATUS_ACTIVE,
    )
    db.add(row)
    await db.flush()
    return api_key_record(row)


async def create_agent_seat(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    value: str,
) -> AgentApiKeyRecord:
    """Create a seat vault entry (``kind='anthropic_subscription'``).

    ``value`` is the mint flow's captured ``claude setup-token`` credential —
    one opaque secret string, encrypted exactly like a bare key. The title is
    the user-entered seat identity (email + optional plan tag), composed by
    the service layer; this store only persists it.
    """
    if not title.strip():
        raise ValueError("Agent seat title must not be empty.")
    if not value:
        raise ValueError("Agent seat token must not be empty.")
    row = AgentApiKey(
        user_id=user_id,
        title=title,
        kind=AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
        value_ciphertext=encrypt_text(value, secret=settings.cloud_secret_key),
        encryption_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        redacted_hint=build_redacted_hint(value),
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
        row.status = AGENT_API_KEY_STATUS_REVOKED
        row.updated_at = utcnow()
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
    """Internal-use fetch of the raw key value for materialization.

    Scoped to ``kind='api_key'`` rows only, so a typed vault entry is
    invisible here — the caller cannot accidentally decrypt a Bedrock/Azure
    JSON document as a plain string. Materialization dispatches on the
    referencing selection's shape (agent-auth.md's selection-model table: an
    ``api_key`` source names an ``env_var_name`` only when the entry is
    bare), so it already knows which of this fetch or
    ``get_agent_provider_config_decrypted`` applies before calling either.
    """
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.user_id == user_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                AgentApiKey.kind == AGENT_API_KEY_KIND_API_KEY,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return api_key_record(row), decrypt_text(
        row.value_ciphertext, secret=settings.cloud_secret_key
    )


async def get_agent_seat_decrypted(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> tuple[AgentApiKeyRecord, str] | None:
    """Decrypt one active seat entry for the renderer (a pinned seat row).

    Kind-scoped to ``anthropic_subscription`` so a selection pinning a
    non-seat vault entry resolves to nothing (its source is then dropped and
    the harness fails closed at launch). Decryption happens in the render
    path only, same trust model as ``get_agent_api_key_decrypted``.
    """
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.user_id == user_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                AgentApiKey.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return api_key_record(row), decrypt_text(
        row.value_ciphertext, secret=settings.cloud_secret_key
    )


async def list_active_agent_seats(
    db: AsyncSession,
) -> list[AgentApiKeyRecord]:
    """Every ACTIVE seat across ALL users, vault order — the usage-probe roster.

    Records only, no decryption: flow 5's probe loop lists the roster cheaply
    every tick and decrypts only the seats actually due for a probe (via
    ``get_agent_seat_decrypted_for_probe``). Revoked seats are absent, which
    is what "off for revoked seats" means mechanically.
    """
    rows = (
        (
            await db.execute(
                select(AgentApiKey)
                .where(
                    AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                    AgentApiKey.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
                )
                .order_by(AgentApiKey.created_at, AgentApiKey.id)
            )
        )
        .scalars()
        .all()
    )
    return [api_key_record(row) for row in rows]


async def get_agent_seat_decrypted_for_probe(
    db: AsyncSession,
    *,
    api_key_id: UUID,
) -> tuple[AgentApiKeyRecord, str] | None:
    """Decrypt one active seat WITHOUT a user scope — the usage probe's fetch.

    The third sanctioned decryption site (agent_auth spec §2's vault comment:
    the renderer, the authed ``GET /state``, and the seat usage probe). Only
    the server-internal probe loop and the authed pane-open poke call it; the
    decrypted token exists in memory for the one-token request only and never
    reaches samples, logs, or errors. Kind- and status-scoped, so a revoked or
    non-seat row resolves to nothing and the caller skips.
    """
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                AgentApiKey.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return api_key_record(row), decrypt_text(
        row.value_ciphertext, secret=settings.cloud_secret_key
    )


async def list_agent_seats_decrypted(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[tuple[AgentApiKeyRecord, str]]:
    """Decrypt every ACTIVE seat entry, in vault order (``created_at``).

    The renderer expands a pool seat row (``api_key_id`` NULL) into one wire
    source per active seat, in exactly this order (agent_auth spec §2's "seat
    selection shape"). A revoked seat is simply absent, so its source
    vanishes at the next render pass.
    """
    rows = (
        (
            await db.execute(
                select(AgentApiKey)
                .where(
                    AgentApiKey.user_id == user_id,
                    AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                    AgentApiKey.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
                )
                .order_by(AgentApiKey.created_at, AgentApiKey.id)
            )
        )
        .scalars()
        .all()
    )
    return [
        (
            api_key_record(row),
            decrypt_text(row.value_ciphertext, secret=settings.cloud_secret_key),
        )
        for row in rows
    ]


async def get_agent_provider_config_decrypted(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> tuple[AgentApiKeyRecord, dict[str, str]] | None:
    """Internal-use fetch of a typed vault entry's decrypted field map.

    Symmetric with ``get_agent_api_key_decrypted`` for the bare-secret kind;
    materialization (D3) picks whichever fetch matches the referenced row's
    ``kind`` — there is no ``env_var_name`` on a selection referencing a typed
    entry (agent-auth.md's selection-model table), so the caller already
    knows which fetch applies before calling either.
    """
    row = (
        await db.execute(
            select(AgentApiKey).where(
                AgentApiKey.id == api_key_id,
                AgentApiKey.user_id == user_id,
                AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                AgentApiKey.kind.in_(AGENT_API_KEY_TYPED_KINDS),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return api_key_record(row), decrypt_json(
        row.value_ciphertext, secret=settings.cloud_secret_key
    )
