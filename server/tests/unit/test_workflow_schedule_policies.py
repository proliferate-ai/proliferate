"""Workflow scheduler-tick / missed-run / concurrency / catch-up tests (spec 3.5).

These tests use the committing ``session_factory`` (the scheduler tick opens its
own sessions — it is a worker, not a request) and rely on the autouse table
truncation for isolation. Cloud delivery is mocked exactly as the delivery suite
does — patch the gateway access + swap the runtime client for an
``httpx.MockTransport``. Shared builders/patch helpers live in
``workflow_trigger_helpers.py``.
"""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
    WORKFLOW_RUN_ERROR_BUDGET_BLOCKED,
    WORKFLOW_RUN_STATUS_FAILED,
    WORKFLOW_RUN_STATUS_MISSED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.models.cloud.workflows import Workflow
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.workflows import scheduler
from proliferate.server.cloud.workflows.worker import schedules as worker_schedules
from proliferate.utils.time import utcnow
from tests.unit.workflow_trigger_helpers import (
    _force_budget,
    _make_due,
    _owner,
    _patch_client,
    _patch_gateway,
    _patch_recording_gateway,
    _push_cursor_back,
    _runs_for_trigger,
    _seed_running_prior,
    _seed_trigger,
    _trigger_runs,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


# --- scheduler tick --------------------------------------------------------------


async def test_tick_fires_due_trigger_and_delivers(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 1
    assert len(seen) == 1  # exactly one sandbox wake + deliver
    # The trigger advanced its cursor to a fresh future slot and cleared skip.
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.next_run_at is not None and trigger.next_run_at > utcnow()
    assert trigger.last_scheduled_at is not None
    assert trigger.last_skip_reason is None


async def test_tick_skip_policy_records_skip(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    # A prior run of this trigger is still running (non-terminal).
    async with session_factory() as db, db.begin():
        workflow = await store.get_workflow(db, workflow_id)
        assert workflow is not None and workflow.current_version_id is not None
        prior = await store.create_run(
            db,
            workflow_id=workflow_id,
            workflow_version_id=workflow.current_version_id,
            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
            executor_user_id=workflow.owner_user_id,
            args_json={},
            target_mode="personal_cloud",
            resolved_plan_json={"steps": []},
            anyharness_workspace_id="sandbox-ws-1",
            trigger_id=trigger_id,
            scheduled_for=utcnow() - timedelta(hours=2),
        )
        await store.update_run(db, run_id=prior.id, status=WORKFLOW_RUN_STATUS_RUNNING)
    await _make_due(session_factory, trigger_id)
    async with session_factory() as db:
        before = await trigger_store.get_trigger(db, trigger_id)
    assert before is not None
    cursor_before = before.next_run_at
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 0  # the slot was skipped
    assert len(seen) == 0  # nothing delivered (the running prior isn't pending)
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.last_skipped_at is not None
    assert trigger.last_skip_reason  # concurrency reason recorded
    # BLOCKER fix: a concurrency skip HOLDS the cursor stationary (does not advance
    # past the enumerated window), so the slot is re-enumerated next tick once the
    # prior run terminates rather than silently vanishing.
    assert trigger.next_run_at == cursor_before
    assert trigger.next_run_at is not None and trigger.next_run_at <= utcnow()


async def test_tick_disables_trigger_when_workflow_archived(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A due schedule trigger whose workflow was archived is disabled cleanly.

    Regression: disabling must NOT null out next_run_at — the
    ck_workflow_trigger_schedule_fields CHECK requires a schedule trigger to always
    carry a cursor, so nulling it raised an IntegrityError that aborted the whole
    beat. Disabling via enabled=False alone stops scheduling.
    """
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    async with session_factory() as db, db.begin():
        await store.archive_workflow(db, workflow_id)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    # Must not raise (previously an IntegrityError from a NULL next_run_at).
    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 0
    assert result.delivered_runs == 0
    assert len(seen) == 0
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, trigger_id)
    assert trigger is not None
    assert trigger.enabled is False  # disabled -> no longer scheduled
    assert trigger.next_run_at is not None  # cursor preserved (CHECK invariant)
    assert trigger.last_skip_reason == "Workflow was archived."
    # A disabled trigger is no longer selected as due, so a second tick is a no-op.
    again = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert again.created_runs == 0 and again.delivered_runs == 0


async def test_tick_queue_policy_defers_then_delivers(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="queue")
    # A prior run of this trigger is still running — queue must create the new run
    # but hold its delivery.
    async with session_factory() as db, db.begin():
        workflow = await store.get_workflow(db, workflow_id)
        assert workflow is not None and workflow.current_version_id is not None
        prior = await store.create_run(
            db,
            workflow_id=workflow_id,
            workflow_version_id=workflow.current_version_id,
            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
            executor_user_id=workflow.owner_user_id,
            args_json={},
            target_mode="personal_cloud",
            resolved_plan_json={"steps": []},
            anyharness_workspace_id="sandbox-ws-1",
            trigger_id=trigger_id,
            scheduled_for=utcnow() - timedelta(hours=2),
        )
        await store.update_run(db, run_id=prior.id, status=WORKFLOW_RUN_STATUS_RUNNING)
        prior_id = prior.id
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    # Tick 1: queue creates the run but defers delivery behind the running prior.
    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 1
    assert first.delivered_runs == 0
    assert len(seen) == 0
    queued = await _runs_for_trigger(session_factory, trigger_id)
    assert len(queued) == 1
    assert queued[0].status == WORKFLOW_RUN_STATUS_PENDING_DELIVERY

    # The prior run finishes -> the queued run becomes deliverable.
    async with session_factory() as db, db.begin():
        await store.update_run(db, run_id=prior_id, status="completed", finished_at=utcnow())

    # Tick 2: no new slot is due, but the deferred run now delivers.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    assert second.delivered_runs == 1
    assert len(seen) == 1
    remaining = await _runs_for_trigger(session_factory, trigger_id)
    assert remaining == []  # delivered, no longer pending


# --- 1c: budget_blocked deny path (D-002) + missed-run catch-up policy ----------


async def test_tick_over_budget_lands_budget_blocked_zero_dispatch(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(a) Over-budget org + due schedule -> exactly one terminal budget_blocked
    run and ZERO sandbox launch / agent dispatch (asserted at the wake + deliver
    boundaries, not on prose)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    _force_budget(monkeypatch, blocked=True)

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1  # phase-1 still records the run row
    assert result.delivered_runs == 0  # phase-2 refused to deliver
    assert wakes == []  # DISPATCH BOUNDARY: no sandbox was ever woken
    assert seen == []  # no agent dispatch (no gateway deliver POST)

    runs = await _runs_for_trigger(session_factory, trigger_id)
    # No longer pending (it went terminal), so re-read the full ledger.
    async with session_factory() as db:
        all_runs = await store.list_runs(
            db, executor_user_id=(await _owner(session_factory, workflow_id))
        )
    blocked = [r for r in all_runs if r.trigger_id == trigger_id]
    assert len(blocked) == 1
    assert blocked[0].status == WORKFLOW_RUN_STATUS_FAILED
    assert blocked[0].error_code == WORKFLOW_RUN_ERROR_BUDGET_BLOCKED
    assert blocked[0].finished_at is not None
    assert runs == []  # not sitting pending anymore


async def test_tick_budget_restored_delivers_normally(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) With enforce on but the org NOT over budget, the next tick runs
    normally: the sandbox is woken and the plan delivered."""
    trigger_id, _workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    _force_budget(monkeypatch, blocked=False)

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 1
    assert len(wakes) == 1  # sandbox woken
    assert len(seen) == 1  # plan delivered


async def test_missed_run_latest_fires_newest_records_older_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(c) run_latest (default): a schedule whose cursor is hours in the past fires
    ONLY the newest missed occurrence; every OLDER slot is recorded as a terminal
    ``missed`` history row (no silent gaps). The next tick does not double-fire."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="skip",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=5.5)  # ~5 hourly slots
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 1  # exactly the newest slot fires

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    fired = [r for r in runs if r.status != WORKFLOW_RUN_STATUS_MISSED]
    missed = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(fired) == 1  # one real run
    assert len(missed) >= 4  # every older slot recorded (5.5h window ⇒ ≥4 older)
    # The one fired run is the NEWEST slot; missed rows are strictly older.
    newest = max(r.scheduled_for for r in runs)
    assert fired[0].scheduled_for == newest
    assert all(r.scheduled_for < newest for r in missed)
    # Slots are unique (deduped by the (trigger_id, scheduled_for) index).
    assert len({r.scheduled_for for r in runs}) == len(runs)

    # The cursor advanced to a future slot: the immediate next tick does not re-fire.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    runs_after = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs_after) == len(runs)  # no double-fire, no new rows


async def test_missed_skip_all_fires_nothing_records_every_slot_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(d) skip_all: NO run fires; ALL missed slots are recorded as ``missed`` rows
    with zero sandbox launch / delivery."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory, concurrency="skip", missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL
    )
    await _push_cursor_back(session_factory, trigger_id, hours=5.5)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 0  # nothing fired
    assert result.delivered_runs == 0
    assert wakes == []  # DISPATCH BOUNDARY: no sandbox woken
    assert seen == []  # no agent dispatch

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) >= 5  # every occurrence in the 5.5h window recorded
    assert all(r.status == WORKFLOW_RUN_STATUS_MISSED for r in runs)
    assert all(r.status in WORKFLOW_RUN_TERMINAL_STATUSES for r in runs)

    # Re-tick: cursor advanced, no new rows.
    again = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert again.created_runs == 0
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == len(runs)


async def test_missed_replay_all_fires_every_slot_and_dedupes_on_retick(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(e) replay_all: EVERY missed slot fires (in order); a re-tick over the same
    window creates NOTHING — the (trigger_id, scheduled_for) unique index dedupes.

    Uses concurrency=queue so the re-tick is not short-circuited by the skip guard
    and actually exercises the index dedupe in the fire loop."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="queue",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)  # ~3 hourly slots
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    n_slots = len(runs)
    assert n_slots >= 3  # a full backfill, not a single fire
    assert first.created_runs == n_slots  # every slot fired
    assert all(r.status != WORKFLOW_RUN_STATUS_MISSED for r in runs)  # all real runs
    assert len({r.scheduled_for for r in runs}) == n_slots  # distinct slots

    # Force the cursor back over the SAME window and re-tick: the unique index
    # dedupes every already-fired slot, so no new run is created.
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0  # dedupe held — no double-fire
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == n_slots


# --- 1c hardening: adversarial-review defect fixes ------------------------------


async def test_concurrency_skip_holds_backlog_then_replays_on_next_tick(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(BLOCKER) concurrency=skip with a prior run still active fires nothing AND
    does NOT advance the cursor past the missed window. Once the prior run
    terminates, the next tick routes the full held window through the run_latest
    partition (newest fires + older recorded missed) — no slot silently vanishes."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="skip",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    )
    prior_id = await _seed_running_prior(
        session_factory, workflow_id=workflow_id, trigger_id=trigger_id
    )
    # ~3+ hourly slots came due while the prior run was still active.
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    async with session_factory() as db:
        before = await trigger_store.get_trigger(db, trigger_id)
    assert before is not None
    cursor_before = before.next_run_at
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    owner = await _owner(session_factory, workflow_id)

    # Tick 1: skip guard trips — nothing fires, cursor held stationary (backlog kept).
    first = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert first.created_runs == 0
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert [r.id for r in runs] == [prior_id]  # only the prior run — zero missed rows
    async with session_factory() as db:
        held = await trigger_store.get_trigger(db, trigger_id)
    assert held is not None
    assert held.next_run_at == cursor_before  # cursor NOT advanced past the window
    assert held.next_run_at <= utcnow()  # still due -> re-enumerated next tick
    assert held.last_skip_reason  # concurrency skip recorded

    # The prior run terminates -> the held backlog is no longer blocked.
    async with session_factory() as db, db.begin():
        await store.update_run(db, run_id=prior_id, status="completed", finished_at=utcnow())

    # Tick 2: run_latest partition applies to the FULL held window.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 1  # the newest slot fires
    runs2 = await _trigger_runs(session_factory, owner, trigger_id)
    missed = [r for r in runs2 if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(missed) >= 2  # every older slot in the held window recorded, none dropped
    async with session_factory() as db:
        advanced = await trigger_store.get_trigger(db, trigger_id)
    assert advanced is not None
    assert advanced.next_run_at > utcnow()  # cursor advanced only past a handled window


async def test_catch_up_truncation_defers_remainder_no_silent_drop(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MAJOR) replay_all with more due slots than the per-tick cap fires at most
    `cap` this tick and PARKS the cursor on the oldest un-fired slot; the remainder
    replays on later ticks. Across ticks, fired+missed rows == total slots — zero
    silently dropped. Uses a small monkeypatched cap (3), not the real 500."""
    monkeypatch.setattr(worker_schedules, "WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS", 3)
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="queue",  # skip guard would otherwise short-circuit re-ticks
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=6.5)  # ~6 slots > cap 3
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))
    owner = await _owner(session_factory, workflow_id)

    total_created = 0
    drained = False
    for _ in range(10):  # drive ticks until the backlog drains
        result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
        assert result.created_runs <= 3  # never more than the cap in one tick
        total_created += result.created_runs
        async with session_factory() as db:
            trig = await trigger_store.get_trigger(db, trigger_id)
        assert trig is not None
        if trig.next_run_at > utcnow():  # cursor moved into the future -> drained
            drained = True
            break
    assert drained

    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert all(r.status != WORKFLOW_RUN_STATUS_MISSED for r in runs)  # replay = all real
    assert len({r.scheduled_for for r in runs}) == len(runs)  # distinct slots, no dupes
    assert len(runs) == total_created  # every created run persisted
    assert len(runs) >= 6  # the full backlog fired across ticks, none dropped
    # It took more than one tick (proves the cap deferred + the cursor was parked).
    assert total_created > 3


async def test_missed_recording_skipped_when_no_current_version_surfaces_reason(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MAJOR) missed slots but no current workflow version (no run FK) can't be
    recorded — surface a warning via last_skip_reason instead of a silent gap.
    skip_all isolates the missed path (nothing fires)."""
    trigger_id, workflow_id = await _seed_trigger(
        session_factory,
        concurrency="skip",
        missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)
    # Null the workflow's current version so create_missed_run has no FK to hang on.
    async with session_factory() as db, db.begin():
        wf = await db.get(Workflow, workflow_id)
        assert wf is not None
        wf.current_version_id = None
    owner = await _owner(session_factory, workflow_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 0  # no crash, nothing fired
    assert wakes == [] and seen == []  # no dispatch
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs == []  # no missed rows recorded (no version) ...
    async with session_factory() as db:
        trig = await trigger_store.get_trigger(db, trigger_id)
    assert trig is not None
    # ... but the gap is NOT silent — it is surfaced, mirroring the fire path.
    assert trig.last_skip_reason is not None
    assert "workflow_no_version" in trig.last_skip_reason


async def test_non_dedup_integrity_error_propagates(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(MINOR) only the (trigger_id, scheduled_for) dedup conflict is swallowed as
    'already recorded'; any OTHER IntegrityError propagates (never masked)."""

    # The classifier: dedup index -> swallow; anything else -> re-raise.
    class _OtherOrig(Exception):
        constraint_name = "workflow_run_some_other_fk"

    class _DedupOrig(Exception):
        constraint_name = "uq_workflow_run_trigger_slot"

    assert (
        worker_schedules._is_slot_dedup_conflict(IntegrityError("x", {}, _DedupOrig("dup")))
        is True
    )
    assert (
        worker_schedules._is_slot_dedup_conflict(IntegrityError("x", {}, _OtherOrig("no")))
        is False
    )
    # String fallback (no constraint_name attribute exposed) still recognises the index.
    assert (
        worker_schedules._is_slot_dedup_conflict(
            IntegrityError(
                'duplicate key ... unique constraint "uq_workflow_run_trigger_slot"',
                {},
                Exception(),
            )
        )
        is True
    )

    # End-to-end: a non-dedup IntegrityError from the fire path is NOT swallowed.
    trigger_id, _workflow_id = await _seed_trigger(session_factory, concurrency="queue")
    await _make_due(session_factory, trigger_id)

    async def _boom(*_a: object, **_k: object) -> None:
        raise IntegrityError("INSERT INTO workflow_run ...", {}, _OtherOrig("nope"))

    monkeypatch.setattr(worker_schedules.compiler, "start_run", _boom)

    async with session_factory() as db, db.begin():
        with pytest.raises(IntegrityError):
            await worker_schedules.fire_one_trigger(db, trigger_id=trigger_id, now=utcnow())
