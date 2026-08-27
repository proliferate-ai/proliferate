"""Agent-auth render-sequence persistence (per user/surface counter).

The persisted counter behind the wire document's ``sequence`` field
(agent_auth spec §2 "How delivery is governed"): monotonic per (user,
surface), bumped ONLY by a render whose ``harnesses`` content changed. The
renderer computes the content hash and calls
:func:`bump_render_sequence_if_changed`; content changes that touch no
selection row — a vault key/seat revoke, a virtual-key rotation, budget
withholding, enrollment reaching synced — bump through exactly the same door,
because they change what the renderer emits. A no-op render leaves both the
sequence and the fingerprint untouched.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import AGENT_AUTH_SURFACES
from proliferate.db.models.agent_auth_delivery import AgentAuthRenderSequence
from proliferate.db.store.agent_gateway.mappers import render_sequence_record
from proliferate.db.store.agent_gateway.records import AgentAuthRenderSequenceRecord
from proliferate.lib.infra.time.wall_clock import utcnow

_FIRST_SEQUENCE = 1


async def bump_render_sequence_if_changed(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
    fingerprint: str,
) -> int:
    """Advance the scope's sequence iff ``fingerprint`` differs; return it.

    ONE atomic Postgres upsert, so two concurrent renders cannot race a
    check-then-write into a lost bump or a unique-constraint failure: the
    first render for a scope inserts the row at sequence 1; a conflicting
    writer lands in the ON CONFLICT arm, whose predicate suppresses the
    update when the stored fingerprint already equals the incoming one (the
    no-op render). A suppressed update returns no row, and the current
    sequence is re-read unchanged.
    """
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    now = utcnow()
    sequence = (
        await db.execute(
            pg_insert(AgentAuthRenderSequence)
            .values(
                user_id=user_id,
                surface=surface,
                sequence=_FIRST_SEQUENCE,
                fingerprint=fingerprint,
                rendered_at=now,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_agent_auth_render_sequence_scope",
                set_={
                    "sequence": AgentAuthRenderSequence.sequence + 1,
                    "fingerprint": fingerprint,
                    "rendered_at": now,
                    "updated_at": now,
                },
                where=AgentAuthRenderSequence.fingerprint.is_distinct_from(fingerprint),
            )
            .returning(AgentAuthRenderSequence.sequence)
        )
    ).scalar_one_or_none()
    if sequence is not None:
        return sequence
    # Unchanged content: the predicate suppressed the update, so the stored
    # sequence is current — the no-op render's "changes neither" guarantee.
    current = await get_render_sequence(db, user_id=user_id, surface=surface)
    assert current is not None
    return current.sequence


async def get_render_sequence(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> AgentAuthRenderSequenceRecord | None:
    """The scope's current rendered (sequence, fingerprint) row, if any renders ran."""
    row = (
        await db.execute(
            select(AgentAuthRenderSequence)
            .where(
                AgentAuthRenderSequence.user_id == user_id,
                AgentAuthRenderSequence.surface == surface,
            )
            # The bump upsert writes through Core (never the ORM), so an
            # identity-mapped instance loaded earlier in this session would
            # otherwise serve pre-bump values.
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return render_sequence_record(row) if row is not None else None
