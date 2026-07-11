"""WS4a schedule-plane background tests — T1-WF-BG-01 schedule half (spec §10.2).

Exercises the Celery/Beat + transactional-outbox path DIRECTLY through its
commit-free services (``worker/schedules.py``), independent of the
``workflows_beat_schedules`` flag: the flag only decides *who* opens the
transaction (Beat vs the legacy loop), not what the service does.

Proves the WS4 acceptance rows for the schedule half:
  - a duplicate tick over one slot creates one occurrence and one outbox row
  - a crash after intent commit loses no delivery (the relay picks it up)
  - relay retry cannot double-deliver (idempotent per WS2b run identity)
  - a transient ``start_run`` failure leaves the cursor stationary and writes no
    outbox row for that occurrence
  - the DST matrix: a nonexistent spring-forward wall time is skipped; an
    ambiguous fall-back wall time fires once at the earlier offset
  - missed occurrences are enumerated oldest-first per the missed-run policy
  - a local-ready run is claimable with no outbox row

Real-Postgres tests (WS2a pattern): setup commits through a committing
``session_factory``; the autouse truncation isolates each test.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_MISSED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
)
from proliferate.db.models.cloud.workflow_ledger import WorkflowRunOutbox
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store.workflow_ledger import (
    claim_due_outbox_rows,
    complete_outbox_row,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.schedule import (
    due_schedule_occurrences,
    partition_missed_run_window,
)
from proliferate.server.cloud.workflows.worker import schedules as worker_schedules
from proliferate.utils.time import utcnow
from tests.unit.workflow_trigger_helpers import (
    _make_due,
    _owner,
    _push_cursor_back,
    _patch_client,
    _patch_gateway,
    _seed_local_trigger,
    _seed_trigger,
    _trigger_runs,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


# --- helpers: drive the new commit-free services in the task's transaction shape


async def _fire_once(session_factory, *, now: datetime | None = None) -> int:
    """Run the schedule-fire task's transaction: one short transaction that calls
    the commit-free ``fire_due_schedule_triggers`` and commits."""

    when = now or utcnow()
    async with session_factory() as db, db.begin():
        result = await worker_schedules.fire_due_schedule_triggers(db, now=when, batch_size=100)
    return result.created_runs


async def _relay_once(session_factory) -> tuple[int, int]:
    """Run the outbox-relay task's shape: claim due rows in one transaction, then
    deliver each in its own fresh transaction (no lock held over the wake)."""

    now = utcnow()
    async with session_factory() as db, db.begin():
        claimed = await claim_due_outbox_rows(db, now=now, limit=50)
    delivered = 0
    for row in claimed:
        async with session_factory() as db, db.begin():
            outcome = await worker_schedules.deliver_cloud_delivery_outbox_row(db, row=row)
            if outcome.status == "delivered":
                await complete_outbox_row(db, outbox_id=row.id, status="delivered")
                delivered += 1
            elif outcome.status == "failed":
                await complete_outbox_row(
                    db, outbox_id=row.id, status="failed", last_error=outcome.detail
                )
            else:  # deferred / retry -> back to pending with backoff
                await complete_outbox_row(
                    db,
                    outbox_id=row.id,
                    status="pending",
                    last_error=outcome.detail,
                    next_attempt_at=worker_schedules.relay_backoff(utcnow(), delay_seconds=30.0),
                )
    return len(claimed), delivered


async def _outbox_rows(session_factory, *, trigger_id: uuid.UUID) -> list[WorkflowRunOutbox]:
    async with session_factory() as db:
        rows = (
            (
                await db.execute(
                    select(WorkflowRunOutbox).where(WorkflowRunOutbox.trigger_id == trigger_id)
                )
            )
            .scalars()
            .all()
        )
    return list(rows)


# --- fire + outbox atomicity ---------------------------------------------------


async def test_fire_cloud_slot_creates_one_run_and_one_cloud_delivery_outbox_row(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cloud schedule fire commits the run intent and exactly one
    ``cloud_delivery`` outbox row in the same transaction (§10.2)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    created = await _fire_once(session_factory)
    assert created == 1

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].status == WORKFLOW_RUN_STATUS_PENDING_DELIVERY

    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert len(rows) == 1
    assert rows[0].kind == WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY
    assert rows[0].run_id == runs[0].id
    assert rows[0].status == "pending"  # committed but not yet relayed


async def test_duplicate_tick_creates_one_occurrence_and_one_outbox_row(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Re-firing the SAME due slot (cursor pushed back over it) creates no second
    run and no second outbox row — the (trigger_id, scheduled_for) dedup index
    rolls back the savepoint that also holds the outbox insert."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="queue")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    assert await _fire_once(session_factory) == 1
    # Force the cursor back onto the same slot and re-fire: the dedup index holds.
    async with session_factory() as db:
        trig = await trigger_store.get_trigger(db, trigger_id)
    assert trig is not None
    fired_slot = trig.last_scheduled_at
    assert fired_slot is not None
    async with session_factory() as db, db.begin():
        await trigger_store.update_trigger(db, trigger_id=trigger_id, next_run_at=fired_slot)

    assert await _fire_once(session_factory) == 0  # dedup: no second occurrence

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1  # exactly one occurrence
    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert len(rows) == 1  # exactly one outbox job


# --- crash recovery + idempotent relay -----------------------------------------


async def test_crash_after_intent_commit_relay_delivers_no_loss(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate a crash after the fire transaction commits (run intent + outbox row
    durable) but before any relay ran: a later relay claims the pending row and
    delivers, so nothing is lost."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    assert await _fire_once(session_factory) == 1  # commit; "crash" before relay
    # The delivery has not happened yet — the run is still pending, no wake fired.
    assert seen == []
    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs[0].status == WORKFLOW_RUN_STATUS_PENDING_DELIVERY

    claimed, delivered = await _relay_once(session_factory)
    assert claimed == 1 and delivered == 1
    assert len(seen) == 1  # exactly one sandbox wake + deliver
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs[0].status == WORKFLOW_RUN_STATUS_DELIVERED
    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert rows[0].status == "delivered"


async def test_relay_retry_cannot_double_deliver(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Delivering the SAME cloud-delivery row twice wakes the sandbox exactly once.
    The first pass transitions the run pending_delivery -> delivered; the second
    finds it no longer ``pending_delivery`` so ``deliver_cloud_run`` is a no-op and
    the row still resolves ``delivered`` (idempotent per WS2b run identity)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    await _fire_once(session_factory)
    row = (await _outbox_rows(session_factory, trigger_id=trigger_id))[0]

    # First delivery: one sandbox wake, run delivered.
    async with session_factory() as db, db.begin():
        first = await worker_schedules.deliver_cloud_delivery_outbox_row(db, row=row)
    assert first.status == "delivered"
    assert len(seen) == 1

    # Retry the identical row: the run is already delivered, so no second wake.
    async with session_factory() as db, db.begin():
        second = await worker_schedules.deliver_cloud_delivery_outbox_row(db, row=row)
    assert second.status == "delivered"
    assert len(seen) == 1  # NO second sandbox wake — idempotent redelivery

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].status == WORKFLOW_RUN_STATUS_DELIVERED


# --- transient fire failure: cursor stationary, no outbox ----------------------


async def test_transient_start_run_failure_leaves_cursor_stationary_no_outbox(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A transient ``start_run`` failure creates no run and no outbox row, and the
    schedule cursor stays on that occurrence so the next tick retries it."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    async with session_factory() as db:
        before = await trigger_store.get_trigger(db, trigger_id)
    assert before is not None
    cursor_before = before.next_run_at

    async def _boom(*_a: object, **_k: object) -> None:
        raise CloudApiError("target_workspace_not_ready", "transient", status_code=409)

    monkeypatch.setattr(worker_schedules.compiler, "start_run", _boom)

    assert await _fire_once(session_factory) == 0

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs == []  # no run created
    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert rows == []  # no outbox row for the un-durable occurrence
    async with session_factory() as db:
        after = await trigger_store.get_trigger(db, trigger_id)
    assert after is not None
    assert after.next_run_at == cursor_before  # STATIONARY on the failed occurrence
    assert after.next_run_at is not None and after.next_run_at <= utcnow()  # still due


# --- local-ready run needs no outbox -------------------------------------------


async def test_local_ready_run_is_claimable_with_no_outbox(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A local target fire creates a claimable run and writes NO outbox row — a
    local-ready run is visible over its HTTP claim API without a relay (§10.2)."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)

    assert await _fire_once(session_factory) == 1

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert rows == []  # no cloud-delivery outbox for a local run


# --- missed-run policy oldest-first --------------------------------------------


async def test_missed_replay_all_fires_every_slot_oldest_first(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """replay_all fires every missed slot; the fire order is oldest-first and each
    fired cloud run gets exactly one cloud-delivery outbox row (§10.2)."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="queue",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)  # ~3 hourly slots
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    created = await _fire_once(session_factory)
    assert created >= 3

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    fired = sorted(
        (r for r in runs if r.status != WORKFLOW_RUN_STATUS_MISSED), key=lambda r: r.scheduled_for
    )
    assert len(fired) == created
    # Distinct, strictly ascending slots — enumerated oldest-first.
    slots = [r.scheduled_for for r in fired]
    assert slots == sorted(slots)
    assert len(set(slots)) == len(slots)
    # One cloud-delivery outbox row per fired cloud run.
    rows = await _outbox_rows(session_factory, trigger_id=trigger_id)
    assert len(rows) == created
    assert all(r.kind == WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY for r in rows)


# --- DST matrix (deterministic; the pure enumeration the fire path calls) -------


def _utc(y: int, m: int, d: int, h: int = 0, mi: int = 0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=UTC)


async def test_dst_spring_forward_nonexistent_wall_time_is_skipped() -> None:
    """Spring forward (US/Eastern 2024-03-10, 02:00->03:00): a daily 02:30 schedule
    skips the nonexistent 2024-03-10 slot entirely and fires the neighbours."""
    occurrences, _next = due_schedule_occurrences(
        rrule_text="RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=30",
        timezone="America/New_York",
        since=_utc(2024, 3, 9),
        now=_utc(2024, 3, 12),
    )
    local_days = {o.astimezone(ZoneInfo("America/New_York")).date() for o in occurrences}
    assert datetime(2024, 3, 10).date() not in local_days  # imaginary slot skipped
    assert datetime(2024, 3, 9).date() in local_days
    assert datetime(2024, 3, 11).date() in local_days


async def test_dst_fall_back_ambiguous_wall_time_fires_once_at_earlier_offset() -> None:
    """Fall back (US/Eastern 2024-11-03, 02:00->01:00): a daily 01:30 schedule fires
    the ambiguous 2024-11-03 slot exactly once, at the earlier (-04:00) offset."""
    occurrences, _next = due_schedule_occurrences(
        rrule_text="RRULE:FREQ=DAILY;BYHOUR=1;BYMINUTE=30",
        timezone="America/New_York",
        since=_utc(2024, 11, 3, 0, 0),
        now=_utc(2024, 11, 3, 23, 0),
    )
    # Exactly one occurrence for the fall-back day, and it is the earlier instant
    # (01:30-04:00 == 05:30Z), not the later 01:30-05:00 (== 06:30Z).
    assert len(occurrences) == 1
    assert occurrences[0] == _utc(2024, 11, 3, 5, 30)


async def test_missed_run_partition_is_oldest_first() -> None:
    """run_latest fires the newest and records every older slot missed, oldest
    first; replay_all fires all in ascending order (§10.2)."""
    window = [_utc(2024, 1, 1, h) for h in range(4)]
    run_latest = partition_missed_run_window(
        occurrences=window, missed_run_policy="run_latest", next_run_at=_utc(2024, 1, 1, 5)
    )
    assert run_latest.fire_slots == [window[-1]]
    assert run_latest.missed_slots == window[:-1]  # oldest-first, ascending
    replay = partition_missed_run_window(
        occurrences=window,
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
        next_run_at=_utc(2024, 1, 1, 5),
    )
    assert replay.fire_slots == window  # ascending, oldest-first
    assert replay.missed_slots == []
