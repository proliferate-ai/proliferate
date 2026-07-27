"""Agent-auth delivery acknowledgement persistence (per user/surface stamp).

The "Applied means acknowledged" seam (agent-auth.md): one row per
(user, surface) recording the last rendered ``state.json`` a surface's
runtime confirmed. Writers are the two delivery pipelines — the cloud
materializer stamps after its sandbox operation completes, and the desktop
ack route stamps what the local runtime's state push accepted. Readers derive
pending-vs-applied by comparing the CURRENT rendered (revision, fingerprint)
against the stamp; the fingerprint is the change detector, the revision only
rejects an out-of-order (delayed) ack for an older document.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import AGENT_AUTH_SURFACES
from proliferate.db.models.cloud.agent_gateway import AgentAuthDeliveryAck
from proliferate.db.store.agent_gateway.mappers import delivery_ack_record
from proliferate.db.store.agent_gateway.records import AgentAuthDeliveryAckRecord
from proliferate.utils.time import utcnow


async def get_delivery_ack(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> AgentAuthDeliveryAckRecord | None:
    row = await _load_row(db, user_id=user_id, surface=surface)
    return delivery_ack_record(row) if row is not None else None


async def record_delivery_ack(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
    revision: int,
    fingerprint: str,
) -> AgentAuthDeliveryAckRecord:
    """Stamp an acknowledged delivery; latest wins, out-of-order acks are inert.

    An ack whose ``revision`` is LOWER than the stored one is a delayed
    confirmation of a superseded document (the runtime itself rejects such a
    push as stale) — it must not move the stamp backwards, so the stored row
    is returned unchanged. An EQUAL revision is content-authoritative (key
    rotation without a selection edit) and updates the fingerprint.
    """
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    row = await _load_row(db, user_id=user_id, surface=surface)
    if row is None:
        row = AgentAuthDeliveryAck(
            user_id=user_id,
            surface=surface,
            acked_revision=revision,
            acked_fingerprint=fingerprint,
            acked_at=utcnow(),
        )
        db.add(row)
        await db.flush()
        return delivery_ack_record(row)
    if revision < row.acked_revision:
        return delivery_ack_record(row)
    row.acked_revision = revision
    row.acked_fingerprint = fingerprint
    row.acked_at = utcnow()
    row.updated_at = utcnow()
    await db.flush()
    return delivery_ack_record(row)


async def _load_row(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> AgentAuthDeliveryAck | None:
    return (
        await db.execute(
            select(AgentAuthDeliveryAck).where(
                AgentAuthDeliveryAck.user_id == user_id,
                AgentAuthDeliveryAck.surface == surface,
            )
        )
    ).scalar_one_or_none()
