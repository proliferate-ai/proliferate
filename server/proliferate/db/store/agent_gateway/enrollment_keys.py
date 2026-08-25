"""Per-(enrollment, harness) LiteLLM virtual key row persistence.

Child table of ``agent_gateway_enrollment`` (model-gateway.md §Account model):
the enrollment stays the single team/money boundary, but each gateway-capable
harness gets its own access-group-scoped virtual key here, keyed by
``(enrollment_id, harness_kind)``.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import AGENT_GATEWAY_CIPHERTEXT_KEY_ID
from proliferate.db.models.agent_gateway import AgentGatewayEnrollmentKey
from proliferate.db.store.agent_gateway.mappers import enrollment_key_record
from proliferate.db.store.agent_gateway.records import AgentGatewayEnrollmentKeyRecord
from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.lib.infra.time.wall_clock import utcnow


async def list_active_enrollment_keys(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> list[AgentGatewayEnrollmentKeyRecord]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollmentKey).where(
                    AgentGatewayEnrollmentKey.enrollment_id == enrollment_id,
                    AgentGatewayEnrollmentKey.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_key_record(row) for row in rows]


async def list_all_active_enrollment_keys(
    db: AsyncSession,
    *,
    limit: int = 1000,
) -> list[AgentGatewayEnrollmentKeyRecord]:
    """Every active (non-revoked) per-harness key, for the verification loop.

    Ordered by ``updated_at`` so a bounded tick walks the least-recently-touched
    keys first; the loop re-runs on its interval to cover the rest.
    """
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollmentKey)
                .where(AgentGatewayEnrollmentKey.revoked_at.is_(None))
                .order_by(AgentGatewayEnrollmentKey.updated_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_key_record(row) for row in rows]


async def record_enrollment_key_verification(
    db: AsyncSession,
    *,
    enrollment_key_id: UUID,
    status: str,
    delta: str | None,
    verified_at: datetime,
) -> None:
    """Persist a gateway-enablement verification verdict (agent-auth.md FR-3).

    Called only for a CONCLUSIVE verdict (``ok`` or ``misconfigured``); an error
    inside the loop never reaches here, so a last-known-good verdict is never
    overwritten by a transient LiteLLM blip.
    """
    row = await db.get(AgentGatewayEnrollmentKey, enrollment_key_id)
    if row is None:
        return
    row.verification_status = status
    row.verification_delta = delta
    row.verified_at = verified_at
    await db.flush()


async def get_active_enrollment_key(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
    harness_kind: str,
) -> AgentGatewayEnrollmentKeyRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayEnrollmentKey).where(
                AgentGatewayEnrollmentKey.enrollment_id == enrollment_id,
                AgentGatewayEnrollmentKey.harness_kind == harness_kind,
                AgentGatewayEnrollmentKey.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return enrollment_key_record(row) if row is not None else None


async def get_enrollment_key_by_virtual_key_id(
    db: AsyncSession,
    *,
    virtual_key_id: str,
) -> AgentGatewayEnrollmentKeyRecord | None:
    """Resolve an active child key row from a LiteLLM key token hash.

    Mirrors ``enrollments.get_enrollment_by_virtual_key_id`` (the pre-B2
    single-key lookup): the importer keys off the spend-log ``api_key`` field,
    which equals the ``token_id`` stored as ``virtual_key_id`` at mint time.
    """
    row = (
        await db.execute(
            select(AgentGatewayEnrollmentKey).where(
                AgentGatewayEnrollmentKey.virtual_key_id == virtual_key_id,
                AgentGatewayEnrollmentKey.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return enrollment_key_record(row) if row is not None else None


async def upsert_enrollment_key(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
    harness_kind: str,
    virtual_key_id: str | None,
    virtual_key: str | None,
    sync_fingerprint: str | None,
) -> AgentGatewayEnrollmentKeyRecord:
    """Create or update the active (enrollment, harness) key row.

    ``virtual_key`` is only re-encrypted when provided (a resync that didn't
    mint a fresh key passes ``None`` and keeps the stored ciphertext, mirroring
    ``mark_enrollment_synced``'s treatment of the parent key).
    """
    row = (
        await db.execute(
            select(AgentGatewayEnrollmentKey).where(
                AgentGatewayEnrollmentKey.enrollment_id == enrollment_id,
                AgentGatewayEnrollmentKey.harness_kind == harness_kind,
                AgentGatewayEnrollmentKey.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayEnrollmentKey(
            enrollment_id=enrollment_id,
            harness_kind=harness_kind,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    row.virtual_key_id = virtual_key_id
    if virtual_key is not None:
        row.virtual_key_ciphertext = encrypt_text(virtual_key, secret=settings.cloud_secret_key)
        row.virtual_key_ciphertext_key_id = AGENT_GATEWAY_CIPHERTEXT_KEY_ID
    row.sync_fingerprint = sync_fingerprint
    row.updated_at = now
    await db.flush()
    return enrollment_key_record(row)


async def get_enrollment_key_virtual_key_decrypted(
    db: AsyncSession,
    *,
    enrollment_key_id: UUID,
) -> str | None:
    """Internal-use fetch of the raw per-harness virtual key for materialization."""
    row = await db.get(AgentGatewayEnrollmentKey, enrollment_key_id)
    if row is None or row.virtual_key_ciphertext is None:
        return None
    return decrypt_text(row.virtual_key_ciphertext, secret=settings.cloud_secret_key)


async def revoke_enrollment_keys(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> int:
    """Revoke every active child key for an enrollment (parent revocation cascade)."""
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollmentKey).where(
                    AgentGatewayEnrollmentKey.enrollment_id == enrollment_id,
                    AgentGatewayEnrollmentKey.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
        row.updated_at = now
    if rows:
        await db.flush()
    return len(rows)
