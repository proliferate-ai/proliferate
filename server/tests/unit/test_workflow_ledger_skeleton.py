"""Tier-1 WS2a persistence-skeleton tests against real Postgres (part 1).

Proves the concurrency-bearing DB guarantees the later packets build on
(completion plan §6 WS2a; feature spec §5.4, §8.2, §10.2):

- partial-unique session lease: a second reserve for a session with any
  non-released lease fails; ``released`` allows rebinding
- observed-revision CAS: exactly revision+1 applies; an identical same-revision
  retry is a no-op; a conflicting same-revision payload is rejected; stale and
  future revisions are rejected
- outbox claim idempotency: a claimed (``delivering``) row cannot be claimed
  again; a rescheduled retry becomes claimable exactly when due
- the WS2a migration applies forward-only onto a populated pre-feature database

Uniqueness identities (inbox dedupe, receipt activation, action identity,
capability refs, control commands) are in ``test_workflow_ledger_identities.py``.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
from proliferate.db.store import workflow_ledger as ledger
from proliferate.utils.time import utcnow
from tests.postgres import temporary_database
from tests.unit.workflow_ledger_helpers import make_run, make_user

pytestmark = pytest.mark.asyncio

_PRE_FEATURE_HEAD = "c3f8b1d6a4e2"
# The current single head of the migration chain ("head" resolves here). Each
# packet that appends a workflow migration moves this pin: WS2a landed
# d9578c0275f3; WS3a appended b3d1f5a9c7e2 (function_invocation semantic_revision).
_CHAIN_HEAD = "b3d1f5a9c7e2"


# --- session leases (spec §8.2) ----------------------------------------------------


async def test_session_lease_partial_unique_blocks_second_reserve(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    run_a = await make_run(db_session, user)
    run_b = await make_run(db_session, user)
    session_id = f"session_{uuid.uuid4().hex}"

    first = await ledger.acquire_session_leases(
        db_session, run_id=run_a.id, sessions=((session_id, "slot-1"),)
    )
    assert first is not None and len(first) == 1
    assert first[0].state == "reserved"
    assert first[0].generation == 1

    # Second reserve while the first is non-released: the whole batch fails.
    second = await ledger.acquire_session_leases(
        db_session, run_id=run_b.id, sessions=((session_id, "slot-1"),)
    )
    assert second is None

    # Every blocking state keeps the session unbindable.
    lease_id = first[0].id
    for state in ("prepared", "claimed", "quiescing", "orphaned"):
        moved = await ledger.transition_session_lease(db_session, lease_id=lease_id, state=state)
        assert moved is not None and moved.state == state
        blocked = await ledger.acquire_session_leases(
            db_session, run_id=run_b.id, sessions=((session_id, "slot-1"),)
        )
        assert blocked is None, f"reserve must be blocked while lease is {state}"

    # Released allows rebinding, with a strictly greater fencing generation.
    released = await ledger.transition_session_lease(
        db_session, lease_id=lease_id, state="released"
    )
    assert released is not None and released.state == "released"
    rebound = await ledger.acquire_session_leases(
        db_session, run_id=run_b.id, sessions=((session_id, "slot-2"),)
    )
    assert rebound is not None and len(rebound) == 1
    assert rebound[0].run_id == run_b.id
    assert rebound[0].generation == 2

    active = await ledger.get_active_session_lease(db_session, session_id=session_id)
    assert active is not None and active.id == rebound[0].id


async def test_session_lease_acquisition_is_all_or_nothing(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run_a = await make_run(db_session, user)
    run_b = await make_run(db_session, user)
    session_free = f"session_{uuid.uuid4().hex}"
    session_taken = f"session_{uuid.uuid4().hex}"

    run_a_id = run_a.id
    run_b_id = run_b.id
    taken = await ledger.acquire_session_leases(
        db_session, run_id=run_a_id, sessions=((session_taken, None),)
    )
    assert taken is not None
    # Commit the setup so the failed batch's rollback below cannot erase it.
    await db_session.commit()

    # One of the two requested sessions is already held: the batch reports failure
    # and the caller rolls back the transaction so no partial reservation leaks.
    batch = await ledger.acquire_session_leases(
        db_session,
        run_id=run_b_id,
        sessions=((session_free, None), (session_taken, None)),
    )
    assert batch is None
    await db_session.rollback()

    assert await ledger.get_active_session_lease(db_session, session_id=session_free) is None
    still_held = await ledger.get_active_session_lease(db_session, session_id=session_taken)
    assert still_held is not None and still_held.run_id == run_a_id


# --- observed-revision CAS (spec §5.4) ----------------------------------------------


async def test_observed_snapshot_cas(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)

    revision, snapshot = await ledger.get_observed_snapshot(db_session, run_id=run.id)
    assert revision == 0 and snapshot is None

    snapshot_1: dict[str, object] = {"observedState": "accepted", "revision": 1}

    # revision + 1 succeeds (NULL counts as 0, so the first accepted is 1).
    assert (
        await ledger.cas_observed_snapshot(
            db_session,
            run_id=run.id,
            revision=1,
            snapshot_json=snapshot_1,
            observed_state="accepted",
        )
        == "applied"
    )

    # Identical retry at the current revision is a no-op.
    assert (
        await ledger.cas_observed_snapshot(
            db_session, run_id=run.id, revision=1, snapshot_json=dict(snapshot_1)
        )
        == "retry_noop"
    )

    # A conflicting same-revision payload is rejected (caller audits it).
    assert (
        await ledger.cas_observed_snapshot(
            db_session,
            run_id=run.id,
            revision=1,
            snapshot_json={"observedState": "running", "revision": 1},
        )
        == "conflict"
    )

    # Next revision advances.
    snapshot_2: dict[str, object] = {"observedState": "running", "revision": 2}
    assert (
        await ledger.cas_observed_snapshot(
            db_session,
            run_id=run.id,
            revision=2,
            snapshot_json=snapshot_2,
            observed_state="running",
        )
        == "applied"
    )

    # Stale is rejected and does not regress the stored snapshot.
    assert (
        await ledger.cas_observed_snapshot(
            db_session, run_id=run.id, revision=1, snapshot_json=snapshot_1
        )
        == "stale_rejected"
    )

    # A future revision (gap) is rejected for resynchronization.
    assert (
        await ledger.cas_observed_snapshot(
            db_session,
            run_id=run.id,
            revision=4,
            snapshot_json={"observedState": "running", "revision": 4},
        )
        == "future_rejected"
    )

    revision, snapshot = await ledger.get_observed_snapshot(db_session, run_id=run.id)
    assert revision == 2
    assert snapshot == snapshot_2


# --- transactional outbox ------------------------------------------------------------


async def test_outbox_claim_is_idempotent(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    now = utcnow()

    enqueued = await ledger.enqueue_outbox(
        db_session,
        kind="cloud_delivery",
        payload_json={"runId": str(run.id)},
        run_id=run.id,
        next_attempt_at=now,
    )
    assert enqueued.status == "pending" and enqueued.attempt_count == 0

    claimed = await ledger.claim_due_outbox_rows(db_session, now=now, limit=10)
    assert [row.id for row in claimed] == [enqueued.id]
    assert claimed[0].status == "delivering"
    assert claimed[0].attempt_count == 1

    # A claimed (delivering) row is not claimable again.
    assert await ledger.claim_due_outbox_rows(db_session, now=now, limit=10) == ()

    # Completing a delivering row lands it; completing again is a no-op.
    done = await ledger.complete_outbox_row(db_session, outbox_id=enqueued.id, status="delivered")
    assert done is not None and done.status == "delivered"
    still_done = await ledger.complete_outbox_row(
        db_session, outbox_id=enqueued.id, status="failed", last_error="late"
    )
    assert still_done is not None and still_done.status == "delivered"
    assert still_done.last_error is None

    # A delivered row never re-enters the due scan.
    assert await ledger.claim_due_outbox_rows(db_session, now=now, limit=10) == ()


async def test_outbox_retry_reschedule_becomes_claimable_again(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    now = utcnow()

    enqueued = await ledger.enqueue_outbox(
        db_session, kind="cloud_delivery", payload_json={}, run_id=run.id, next_attempt_at=now
    )
    (claimed,) = await ledger.claim_due_outbox_rows(db_session, now=now, limit=1)
    retry_at = now + timedelta(seconds=30)
    rescheduled = await ledger.complete_outbox_row(
        db_session,
        outbox_id=claimed.id,
        status="pending",
        last_error="transient",
        next_attempt_at=retry_at,
    )
    assert rescheduled is not None and rescheduled.status == "pending"

    # Not due yet.
    assert await ledger.claim_due_outbox_rows(db_session, now=now, limit=1) == ()
    # Due after the backoff; the second claim bumps the attempt count.
    (reclaimed,) = await ledger.claim_due_outbox_rows(
        db_session, now=retry_at + timedelta(seconds=1), limit=1
    )
    assert reclaimed.id == enqueued.id
    assert reclaimed.attempt_count == 2


# --- migration applies onto a populated pre-feature database ----------------------------


async def test_ws2a_migration_applies_to_populated_pre_feature_database() -> None:
    """Upgrade a database stopped at the pre-WS2a head, populate it with a live
    run through the legacy columns, then upgrade to head: the migration must
    apply cleanly, keep the row intact, and leave every new axis column NULL."""

    async with temporary_database("ws2a_prefeature") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _PRE_FEATURE_HEAD)

        engine = create_async_engine(database_url, echo=False)
        try:
            user_id = uuid.uuid4()
            workflow_id = uuid.uuid4()
            version_id = uuid.uuid4()
            run_id = uuid.uuid4()
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" (id, email, hashed_password, is_active, '
                        "is_superuser, is_verified, created_at) "
                        "VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": user_id, "email": f"pre-{uuid.uuid4().hex}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow (id, owner_user_id, created_by_user_id, name, "
                        "is_seed, created_at, updated_at) "
                        "VALUES (:id, :uid, :uid, 'pre-feature', false, now(), now())"
                    ),
                    {"id": workflow_id, "uid": user_id},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_version (id, workflow_id, version_n, "
                        "definition_json, created_by_user_id, created_at) "
                        "VALUES (:id, :wid, 1, '{}', :uid, now())"
                    ),
                    {"id": version_id, "wid": workflow_id, "uid": user_id},
                )
                await conn.execute(
                    text(
                        "INSERT INTO workflow_run (id, workflow_id, workflow_version_id, "
                        "trigger_kind, executor_user_id, args_json, target_mode, "
                        "resolved_plan_json, status, created_at, updated_at) "
                        "VALUES (:id, :wid, :vid, 'manual', :uid, '{}', 'local', '{}', "
                        "'running', now(), now())"
                    ),
                    {"id": run_id, "wid": workflow_id, "vid": version_id, "uid": user_id},
                )

            await asyncio.to_thread(command.upgrade, config, "head")

            async with engine.connect() as conn:
                version_num = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version_num == _CHAIN_HEAD
                row = (
                    await conn.execute(
                        text(
                            "SELECT status, desired_state, delivery_state, observed_state, "
                            "observed_revision, plan_hash, binding_hash "
                            "FROM workflow_run WHERE id = :id"
                        ),
                        {"id": run_id},
                    )
                ).one()
                assert row.status == "running"
                assert row.desired_state is None
                assert row.observed_revision is None
                assert row.plan_hash is None
                for table in (
                    "workflow_run_outbox",
                    "workflow_control_command",
                    "workflow_capability_lease",
                    "workflow_gateway_receipt",
                    "workflow_poll_inbox",
                    "workflow_session_lease",
                    "workflow_action_effect",
                ):
                    count = await conn.scalar(text(f"SELECT count(*) FROM {table}"))  # noqa: S608
                    assert count == 0
        finally:
            await engine.dispose()
