"""WS4b poll-plane background tests — T1-WF-BG-01 poll half (spec §10.3).

Exercises the Celery/Beat + durable inbox + cursor-CAS path DIRECTLY through
its commit-free service (``worker/polls.py``), independent of the
``workflows_beat_polls`` flag: the flag only decides *who* opens the
transaction (Beat vs the legacy ``poller.py`` loop), not what the service does.

Proves the WS4 acceptance rows for the poll half:
  - a replayed page item creates no second run (dedupe)
  - a transient item/run failure leaves the cursor stationary and retries,
    dead-lettering at the 5th attempt
  - a schema-invalid item is dead-lettered immediately (not retried)
  - a ``has_more`` page's cursor CAS and next-page outbox row commit
    atomically — a crash between the two loses nothing (both roll back
    together)
  - the page budget (100) is enforced and does not enqueue a next page
  - a repeated/null ``has_more`` cursor is a permanent contract error
  - THE no-lock-over-HTTP proof: a blocked fetch does not block a concurrent
    trigger update from a second connection
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE,
    WORKFLOW_POLL_CONTRACT_ERROR_REPEATED_CURSOR,
    WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER,
    WORKFLOW_POLL_MAX_ATTEMPTS,
    WORKFLOW_POLL_PAGE_BUDGET,
    WORKFLOW_POLL_PAGE_BUDGET_EXHAUSTED,
    WORKFLOW_TRIGGER_KIND_POLL,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workflow_ledger import WorkflowRunOutbox
from proliferate.db.models.cloud.workflows import (
    Workflow,
    WorkflowRun,
    WorkflowTrigger,
    WorkflowVersion,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import workflow_ledger as ledger
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import poller as poller_module
from proliferate.server.cloud.workflows.domain.poll_contract import PollItem, PollPage
from proliferate.server.cloud.workflows.worker import polls as worker_polls
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio

_DEF = {
    "version": 1,
    "inputs": [
        {"name": "n", "type": "number", "required": True},
        {"name": "title", "type": "text", "required": True},
    ],
    "agents": [
        {
            "slot": "main",
            "harness": "claude",
            "model": "sonnet",
            "steps": [{"kind": "agent.prompt", "prompt": "item {{inputs.title}}"}],
        }
    ],
}
_ITEM_SCHEMA = {
    "type": "object",
    "properties": {"n": {"type": "number"}, "title": {"type": "string"}},
    "required": ["n", "title"],
}


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _allow_seeded_loopback_poll_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep these persistence tests at the mocked HTTP seam.

    The production SSRF guard and its loopback denial are covered in
    ``test_workflow_poll.py``. This module intentionally seeds a loopback URL
    while replacing the HTTP fetch so it can exercise cursor/transaction
    behavior without making a network request.
    """

    monkeypatch.setattr(worker_polls, "guard_poll_endpoint", lambda _url: None)


# --- seeding ---------------------------------------------------------------------


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-poll-bg-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_workflow(db: AsyncSession, user: User) -> Workflow:
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="poll-bg-wf",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(wf)
    await db.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json=_DEF,
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db.add(ver)
    await db.flush()
    wf.current_version_id = ver.id
    await db.flush()
    return wf


async def _seed_poll_trigger(session_factory, **overrides: object) -> tuple[uuid.UUID, uuid.UUID]:  # type: ignore[no-untyped-def]
    """Create user/workflow/poll-trigger (committed). Returns (trigger_id, workflow_id).

    ``target_mode="local"`` keeps ``start_run`` from resolving a real cloud
    workspace — the poll-apply logic under test is target-agnostic (mirrors
    ``tests/unit/test_workflow_poll.py``'s ``_make_poll_trigger``).
    """

    async with session_factory() as db, db.begin():
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = WorkflowTrigger(
            id=uuid.uuid4(),
            workflow_id=wf.id,
            kind=WORKFLOW_TRIGGER_KIND_POLL,
            enabled=True,
            concurrency_policy="queue",
            target_mode="local",
            repo_full_name="acme/widgets",
            target_workspace_id=None,
            poll_url="http://127.0.0.1:9911/poll",
            poll_interval_secs=overrides.get("interval_secs", 60),
            poll_item_schema_json=overrides.get("item_schema", _ITEM_SCHEMA),
            poll_cursor=overrides.get("cursor"),
            poll_cursor_generation=overrides.get("generation"),
            last_poll_at=overrides.get("last_poll_at"),
            args_json={},
            created_by_user_id=user.id,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(trigger)
        await db.flush()
    return trigger.id, wf.id


async def _force_due(session_factory, trigger_id: uuid.UUID) -> None:  # type: ignore[no-untyped-def]
    """Push ``last_poll_at`` into the past so the trigger is due again."""

    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowTrigger, trigger_id)
        assert row is not None
        row.last_poll_at = utcnow() - timedelta(hours=1)


def _page(items: list[dict], *, cursor: str | None = "c1", has_more: bool = False) -> PollPage:
    return PollPage(
        items=[PollItem.model_validate(i) for i in items], cursor=cursor, has_more=has_more
    )


def _item(item_id: str, **data: object) -> dict:
    return {"id": item_id, "kind": "test.item", "data": data}


async def _trigger_row(session_factory, trigger_id: uuid.UUID) -> WorkflowTrigger | None:  # type: ignore[no-untyped-def]
    """The raw ORM row: ``WorkflowTriggerRecord`` (``trigger_store.get_trigger``)
    intentionally omits ``poll_cursor``/``poll_cursor_generation`` (CRUD reads
    never need the CAS internals), so assertions on the cursor read the ORM row
    directly, same as ``tests/unit/test_workflow_poll.py``."""

    async with session_factory() as db:
        return await db.get(WorkflowTrigger, trigger_id)


async def _inbox_item(session_factory, trigger_id: uuid.UUID, external_item_id: str):  # type: ignore[no-untyped-def]
    async with session_factory() as db:
        return await ledger.get_poll_inbox_item(
            db, trigger_id=trigger_id, external_item_id=external_item_id
        )


async def _outbox_rows(session_factory, trigger_id: uuid.UUID) -> list[WorkflowRunOutbox]:  # type: ignore[no-untyped-def]
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


async def _run_count(session_factory, trigger_id: uuid.UUID) -> int:  # type: ignore[no-untyped-def]
    async with session_factory() as db:
        return len(
            (await db.execute(select(WorkflowRun).where(WorkflowRun.trigger_id == trigger_id)))
            .scalars()
            .all()
        )


# --- dedupe: replayed item creates no second run --------------------------------


async def test_replayed_page_creates_no_second_run(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)

    page = _page([_item("it_1", n=1, title="a")], cursor="c1")
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)):
        first = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert first is not None and first.counts.scheduled == 1

    # Endpoint replays the SAME item on the next occurrence (at-least-once
    # contract, spec §10.3) — the cursor it echoes is unchanged.
    await _force_due(session_factory, trigger_id)
    replay = _page([_item("it_1", n=1, title="a")], cursor="c1")
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=replay)):
        second = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert second is not None
    assert second.counts.scheduled == 0
    assert second.counts.duplicates == 1
    assert await _run_count(session_factory, trigger_id) == 1


# --- transient item failure: retry then dead-letter at 5 -----------------------


async def test_transient_failure_retries_then_dead_letters_at_five(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)
    page = _page([_item("boom_1", n=1, title="a")], cursor="cur-after")
    boom = AsyncMock(
        side_effect=CloudApiError("target_workspace_not_ready", "nope", status_code=409)
    )

    for _attempt_n in range(1, WORKFLOW_POLL_MAX_ATTEMPTS):
        await _force_due(session_factory, trigger_id)
        with (
            patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)),
            patch.object(worker_polls.compiler, "start_run", boom),
        ):
            outcome = await worker_polls.run_one_poll_attempt(
                session_factory, trigger_id=trigger_id, now=utcnow()
            )
        assert outcome is not None
        assert outcome.counts.pending_retry == 1
        assert outcome.cursor_advanced is False
        trig = await _trigger_row(session_factory, trigger_id)
        assert trig is not None and trig.poll_cursor is None  # cursor never advanced

    # 5th attempt crosses the ceiling: dead_letter, and the cursor (now
    # durable) advances past this occurrence.
    await _force_due(session_factory, trigger_id)
    with (
        patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)),
        patch.object(worker_polls.compiler, "start_run", boom),
    ):
        final = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert final is not None
    assert final.counts.dead_lettered == 1
    assert final.cursor_advanced is True
    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None and trig.poll_cursor == "cur-after"
    inbox = await _inbox_item(session_factory, trigger_id, "boom_1")
    assert inbox is not None
    assert inbox.status == WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER
    assert inbox.attempt_count == WORKFLOW_POLL_MAX_ATTEMPTS
    assert await _run_count(session_factory, trigger_id) == 0


# --- schema-invalid item: immediate dead letter ---------------------------------


async def test_schema_invalid_item_is_dead_lettered_immediately(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)
    # "n" missing + "title" wrong type -> schema-invalid on purpose.
    page = _page([_item("bad_1", title=42)], cursor="c1")
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)):
        outcome = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert outcome is not None
    assert outcome.counts.dead_lettered == 1
    assert outcome.cursor_advanced is True  # a dead_letter IS a durable decision
    inbox = await _inbox_item(session_factory, trigger_id, "bad_1")
    assert inbox is not None
    assert inbox.status == WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER
    assert inbox.attempt_count == 0  # never attempted start_run
    assert await _run_count(session_factory, trigger_id) == 0


# --- has_more chain: cursor CAS + next-page outbox are atomic ------------------


async def test_has_more_advances_cursor_and_queues_next_page(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)
    page1 = _page([_item("p1_1", n=1, title="a")], cursor="cur-p1", has_more=True)
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page1)):
        outcome1 = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert outcome1 is not None
    assert outcome1.cursor_advanced is True
    assert outcome1.next_page_queued is True

    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None and trig.poll_cursor == "cur-p1"
    rows = await _outbox_rows(session_factory, trigger_id)
    assert len(rows) == 1
    assert rows[0].kind == WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE
    assert rows[0].payload_json["requested_cursor"] == "cur-p1"
    assert rows[0].payload_json["page_number"] == 2

    # The next-page relay consumes that row and drives page 2 (terminal page).
    async with session_factory() as db:
        outbox_record = await ledger.get_outbox_row(db, rows[0].id)
    assert outbox_record is not None
    page2 = _page([_item("p2_1", n=2, title="b")], cursor="cur-p2", has_more=False)
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page2)):
        outcome2 = await worker_polls.run_next_page_attempt(
            session_factory, outbox_record, now=utcnow()
        )
    assert outcome2 is not None
    assert outcome2.cursor_advanced is True
    assert outcome2.next_page_queued is False
    trig2 = await _trigger_row(session_factory, trigger_id)
    assert trig2 is not None and trig2.poll_cursor == "cur-p2"
    # No third page was queued.
    assert len(await _outbox_rows(session_factory, trigger_id)) == 1


async def test_cursor_cas_and_next_page_outbox_commit_atomically(session_factory) -> None:  # type: ignore[no-untyped-def]
    """Simulate a crash between the cursor CAS and the next-page outbox write —
    both live in ONE transaction, so an exception between them must roll BOTH
    back, never advancing the cursor without the outbox row that lets a crash
    resume (spec §10.3, §7.3 'poll item intent committed before run
    materialization'-style boundary)."""

    trigger_id, _ = await _seed_poll_trigger(session_factory)
    page = _page([], cursor="cur-p1", has_more=True)

    with (
        patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)),
        patch.object(
            worker_polls.ledger, "enqueue_outbox", AsyncMock(side_effect=RuntimeError("crash"))
        ),
        pytest.raises(RuntimeError),
    ):
        await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )

    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None and trig.poll_cursor is None  # CAS rolled back too
    assert await _outbox_rows(session_factory, trigger_id) == []


# --- page budget exhaustion ------------------------------------------------------


async def test_page_budget_exhaustion_stops_the_chain(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)
    async with session_factory() as db, db.begin():
        seed_row = await ledger.enqueue_outbox(
            db,
            kind=WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE,
            trigger_id=trigger_id,
            payload_json={
                "requested_cursor": None,
                "generation": None,
                "page_number": WORKFLOW_POLL_PAGE_BUDGET,
            },
        )

    page = _page([], cursor="cur-100", has_more=True)
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)):
        outcome = await worker_polls.run_next_page_attempt(session_factory, seed_row, now=utcnow())
    assert outcome is not None
    assert outcome.budget_exhausted is True
    assert outcome.next_page_queued is False
    assert outcome.cursor_advanced is True  # the budget page's own items are durable

    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None
    assert trig.poll_cursor == "cur-100"
    assert trig.last_poll_error == WORKFLOW_POLL_PAGE_BUDGET_EXHAUSTED
    # No new next-page row emitted (only the synthetic seed row exists).
    assert len(await _outbox_rows(session_factory, trigger_id)) == 1


# --- repeated / null cursor: permanent contract error --------------------------


async def test_repeated_cursor_is_a_permanent_contract_error(session_factory) -> None:  # type: ignore[no-untyped-def]
    trigger_id, _ = await _seed_poll_trigger(session_factory)
    page = _page([], cursor=None, has_more=True)  # null cursor + has_more=True
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)):
        outcome = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert outcome is not None
    assert outcome.contract_error is True
    assert outcome.cursor_advanced is False
    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None
    assert trig.enabled is False
    assert trig.last_poll_error == WORKFLOW_POLL_CONTRACT_ERROR_REPEATED_CURSOR


async def test_unchanged_cursor_with_has_more_is_a_permanent_contract_error(
    session_factory,  # type: ignore[no-untyped-def]
) -> None:
    trigger_id, _ = await _seed_poll_trigger(session_factory, cursor="same")
    page = _page([], cursor="same", has_more=True)  # echoes the SAME requested cursor
    with patch.object(poller_module, "fetch_poll_page", AsyncMock(return_value=page)):
        outcome = await worker_polls.run_one_poll_attempt(
            session_factory, trigger_id=trigger_id, now=utcnow()
        )
    assert outcome is not None
    assert outcome.contract_error is True
    trig = await _trigger_row(session_factory, trigger_id)
    assert trig is not None and trig.enabled is False


# --- THE no-lock-over-HTTP proof (§7.3) -----------------------------------------


async def test_no_lock_held_across_the_blocked_http_fetch(session_factory) -> None:  # type: ignore[no-untyped-def]
    """Block the fetch and update the trigger from a SECOND connection: the
    update must not wait, proving no row lock or transaction is held across
    network I/O (spec §7.3, the required fault-injection proof for polling)."""

    trigger_id, _ = await _seed_poll_trigger(session_factory)
    fetch_entered = asyncio.Event()
    release_fetch = asyncio.Event()

    async def _blocking_fetch(**_kwargs: object) -> PollPage:
        fetch_entered.set()
        await release_fetch.wait()
        return _page([])

    with patch.object(poller_module, "fetch_poll_page", _blocking_fetch):
        attempt_task = asyncio.ensure_future(
            worker_polls.run_one_poll_attempt(session_factory, trigger_id=trigger_id, now=utcnow())
        )
        await asyncio.wait_for(fetch_entered.wait(), timeout=5)

        # A second, independent connection updates the SAME trigger row while
        # the fetch above is still blocked. If the poll worker held a
        # transaction/row lock across the fetch, this would hang until
        # release_fetch is set — it must complete promptly instead.
        async with session_factory() as db2, db2.begin():
            await asyncio.wait_for(
                trigger_store.update_trigger(db2, trigger_id=trigger_id, enabled=True),
                timeout=3.0,
            )

        release_fetch.set()
        outcome = await asyncio.wait_for(attempt_task, timeout=5)
    assert outcome is not None
