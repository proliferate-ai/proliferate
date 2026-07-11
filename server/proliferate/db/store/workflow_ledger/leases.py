"""Two-sided durable session leases (feature spec §8.2).

Postgres is authoritative for reservation. The partial unique index on
``workflow_session_lease`` (one non-released lease per ``session_id``) is the
hard guarantee; this module owns only the mechanical acquire/transition/read.
The prepare/commit/rollback installation protocol is WS7's.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import WorkflowSessionLease
from proliferate.db.store.workflow_ledger.records import (
    SESSION_LEASE_BLOCKING_STATES,
    SessionLeaseRecord,
    record_lease,
)
from proliferate.utils.time import utcnow


async def acquire_session_leases(
    db: AsyncSession,
    *,
    run_id: UUID,
    sessions: tuple[tuple[str, str | None], ...],
) -> tuple[SessionLeaseRecord, ...] | None:
    """Atomically reserve every ``(session_id, slot_id)`` for a run, or none.

    One ``INSERT ... ON CONFLICT DO NOTHING`` against the §8.2 partial unique
    index per session, all inside the caller's transaction. If any session
    already has a non-released lease the whole batch returns ``None`` and the
    caller MUST roll back the transaction so no partial reservation leaks (the
    store itself performs no partial commit).

    ``generation`` starts at prior released generation + 1 (monotonic fencing),
    computed per session from the max existing generation.
    """

    now = utcnow()
    acquired: list[SessionLeaseRecord] = []
    for session_id, slot_id in sessions:
        max_generation = (
            await db.execute(
                select(WorkflowSessionLease.generation)
                .where(WorkflowSessionLease.session_id == session_id)
                .order_by(WorkflowSessionLease.generation.desc())
                .limit(1)
            )
        ).scalar_one_or_none() or 0
        stmt = (
            pg_insert(WorkflowSessionLease)
            .values(
                id=uuid4(),
                session_id=session_id,
                run_id=run_id,
                slot_id=slot_id,
                state="reserved",
                generation=max_generation + 1,
                reserved_at=now,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=["session_id"],
                # Literal text (not bound parameters): Postgres must prove this
                # predicate matches the partial unique index to infer the arbiter.
                index_where=sa_text(
                    "state IN ('reserved', 'prepared', 'claimed', 'quiescing', 'orphaned')"
                ),
            )
            .returning(WorkflowSessionLease.id)
        )
        inserted_id = (await db.execute(stmt)).scalar_one_or_none()
        if inserted_id is None:
            return None
        row = await db.get(WorkflowSessionLease, inserted_id)
        assert row is not None
        acquired.append(record_lease(row))
    return tuple(acquired)


async def transition_session_lease(
    db: AsyncSession,
    *,
    lease_id: UUID,
    state: str,
) -> SessionLeaseRecord | None:
    """Mechanically move a lease to ``state`` and stamp the matching timestamp.

    The §8.2 prepare/commit/rollback *protocol* (which transitions are legal
    when) is WS7's; the store only persists the move.
    """

    row = await db.get(WorkflowSessionLease, lease_id)
    if row is None:
        return None
    now = utcnow()
    row.state = state
    if state == "reserved":
        row.reserved_at = now
    elif state == "prepared":
        row.prepared_at = now
    elif state == "claimed":
        row.claimed_at = now
    elif state == "released":
        row.released_at = now
    row.updated_at = now
    await db.flush()
    return record_lease(row)


async def get_active_session_lease(
    db: AsyncSession, *, session_id: str
) -> SessionLeaseRecord | None:
    """The single non-released lease for a session, if one exists."""

    row = (
        await db.execute(
            select(WorkflowSessionLease).where(
                WorkflowSessionLease.session_id == session_id,
                WorkflowSessionLease.state.in_(SESSION_LEASE_BLOCKING_STATES),
            )
        )
    ).scalar_one_or_none()
    return None if row is None else record_lease(row)


async def list_session_leases_for_run(
    db: AsyncSession, *, run_id: UUID
) -> tuple[SessionLeaseRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowSessionLease)
                .where(WorkflowSessionLease.run_id == run_id)
                .order_by(WorkflowSessionLease.session_id.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(record_lease(row) for row in rows)
