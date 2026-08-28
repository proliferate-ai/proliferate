"""Agent-auth delivery acknowledgement persistence (per user/surface stamp).

The "Applied means acknowledged" seam (agent_auth spec §2): one row per
(user, surface) recording the last rendered ``state.json`` a surface's
runtime confirmed. There is exactly ONE writer: the delivery-ack route, which
stamps what the local runtime's state push accepted, relayed by the desktop
courier. ``surface='cloud'`` is retained dormant (spec §2) — the cloud
materializer that once stamped it was deleted in the cull, and the surface
waits for the environments rebuild rather than migrating out and back.
Readers derive pending-vs-applied by comparing the CURRENT rendered
``(sequence, fingerprint)`` against the stamp: applied requires BOTH. Equal
sequence carries equal content by construction (the sequence bumps exactly
when content changes), so a re-ack at the stored sequence is idempotent and
a lower one is inert.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import AGENT_AUTH_SURFACES
from proliferate.db.models.agent_gateway import AgentAuthDeliveryAck
from proliferate.db.store.agent_gateway.mappers import delivery_ack_record
from proliferate.db.store.agent_gateway.records import AgentAuthDeliveryAckRecord
from proliferate.lib.infra.time.wall_clock import utcnow


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
    sequence: int,
    fingerprint: str,
) -> AgentAuthDeliveryAckRecord:
    """Stamp an acknowledged delivery; latest wins, out-of-order acks are inert.

    An ack whose ``sequence`` is LOWER than the stored one is a delayed
    confirmation of a superseded document (the runtime itself rejects such a
    push as stale) — it must not move the stamp backwards, so the stored row
    is returned unchanged. An EQUAL sequence is an idempotent re-ack: equal
    sequence can no longer carry different content (the sequence bumps exactly
    when the rendered content changes), so re-stamping the same pair is
    harmless and never an error.

    Written as a single ``INSERT ... ON CONFLICT (user_id, surface) DO
    UPDATE`` so two concurrent FIRST acks for the same scope cannot race a
    check-then-insert into a unique-constraint failure: the loser of the
    insert race lands in the conflict arm, where the same only-move-forward
    sequence predicate applies. A predicate-suppressed update (stale ack)
    returns no row, and the stored stamp is re-read unchanged.
    """
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(AgentAuthDeliveryAck)
            .values(
                user_id=user_id,
                surface=surface,
                acked_sequence=sequence,
                acked_fingerprint=fingerprint,
                acked_at=now,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_agent_auth_delivery_ack_scope",
                set_={
                    "acked_sequence": sequence,
                    "acked_fingerprint": fingerprint,
                    "acked_at": now,
                    "updated_at": now,
                },
                # Only move forward: strictly newer sequences advance the
                # stamp; an equal sequence is an idempotent re-ack (same
                # content by construction); an older one is inert.
                where=AgentAuthDeliveryAck.acked_sequence <= sequence,
            )
            .returning(AgentAuthDeliveryAck)
        )
    ).scalar_one_or_none()
    if row is None:
        # The conflict predicate suppressed the update — a delayed ack for a
        # superseded document. The scope row necessarily exists.
        row = await _load_row(db, user_id=user_id, surface=surface)
        if row is None:
            # Only reachable if the conflicting row vanished between the upsert
            # and this read (a concurrent user delete cascading the scope away).
            # Raise a real error rather than assert: under ``python -O`` an
            # assert compiles away and the next line would dereference None.
            raise RuntimeError(f"Delivery ack row vanished for user {user_id} surface {surface!r}")
        # The suppressed UPDATE never reached the ORM, so the identity-mapped
        # instance (if any) is already current; no refresh needed.
        return delivery_ack_record(row)
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
