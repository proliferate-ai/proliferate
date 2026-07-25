"""Generation-fenced, reclaimable workflow outbox substrate (WF-OUTBOX).

The producing intent + its outbox row commit in one transaction (``enqueue_outbox``
is flush-only). After commit a relay *claims* a due row under a monotonic fence —
``claim_generation`` (never reset) plus an unpredictable per-claim ``claim_id`` —
and an expiry lease. Every post-claim write (heartbeat, success, retry, terminal
failure, dead-letter, continuation) is a compare-and-set on the EXACT fence; a
mismatch is a typed rejection (rowcount 0, zero side effects), never an exception.

Substrate mechanics only — no business semantics. Schedule/poll/notification/
delivery logic lives in the owning packets; this module never starts an agent,
enqueues Celery work, or infers external-effect completion from row state.

Fence & authority rules (D5/D6/R1):
- The claim/reclaim candidate query is a single atomic ``UPDATE ... FROM (SELECT
  ... FOR UPDATE SKIP LOCKED)``; active leases (``claim_expires_at > now``) are
  structurally invisible, so a live claim can never be stolen. Kind scoping (R9)
  is enforced INSIDE the locked subselect.
- A reclaim of an expired claim bumps the generation and mints a fresh claim_id,
  so a stale claimant's later CAS matches zero rows.
- Heartbeat additionally requires an unexpired lease: an expired claim's renewal
  authority is gone. Completion/failure/reschedule/dead-letter do NOT carry that
  predicate — expiry alone does not revoke result authority; a same-fence
  completion and a higher-generation reclaim race as atomic CAS and whichever
  commits first wins (R1).
- ``max_attempts`` bounds crash/reclaim loops (R7): the work-claim query excludes
  rows at the ceiling, and such rows are terminalized to ``dead_letter`` under a
  reclaim-shaped (higher-generation) CAS in the same claim cycle.
- Every applied result CAS appends an immutable ``WorkflowOutboxResult`` receipt
  keyed by ``(outbox_id, claim_generation)``; a same-identity retry after a lost
  commit replays that durable receipt (R2/R8) rather than looking like a stale
  claimant.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import bindparam, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflow_outbox import (
    FAILURE_MAX_ATTEMPTS_EXHAUSTED,
    MAX_CLAIMED_BY_LEN,
    MAX_DEDUPE_KEY_LEN,
    MAX_EFFECT_KEY_LEN,
    MAX_SUBJECT_ID_LEN,
    OUTBOX_FAILURE_CODES,
    OUTBOX_KINDS,
    OUTBOX_SUBJECT_KINDS,
    RESULT_CONTINUED,
    RESULT_DEAD_LETTER,
    RESULT_FAILED_TERMINAL,
    RESULT_RESCHEDULED,
    RESULT_SUCCEEDED,
    STATUS_CLAIMED,
    STATUS_DEAD_LETTER,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_SUCCEEDED,
    default_max_attempts,
)
from proliferate.db.models.cloud.workflow_ledger import WorkflowOutboxResult, WorkflowRunOutbox
from proliferate.db.store.workflow_ledger.records import (
    OutboxRecord,
    OutboxResultRecord,
    OutboxWriteResult,
    record_outbox,
    record_outbox_result,
)
from proliferate.utils.time import utcnow

_POPULATE = {"populate_existing": True}


def _bounded(value: str | None, *, limit: int, label: str) -> str | None:
    """Reject a handle that is not a structurally bounded, secret-free string."""

    if value is None:
        return None
    if not value or len(value) > limit:
        raise ValueError(f"{label} must be 1..{limit} chars (got {len(value)})")
    return value


# --- enqueue (flush-only insert inside the caller's transaction; D7/R3) -------------


async def enqueue_outbox(
    db: AsyncSession,
    *,
    kind: str,
    subject_kind: str,
    subject_id: str,
    run_id: UUID | None = None,
    trigger_id: UUID | None = None,
    effect_key: str | None = None,
    dedupe_key: str | None = None,
    next_attempt_at: datetime | None = None,
) -> OutboxRecord:
    """Insert a pending outbox row inside the caller's transaction.

    Closed-vocabulary + bounded-handle validation happens here (R10): unknown
    ``kind``/``subject_kind`` or an over-long handle is rejected before any write.
    A ``dedupe_key`` dedupes per ``(kind, dedupe_key)`` (R3): a conflicting insert
    is a no-op that returns the existing row (no second row, no second run).
    """

    if kind not in OUTBOX_KINDS:
        raise ValueError(f"unknown outbox kind {kind!r}")
    if subject_kind not in OUTBOX_SUBJECT_KINDS:
        raise ValueError(f"unknown outbox subject_kind {subject_kind!r}")
    _bounded(subject_id, limit=MAX_SUBJECT_ID_LEN, label="subject_id")
    _bounded(effect_key, limit=MAX_EFFECT_KEY_LEN, label="effect_key")
    _bounded(dedupe_key, limit=MAX_DEDUPE_KEY_LEN, label="dedupe_key")

    now = utcnow()
    values = {
        "id": uuid4(),
        "subject_kind": subject_kind,
        "subject_id": subject_id,
        "run_id": run_id,
        "trigger_id": trigger_id,
        "kind": kind,
        "effect_key": effect_key,
        "dedupe_key": dedupe_key,
        "status": STATUS_PENDING,
        "attempt_count": 0,
        "max_attempts": default_max_attempts(kind),
        "next_attempt_at": next_attempt_at or now,
        "claim_generation": 0,
        "created_at": now,
        "updated_at": now,
    }

    if dedupe_key is None:
        row = WorkflowRunOutbox(**values)
        db.add(row)
        await db.flush()
        return record_outbox(row)

    stmt = (
        pg_insert(WorkflowRunOutbox)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=["kind", "dedupe_key"],
            index_where=text("dedupe_key IS NOT NULL"),
        )
        .returning(WorkflowRunOutbox.id)
    )
    inserted = (await db.execute(stmt)).scalar_one_or_none()
    if inserted is None:
        existing = (
            await db.execute(
                select(WorkflowRunOutbox).where(
                    WorkflowRunOutbox.kind == kind,
                    WorkflowRunOutbox.dedupe_key == dedupe_key,
                )
            )
        ).scalar_one()
        return record_outbox(existing)
    await db.flush()
    row = (
        await db.execute(select(WorkflowRunOutbox).where(WorkflowRunOutbox.id == inserted))
    ).scalar_one()
    return record_outbox(row)


# --- claim / reclaim (single atomic SKIP LOCKED statement; D4/R7/R9) ----------------

_ELIGIBLE = (
    "kind IN :kinds "
    "AND ((status = 'pending' AND next_attempt_at <= :now) "
    "OR (status = 'claimed' AND claim_expires_at <= :now))"
)

_TERMINALIZE_EXHAUSTED_SQL = text(
    f"""
    UPDATE workflow_run_outbox AS o
    SET status = 'dead_letter',
        claim_generation = o.claim_generation + 1,
        claim_id = gen_random_uuid(),
        claimed_by = :claimed_by,
        claimed_at = :now,
        claim_expires_at = NULL,
        last_heartbeat_at = NULL,
        last_failure_code = '{FAILURE_MAX_ATTEMPTS_EXHAUSTED}',
        diagnostic_id = gen_random_uuid(),
        dead_lettered_at = :now,
        updated_at = :now
    FROM (
        SELECT id FROM workflow_run_outbox
        WHERE {_ELIGIBLE} AND attempt_count >= max_attempts
        ORDER BY next_attempt_at, created_at, id
        FOR UPDATE SKIP LOCKED
    ) AS c
    WHERE o.id = c.id
    RETURNING o.id
    """
).bindparams(bindparam("kinds", expanding=True))

_CLAIM_SQL = text(
    """
    UPDATE workflow_run_outbox AS o
    SET status = 'claimed',
        claim_generation = o.claim_generation + 1,
        claim_id = gen_random_uuid(),
        claimed_by = :claimed_by,
        claimed_at = :now,
        claim_expires_at = :expires_at,
        last_heartbeat_at = :now,
        attempt_count = o.attempt_count + 1,
        updated_at = :now
    FROM (
        SELECT id FROM workflow_run_outbox
        WHERE {eligible} AND attempt_count < max_attempts
        ORDER BY next_attempt_at, created_at, id
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
    ) AS c
    WHERE o.id = c.id
    RETURNING o.id
    """.format(eligible=_ELIGIBLE)
).bindparams(bindparam("kinds", expanding=True))


async def _fetch_rows(db: AsyncSession, ids: list[UUID]) -> list[WorkflowRunOutbox]:
    if not ids:
        return []
    rows = (
        (
            await db.execute(
                select(WorkflowRunOutbox)
                .where(WorkflowRunOutbox.id.in_(ids))
                .order_by(
                    WorkflowRunOutbox.next_attempt_at.asc(),
                    WorkflowRunOutbox.created_at.asc(),
                    WorkflowRunOutbox.id.asc(),
                )
                .execution_options(**_POPULATE)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def claim_outbox_rows(
    db: AsyncSession,
    *,
    kinds: tuple[str, ...],
    claimed_by: str,
    now: datetime,
    lease_seconds: float,
    limit: int,
) -> tuple[OutboxRecord, ...]:
    """Atomically claim due rows for the given kinds under a fresh fence + lease.

    Handles fresh pending rows and expired-claim reclaim with the same statement:
    a reclaim bumps ``claim_generation`` and mints a new ``claim_id``, denying the
    prior claimant. Rows at the ``max_attempts`` ceiling are first terminalized to
    ``dead_letter`` (reclaim-shaped CAS + receipt) so a worker never receives an
    over-limit row and no further effect is dispatched (R7).
    """

    _bounded(claimed_by, limit=MAX_CLAIMED_BY_LEN, label="claimed_by")
    kind_list = list(kinds)
    if not kind_list:
        return ()

    exhausted_ids = [
        r
        for (r,) in (
            await db.execute(
                _TERMINALIZE_EXHAUSTED_SQL,
                {"kinds": kind_list, "claimed_by": claimed_by, "now": now},
            )
        ).all()
    ]
    for row in await _fetch_rows(db, exhausted_ids):
        await _append_receipt(
            db,
            outbox_id=row.id,
            claim_id=row.claim_id,
            claim_generation=row.claim_generation,
            result_kind=RESULT_DEAD_LETTER,
            failure_code=FAILURE_MAX_ATTEMPTS_EXHAUSTED,
            diagnostic_id=row.diagnostic_id,
            now=now,
        )

    expires_at = now + timedelta(seconds=lease_seconds)
    claimed_ids = [
        r
        for (r,) in (
            await db.execute(
                _CLAIM_SQL,
                {
                    "kinds": kind_list,
                    "claimed_by": claimed_by,
                    "now": now,
                    "expires_at": expires_at,
                    "limit": max(1, limit),
                },
            )
        ).all()
    ]
    return tuple(record_outbox(row) for row in await _fetch_rows(db, claimed_ids))


# --- heartbeat (fenced + unexpired-lease predicate; D5/R1) --------------------------


async def heartbeat_outbox(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    now: datetime,
    lease_seconds: float,
) -> OutboxWriteResult:
    """Extend the lease of the matching active generation only.

    Requires ``status='claimed'`` AND an unexpired lease on the exact fence: an
    expired claim's heartbeat is DENIED (R1) — expiry ends renewal authority.
    """

    row = (
        await db.execute(
            update(WorkflowRunOutbox)
            .where(
                WorkflowRunOutbox.id == outbox_id,
                WorkflowRunOutbox.claim_id == claim_id,
                WorkflowRunOutbox.claim_generation == claim_generation,
                WorkflowRunOutbox.status == STATUS_CLAIMED,
                WorkflowRunOutbox.claim_expires_at > now,
            )
            .values(
                last_heartbeat_at=now,
                claim_expires_at=now + timedelta(seconds=lease_seconds),
                updated_at=now,
            )
            .returning(WorkflowRunOutbox)
            .execution_options(**_POPULATE)
        )
    ).scalar_one_or_none()
    if row is not None:
        return OutboxWriteResult(outcome="applied", row=record_outbox(row), receipt=None)
    current = await db.get(WorkflowRunOutbox, outbox_id)
    return OutboxWriteResult(
        outcome="denied",
        row=record_outbox(current) if current is not None else None,
        receipt=None,
    )


# --- result CAS + durable receipt (D5/D8/R2/R8) -------------------------------------


async def _append_receipt(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    result_kind: str,
    now: datetime,
    failure_code: str | None = None,
    diagnostic_id: UUID | None = None,
    effect_key: str | None = None,
    continuation_outbox_id: UUID | None = None,
    next_attempt_at: datetime | None = None,
) -> WorkflowOutboxResult:
    receipt = WorkflowOutboxResult(
        id=uuid4(),
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        result_kind=result_kind,
        failure_code=failure_code,
        diagnostic_id=diagnostic_id,
        effect_key=effect_key,
        continuation_outbox_id=continuation_outbox_id,
        next_attempt_at=next_attempt_at,
        created_at=now,
    )
    db.add(receipt)
    await db.flush()
    return receipt


async def _find_receipt(
    db: AsyncSession, *, outbox_id: UUID, claim_id: UUID, claim_generation: int
) -> OutboxResultRecord | None:
    row = (
        await db.execute(
            select(WorkflowOutboxResult).where(
                WorkflowOutboxResult.outbox_id == outbox_id,
                WorkflowOutboxResult.claim_id == claim_id,
                WorkflowOutboxResult.claim_generation == claim_generation,
            )
        )
    ).scalar_one_or_none()
    return record_outbox_result(row) if row is not None else None


async def _result_cas(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    values: dict[str, object],
    result_kind: str,
    now: datetime,
    failure_code: str | None = None,
    diagnostic_id: UUID | None = None,
    effect_key: str | None = None,
    continuation_outbox_id: UUID | None = None,
    next_attempt_at: datetime | None = None,
) -> OutboxWriteResult:
    """Run one fenced state CAS and, on match, append the durable receipt.

    On a rowcount-0 miss, distinguish a durable replay (a receipt already exists
    for this exact fence -> R2/R8) from a stale claimant (no receipt -> zero side
    effects). Callers gate any continuation insert on ``outcome == 'applied'``.
    """

    row = (
        await db.execute(
            update(WorkflowRunOutbox)
            .where(
                WorkflowRunOutbox.id == outbox_id,
                WorkflowRunOutbox.claim_id == claim_id,
                WorkflowRunOutbox.claim_generation == claim_generation,
                WorkflowRunOutbox.status == STATUS_CLAIMED,
            )
            .values(updated_at=now, **values)
            .returning(WorkflowRunOutbox)
            .execution_options(**_POPULATE)
        )
    ).scalar_one_or_none()

    if row is not None:
        receipt = await _append_receipt(
            db,
            outbox_id=outbox_id,
            claim_id=claim_id,
            claim_generation=claim_generation,
            result_kind=result_kind,
            now=now,
            failure_code=failure_code,
            diagnostic_id=diagnostic_id,
            effect_key=effect_key,
            continuation_outbox_id=continuation_outbox_id,
            next_attempt_at=next_attempt_at,
        )
        return OutboxWriteResult(
            outcome="applied",
            row=record_outbox(row),
            receipt=record_outbox_result(receipt),
        )

    replay = await _find_receipt(
        db, outbox_id=outbox_id, claim_id=claim_id, claim_generation=claim_generation
    )
    current = await db.get(WorkflowRunOutbox, outbox_id)
    current_rec = record_outbox(current) if current is not None else None
    if replay is not None:
        return OutboxWriteResult(outcome="replayed", row=current_rec, receipt=replay)
    return OutboxWriteResult(outcome="stale_rejected", row=current_rec, receipt=None)


async def complete_outbox_success(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    now: datetime | None = None,
    effect_key: str | None = None,
) -> OutboxWriteResult:
    """Terminal success on the exact fence; retains claim identity (R2)."""

    return await _result_cas(
        db,
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        values={"status": STATUS_SUCCEEDED},
        result_kind=RESULT_SUCCEEDED,
        effect_key=effect_key,
        now=now or utcnow(),
    )


async def reschedule_outbox(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    next_attempt_at: datetime,
    failure_code: str,
    now: datetime | None = None,
) -> OutboxWriteResult:
    """Fail-with-retry: return the row to ``pending`` at a future ``next_attempt_at``.

    Keeps the fence (R2) so the next claim bumps the generation; records a
    ``rescheduled`` receipt for this generation.
    """

    _require_failure_code(failure_code)
    diagnostic_id = uuid4()
    return await _result_cas(
        db,
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        values={
            "status": STATUS_PENDING,
            "next_attempt_at": next_attempt_at,
            "last_failure_code": failure_code,
            "diagnostic_id": diagnostic_id,
        },
        result_kind=RESULT_RESCHEDULED,
        failure_code=failure_code,
        diagnostic_id=diagnostic_id,
        next_attempt_at=next_attempt_at,
        now=now or utcnow(),
    )


async def fail_outbox_terminal(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    failure_code: str,
    now: datetime | None = None,
) -> OutboxWriteResult:
    """Terminal (non-retryable) failure on the exact fence."""

    _require_failure_code(failure_code)
    diagnostic_id = uuid4()
    return await _result_cas(
        db,
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        values={
            "status": STATUS_FAILED,
            "last_failure_code": failure_code,
            "diagnostic_id": diagnostic_id,
        },
        result_kind=RESULT_FAILED_TERMINAL,
        failure_code=failure_code,
        diagnostic_id=diagnostic_id,
        now=now or utcnow(),
    )


async def dead_letter_outbox(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    failure_code: str,
    now: datetime | None = None,
) -> OutboxWriteResult:
    """Terminal dead-letter on the exact fence (needs-reconciliation, poison, ...)."""

    _require_failure_code(failure_code)
    stamp = now or utcnow()
    diagnostic_id = uuid4()
    return await _result_cas(
        db,
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        values={
            "status": STATUS_DEAD_LETTER,
            "last_failure_code": failure_code,
            "diagnostic_id": diagnostic_id,
            "dead_lettered_at": stamp,
        },
        result_kind=RESULT_DEAD_LETTER,
        failure_code=failure_code,
        diagnostic_id=diagnostic_id,
        now=stamp,
    )


async def complete_outbox_with_continuation(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    claim_id: UUID,
    claim_generation: int,
    continuation: dict[str, object],
    now: datetime | None = None,
    effect_key: str | None = None,
) -> OutboxWriteResult:
    """Complete the parent and enqueue a follow-on row IN THE SAME transaction,
    gated on the parent CAS matching (D8).

    A stale claimant's CAS matches zero rows, so no continuation row is inserted.
    The parent's ``continued`` receipt records the child's id for durable replay.
    """

    stamp = now or utcnow()
    row = (
        await db.execute(
            update(WorkflowRunOutbox)
            .where(
                WorkflowRunOutbox.id == outbox_id,
                WorkflowRunOutbox.claim_id == claim_id,
                WorkflowRunOutbox.claim_generation == claim_generation,
                WorkflowRunOutbox.status == STATUS_CLAIMED,
            )
            .values(status=STATUS_SUCCEEDED, updated_at=stamp)
            .returning(WorkflowRunOutbox)
            .execution_options(**_POPULATE)
        )
    ).scalar_one_or_none()

    if row is None:
        replay = await _find_receipt(
            db, outbox_id=outbox_id, claim_id=claim_id, claim_generation=claim_generation
        )
        current = await db.get(WorkflowRunOutbox, outbox_id)
        current_rec = record_outbox(current) if current is not None else None
        if replay is not None:
            return OutboxWriteResult(outcome="replayed", row=current_rec, receipt=replay)
        return OutboxWriteResult(outcome="stale_rejected", row=current_rec, receipt=None)

    child = await enqueue_outbox(db, **continuation)  # type: ignore[arg-type]
    receipt = await _append_receipt(
        db,
        outbox_id=outbox_id,
        claim_id=claim_id,
        claim_generation=claim_generation,
        result_kind=RESULT_CONTINUED,
        now=stamp,
        effect_key=effect_key,
        continuation_outbox_id=child.id,
    )
    return OutboxWriteResult(
        outcome="applied", row=record_outbox(row), receipt=record_outbox_result(receipt)
    )


def _require_failure_code(failure_code: str) -> None:
    if failure_code not in OUTBOX_FAILURE_CODES:
        raise ValueError(f"unknown failure_code {failure_code!r}")


# --- reads --------------------------------------------------------------------------


async def get_outbox_row(db: AsyncSession, outbox_id: UUID) -> OutboxRecord | None:
    row = await db.get(WorkflowRunOutbox, outbox_id)
    return None if row is None else record_outbox(row)


async def get_outbox_result(
    db: AsyncSession, *, outbox_id: UUID, claim_generation: int
) -> OutboxResultRecord | None:
    row = (
        await db.execute(
            select(WorkflowOutboxResult).where(
                WorkflowOutboxResult.outbox_id == outbox_id,
                WorkflowOutboxResult.claim_generation == claim_generation,
            )
        )
    ).scalar_one_or_none()
    return record_outbox_result(row) if row is not None else None
