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

from sqlalchemy import case, select
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

    ONE statement, always, and the returned sequence is ALWAYS the sequence
    the returned fingerprint was stored with — that pairing is what the
    runtime's equal-sequence acceptance and the idempotent re-ack read as
    "equal sequence means identical content".

    The first render for a scope inserts the row at sequence 1; a conflicting
    writer lands in the ON CONFLICT arm, which has NO ``WHERE`` predicate and
    therefore always updates and always returns a row. The decision lives in
    the SET expression instead: ``sequence`` advances only when the stored
    fingerprint differs from the incoming one, and holds for a no-op render.

    Why the predicate moved out of ``WHERE``: the suppressed arm returned no
    row, so the sequence had to be re-read by a SECOND statement, and the
    pairing then rested on a Postgres subtlety — ``ON CONFLICT DO UPDATE``
    locks the conflicting row BEFORE evaluating its ``WHERE``, so the row could
    not move under the re-read (verified: a suppressed upsert blocks a
    concurrent bump until it commits). Correct, but correct for a reason
    nothing in the code stated and a future reader could not check. With one
    statement the pairing is structural: the sequence returned is the sequence
    written next to the fingerprint written, in the same tuple.

    Cost, accepted deliberately: the conflict arm now writes a new row version
    on every render, including no-op ones, where the old form wrote none. The
    scope is one narrow row per (user, surface) and no indexed column changes,
    so the updates are HOT-eligible; the invariant is worth the churn.
    ``rendered_at`` and ``updated_at`` stay conditional so a no-op render still
    leaves the row's VALUES identical ("a no-op render changes neither",
    spec §2) — only the physical tuple is new.
    """
    if surface not in AGENT_AUTH_SURFACES:
        raise ValueError(f"Unknown agent auth surface: {surface}")
    now = utcnow()
    content_changed = AgentAuthRenderSequence.fingerprint.is_distinct_from(fingerprint)
    # ``scalar_one`` (never ``scalar_one_or_none``): with no ``WHERE`` on the
    # conflict arm, both arms return a row, so a missing row is a real invariant
    # break and must raise rather than be papered over.
    return (
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
                    "sequence": case(
                        (content_changed, AgentAuthRenderSequence.sequence + 1),
                        else_=AgentAuthRenderSequence.sequence,
                    ),
                    # Unconditional: on the held arm the stored value already
                    # equals this one (that is what `content_changed` false
                    # means), so writing it changes nothing.
                    "fingerprint": fingerprint,
                    "rendered_at": case(
                        (content_changed, now),
                        else_=AgentAuthRenderSequence.rendered_at,
                    ),
                    "updated_at": case(
                        (content_changed, now),
                        else_=AgentAuthRenderSequence.updated_at,
                    ),
                },
            )
            .returning(AgentAuthRenderSequence.sequence)
        )
    ).scalar_one()


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
