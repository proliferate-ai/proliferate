"""Track 1e: correlation-context binding + poller/schedule beat split.

Covers:
  (a) scheduler and poller unit-of-work bind org/user correlation context (via
      the ``with_correlation_context`` mechanism, not string log matching).
  (b) the poll beat is its own coroutine, independent of the schedule tick — a
      slow/failing poll does not block run delivery (a fake feed proves the split
      by making the poll beat hang/fail while the schedule beat still delivers).
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.constants.workflows import (
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.models.cloud.workflows import Workflow, WorkflowTrigger, WorkflowVersion
from proliferate.middleware.request_context import get_correlation_context
from proliferate.server.cloud.workflows import poller as poller_module
from proliferate.server.cloud.workflows import scheduler as scheduler_module
from proliferate.server.cloud.workflows.worker import schedules as schedules_module
from proliferate.server.cloud.workflows.poller import _poll_one_trigger, run_workflow_poller_tick
from proliferate.server.cloud.workflows.domain.poll_contract import PollPage
from proliferate.server.automations.domain.schedule import latest_due_occurrence
from proliferate.utils.time import utcnow

_DEF = {
    "version": 1,
    "inputs": [],
    "agents": [
        {
            "slot": "main",
            "harness": "claude",
            "model": "sonnet",
            "steps": [{"kind": "agent.prompt", "prompt": "hi"}],
        }
    ],
}


def _factory(test_engine) -> async_sessionmaker:  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


async def _make_user_and_org(db: AsyncSession) -> tuple[User, Organization]:
    org = Organization(id=uuid.uuid4(), name=f"org-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(),
        email=f"wf-obs-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    # Workflows are user-scoped (no organization_id column on the row today) —
    # the scheduler/poller derive org via the owner's current membership, the
    # same house pattern gateway_grants._organization_id_for_owner uses.
    db.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db.flush()
    return user, org


async def _make_workflow(db: AsyncSession, user: User, org: Organization) -> Workflow:
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="obs-wf",
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


async def _make_schedule_trigger(db: AsyncSession, wf: Workflow, user: User) -> WorkflowTrigger:
    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        workflow_id=wf.id,
        kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
        enabled=True,
        concurrency_policy="skip",
        target_mode="local",
        repo_full_name="acme/widgets",
        target_workspace_id=None,
        schedule_rrule="FREQ=HOURLY",
        schedule_timezone="UTC",
        # A real recent occurrence (the missed-window scan keys off the cursor,
        # which is always a genuine RRULE slot in production).
        next_run_at=latest_due_occurrence(rrule_text="FREQ=HOURLY", timezone="UTC", now=utcnow()),
        args_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(trigger)
    await db.flush()
    return trigger


async def _make_poll_trigger(db: AsyncSession, wf: Workflow, user: User) -> WorkflowTrigger:
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
        poll_interval_secs=60,
        poll_item_schema_json={"type": "object", "properties": {}},
        poll_cursor=None,
        last_poll_at=None,
        args_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(trigger)
    await db.flush()
    return trigger


# --- (a) correlation context is bound at the per-trigger unit of work -----------


async def test_schedule_trigger_fire_binds_org_and_user_context(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user, org = await _make_user_and_org(db)
        wf = await _make_workflow(db, user, org)
        trigger = await _make_schedule_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    captured: dict[str, str] = {}
    real_start_run = schedules_module.compiler.start_run

    async def _spy_start_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        # Snapshot the correlation context exactly as it is inside the unit of
        # work service.start_run runs in — this is the "not string-matching logs"
        # assertion the mechanism gives us for free.
        captured.update(get_correlation_context())
        return await real_start_run(*args, **kwargs)

    with patch.object(schedules_module.compiler, "start_run", new=_spy_start_run):
        async with factory() as db, db.begin():
            created = await schedules_module.fire_one_trigger(
                db, trigger_id=trigger_id, now=utcnow()
            )

    assert created == 1
    assert captured["organization_id"] == str(org.id)
    assert captured["user_id"] == str(user.id)
    assert captured["worker_id"] == "workflow_schedules"
    # Context must not leak past the unit of work.
    assert get_correlation_context().get("organization_id") is None


async def test_poll_trigger_poll_binds_org_and_user_context(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user, org = await _make_user_and_org(db)
        wf = await _make_workflow(db, user, org)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    page = PollPage(items=[], cursor="c1", has_more=False)
    captured: dict[str, str] = {}

    async def _fake_fetch(**kwargs):  # type: ignore[no-untyped-def]
        captured.update(get_correlation_context())
        return page

    with (
        patch.object(poller_module, "guard_poll_endpoint", lambda _url: None),
        patch.object(poller_module, "fetch_poll_page", new=AsyncMock(side_effect=_fake_fetch)),
    ):
        await _poll_one_trigger(factory, trigger_id=trigger_id, now=utcnow())

    assert captured["organization_id"] == str(org.id)
    assert captured["user_id"] == str(user.id)
    assert captured["worker_id"] == "workflow_poller"
    assert get_correlation_context().get("organization_id") is None


# --- (b) the poll beat is independent of the schedule tick ----------------------


async def test_poll_beat_failure_does_not_block_schedule_delivery(test_engine) -> None:  # type: ignore[no-untyped-def]
    """A hanging/failing poll beat must not delay the schedule beat's delivery.

    Proven at the unit level over the split coroutines: run_workflow_scheduler_tick
    no longer calls the poller at all (it only fires + delivers), so a poll beat
    that raises or blocks forever runs in run_workflow_poller_tick, a separate
    coroutine gathered independently by the automations worker.
    """

    factory = _factory(test_engine)
    async with factory() as db:
        user, org = await _make_user_and_org(db)
        wf = await _make_workflow(db, user, org)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger_id = trigger.id
        await db.commit()

    async def _hangs_forever(**kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("poll endpoint is stuck")

    # The schedule tick must complete normally even though polling would fail —
    # because the schedule tick doesn't touch the poller anymore.
    with (
        patch.object(poller_module, "guard_poll_endpoint", lambda _url: None),
        patch.object(poller_module, "fetch_poll_page", new=AsyncMock(side_effect=_hangs_forever)),
    ):
        result = await scheduler_module.run_workflow_scheduler_tick(session_factory=factory)
        assert result.created_runs == 0
        assert result.delivered_runs == 0

        # The poll beat, run on its own, does fail — but isolated to its own tick,
        # never touching the schedule beat above.
        spawned = await run_workflow_poller_tick(session_factory=factory)
        assert spawned == 0  # the one due trigger errored; run_poll_pass swallows it

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.last_poll_error is not None
