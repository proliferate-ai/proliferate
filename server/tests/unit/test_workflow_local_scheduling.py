"""Track 2a: desktop-executor local scheduling tests (lifts L15, spec 3.5).

Shared builders/patch helpers live in ``workflow_trigger_helpers.py``.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_CLAIMED,
    WORKFLOW_RUN_STATUS_COMPLETED,
    WORKFLOW_RUN_STATUS_MISSED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TARGET_MODE_LOCAL,
)
from proliferate.db.models.cloud.workflows import WorkflowRun, WorkflowRunGatewayToken
from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import local_executor, scheduler, triggers
from proliferate.server.cloud.workflows.models import (
    LocalWorkflowClaimActionRequest,
    RunStatusRequest,
)
from proliferate.server.cloud.workflows.worker import service as worker_service
from proliferate.utils.time import utcnow
from tests.unit.workflow_trigger_helpers import (
    _REPO,
    _claim_batch,
    _create_body,
    _fire_and_claim_local,
    _make_due,
    _make_user,
    _make_workflow,
    _owner,
    _patch_client,
    _patch_gateway,
    _patch_recording_gateway,
    _push_cursor_back,
    _seed_local_trigger,
    _seed_trigger,
    _trigger_runs,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


async def test_create_accepts_local_schedule_trigger(db_session: AsyncSession) -> None:
    """(2a CRUD) a local schedule trigger is now accepted — no cloud workspace, the
    repo pin retained (the local worktree hint), target_workspace_id NULL."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(target_mode="local")
    )
    assert trigger.target_mode == "local"
    assert trigger.target_workspace_id is None
    assert trigger.repo_full_name == _REPO
    assert trigger.next_run_at is not None and trigger.next_run_at > utcnow()


async def test_create_still_rejects_local_poll_trigger(db_session: AsyncSession) -> None:
    """Poll triggers stay cloud-only (the poller lane has no claim/missed machinery)."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    body = _create_body(target_mode="local")
    body.kind = "poll"  # type: ignore[assignment]
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(db_session, user, workflow.id, body)
    assert exc.value.code == "poll_local_unsupported"


async def test_local_schedule_fires_claimable_run_no_server_delivery(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(a) A due local schedule trigger fires ONE ``claimable`` run — NOT
    pending_delivery, and with ZERO server-side delivery (no sandbox wake, no
    gateway POST). Nothing on the server delivers a local run; it waits to be
    claimed by a desktop executor."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)

    assert result.created_runs == 1
    assert result.delivered_runs == 0  # local runs are never server-delivered
    assert wakes == []  # no sandbox woken
    assert seen == []  # no gateway deliver POST

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].status == WORKFLOW_RUN_STATUS_CLAIMABLE
    assert runs[0].status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY
    assert runs[0].target_mode == WORKFLOW_TARGET_MODE_LOCAL
    assert runs[0].claim_id is None  # unclaimed
    # Wave 2b: a schedule-triggered LOCAL run resolves to 'workspace' isolation (the
    # desktop mints its own worktree; the run executes directly in that checkout).
    assert runs[0].resolved_plan_json.get("isolation") == "workspace"


async def test_local_missed_run_latest_fires_newest_claimable_records_older_missed(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) The "laptop closed" backlog: a local schedule whose cursor is hours back
    partitions under run_latest — the NEWEST slot becomes a single ``claimable`` run
    and every OLDER slot is a terminal ``missed`` row. Reuses the wave-1 partition
    verbatim; the only local delta is that a fire produces a claimable run (no
    sandbox wake / delivery), proven at the dispatch boundary."""
    trigger_id, workflow_id = await _seed_local_trigger(
        session_factory, missed_run_policy=WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST
    )
    await _push_cursor_back(session_factory, trigger_id, hours=3.5)  # ~3 hourly slots
    wakes = _patch_recording_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 1  # exactly the newest slot
    assert result.delivered_runs == 0
    assert wakes == [] and seen == []  # DISPATCH BOUNDARY: no wake, no deliver

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    claimable = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_CLAIMABLE]
    missed = [r for r in runs if r.status == WORKFLOW_RUN_STATUS_MISSED]
    assert len(claimable) == 1
    assert len(missed) >= 2  # older slots recorded, no silent gap
    assert all(r.target_mode == WORKFLOW_TARGET_MODE_LOCAL for r in runs)
    newest = max(r.scheduled_for for r in runs)
    assert claimable[0].scheduled_for == newest
    assert all(r.scheduled_for < newest for r in missed)

    # The cursor advanced past the handled window — the next tick does not re-fire.
    second = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert second.created_runs == 0
    assert len(await _trigger_runs(session_factory, owner, trigger_id)) == len(runs)


async def test_local_stale_claim_is_reclaimable_exactly_once(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(c) A ``claimed`` run whose heartbeat lapsed past its TTL is reclaimable
    EXACTLY once: the reclaim rotates the claim_id (so the old holder's heartbeat is
    rejected), and an immediate second claim finds nothing (the claim is fresh
    again). This is the no-double-claim guarantee — the row lock + claim_id rotation
    make two racing claimers resolve to a single winner."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202))
    await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)

    first = await _claim_batch(session_factory, owner=owner)
    assert len(first) == 1
    run_id = uuid.UUID(first[0].id)
    assert first[0].status == WORKFLOW_RUN_STATUS_CLAIMED
    original_claim = first[0].claim_id
    assert original_claim is not None

    # A fresh claim is NOT stale, so a second poll claims nothing.
    assert await _claim_batch(session_factory, owner=owner) == []

    # Simulate the laptop closing: the heartbeat lapses past the TTL.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)

    # Exactly one reclaim: a new executor gets the run with a ROTATED claim_id.
    reclaimed = await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")
    assert len(reclaimed) == 1
    assert uuid.UUID(reclaimed[0].id) == run_id
    assert reclaimed[0].claim_id is not None and reclaimed[0].claim_id != original_claim

    # ...and it is not stale now, so a follow-up poll finds nothing (no double-claim).
    assert await _claim_batch(session_factory, owner=owner, executor_id="desktop-3") == []

    # The stale holder's heartbeat (old claim_id) is rejected; the winner's works.
    async with session_factory() as db, db.begin():
        stale = await local_executor.heartbeat_local_workflow_run(
            db,
            owner,
            run_id,
            LocalWorkflowClaimActionRequest(executorId="desktop-1", claimId=original_claim),  # type: ignore[call-arg]
        )
    assert stale.accepted is False and stale.run is None
    async with session_factory() as db, db.begin():
        ok = await local_executor.heartbeat_local_workflow_run(
            db,
            owner,
            run_id,
            LocalWorkflowClaimActionRequest(  # type: ignore[call-arg]
                executorId="desktop-2", claimId=reclaimed[0].claim_id
            ),
        )
    assert ok.accepted is True and ok.run is not None


async def test_local_terminal_report_expires_gateway_token_like_cloud(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(d) A local run reports terminal through the SAME /status path the cloud lane
    uses, so the shared terminal side effect fires: the per-run gateway token is
    expired the instant the run goes terminal (one observability + one credential
    surface for both lanes)."""
    trigger_id, workflow_id = await _seed_local_trigger(session_factory)
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    _patch_client(monkeypatch, lambda req: httpx.Response(202))
    await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    owner = await _owner(session_factory, workflow_id)

    claimed = await _claim_batch(session_factory, owner=owner)
    assert len(claimed) == 1
    run_id = uuid.UUID(claimed[0].id)
    claim_id = claimed[0].claim_id
    assert claim_id is not None

    # Every run mints a token (L16). A claim ROTATES it (BLOCKER fix): the StartRun
    # token is expired and a fresh one minted for the claimant, so after the claim
    # exactly one token is active (the rotated one) and the original is expired.
    async def _token_statuses() -> list[str]:
        async with session_factory() as db:
            rows = (
                (
                    await db.execute(
                        select(WorkflowRunGatewayToken.status).where(
                            WorkflowRunGatewayToken.workflow_run_id == run_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        return list(rows)

    before = await _token_statuses()
    assert before.count("active") == 1  # exactly the rotated token is live
    assert before.count("expired") == 1  # the original StartRun token was expired

    # The relay reports via owner auth and MUST carry the live claim_id (2a).
    actor = SimpleNamespace(id=owner)
    async with session_factory() as db, db.begin():
        await worker_service.report_run_status(
            db,
            actor,
            run_id,
            RunStatusRequest(status="running", claimId=claim_id),  # type: ignore[arg-type,call-arg]
        )
    async with session_factory() as db, db.begin():
        await worker_service.report_run_status(
            db,
            actor,
            run_id,
            RunStatusRequest(status="completed", claimId=claim_id),  # type: ignore[arg-type,call-arg]
        )

    after = await _token_statuses()
    # Terminal report expired the (rotated) active token, like the cloud path — no
    # token is left live for the run.
    assert "active" not in after and set(after) == {"expired"}
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert runs[0].status == WORKFLOW_RUN_STATUS_COMPLETED


async def test_local_reclaim_rejects_stale_claim_report_and_leaves_run_untouched(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER (owner-auth path): after laptop B reclaims a stale run, laptop A's
    relay — which reports via OWNER auth (same user owns both laptops, so the token
    check can't distinguish them) — carries A's now-stale claim_id. That report is
    rejected 409 ``workflow_run_stale_claim`` and the run is untouched, so A cannot
    clobber the run B now owns."""
    trigger_id, owner, first = await _fire_and_claim_local(session_factory, monkeypatch)
    assert len(first) == 1
    run_id = uuid.UUID(first[0].id)
    stale_claim = first[0].claim_id
    assert stale_claim is not None

    # Laptop A closes: its heartbeat lapses; laptop B reclaims with a fresh claim.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)
    reclaimed = await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")
    assert len(reclaimed) == 1
    new_claim = reclaimed[0].claim_id
    assert new_claim is not None and new_claim != stale_claim

    # A's stale relay report (old claim_id) is rejected; the run is untouched.
    actor = SimpleNamespace(id=owner)
    with pytest.raises(CloudApiError) as exc:
        async with session_factory() as db, db.begin():
            await worker_service.report_run_status(
                db,
                actor,
                run_id,
                RunStatusRequest(status="running", claimId=stale_claim),  # type: ignore[arg-type,call-arg]
            )
    assert exc.value.code == "workflow_run_stale_claim"
    assert exc.value.status_code == 409
    async with session_factory() as db:
        untouched = await store.get_run(db, run_id)
    assert untouched is not None
    assert untouched.status == WORKFLOW_RUN_STATUS_CLAIMED  # never advanced to running
    assert str(untouched.claim_id) == new_claim  # still B's claim
    assert untouched.started_at is None

    # B's relay (current claim_id) drives the run normally.
    async with session_factory() as db, db.begin():
        ok = await worker_service.report_run_status(
            db,
            actor,
            run_id,
            RunStatusRequest(status="running", claimId=new_claim),  # type: ignore[arg-type,call-arg]
        )
    assert ok.status == WORKFLOW_RUN_STATUS_RUNNING


async def test_local_claimed_run_report_without_claim_id_rejected(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER: an owner-authed report on a live-claimed LOCAL run that omits the
    claim_id is rejected (the relay must thread it) — otherwise the owner-auth path
    is unauthenticated at the claim granularity."""
    _trigger_id, owner, claimed = await _fire_and_claim_local(session_factory, monkeypatch)
    run_id = uuid.UUID(claimed[0].id)
    actor = SimpleNamespace(id=owner)
    with pytest.raises(CloudApiError) as exc:
        async with session_factory() as db, db.begin():
            await worker_service.report_run_status(
                db,
                actor,
                run_id,
                RunStatusRequest(status="running"),  # type: ignore[arg-type]
            )
    assert exc.value.code == "workflow_run_claim_required"
    assert exc.value.status_code == 409


async def test_local_claim_rotates_gateway_token(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BLOCKER (token path): each claim/reclaim rotates the per-run gateway token —
    the prior holder's token is expired and a fresh one minted, so a partitioned
    laptop's runtime is 401'd by the gateway + token-authed /status. Exactly one
    token is active after each claim, and its hash changes on reclaim."""
    trigger_id, owner, first = await _fire_and_claim_local(session_factory, monkeypatch)
    run_id = uuid.UUID(first[0].id)

    async def _token_rows() -> list:
        async with session_factory() as db:
            return list(
                (
                    await db.execute(
                        select(
                            WorkflowRunGatewayToken.status, WorkflowRunGatewayToken.token_hash
                        ).where(WorkflowRunGatewayToken.workflow_run_id == run_id)
                    )
                ).all()
            )

    after_first = await _token_rows()
    active_first = [h for s, h in after_first if s == "active"]
    # StartRun minted one, the claim rotated it: exactly one active, one expired.
    assert len(active_first) == 1
    assert sum(1 for s, _ in after_first if s == "expired") == 1

    # Reclaim after the claim lapses: the token rotates again.
    async with session_factory() as db, db.begin():
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.claim_expires_at = utcnow() - timedelta(seconds=1)
    await _claim_batch(session_factory, owner=owner, executor_id="desktop-2")

    after_reclaim = await _token_rows()
    active_reclaim = [h for s, h in after_reclaim if s == "active"]
    assert len(active_reclaim) == 1  # still exactly one live token
    assert active_reclaim[0] != active_first[0]  # ...and it is a NEW token hash
    # The prior claimant's token hash is now expired — its runtime is locked out.
    assert active_first[0] not in [h for s, h in after_reclaim if s == "active"]


async def test_cloud_run_report_needs_no_claim_id(db_session: AsyncSession) -> None:
    """Regression: a cloud run never carries a claim, so its /status reports are
    unchanged — no claim_id is required and the guard is a no-op (the runtime
    self-reports via its per-run gateway token)."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    assert workflow.current_version_id is not None
    run = await store.create_run(
        db_session,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind="schedule",
        executor_user_id=user.id,
        args_json={},
        target_mode="personal_cloud",
        resolved_plan_json={},
        status="delivered",
    )
    updated = await worker_service.report_run_status(
        db_session,
        user,
        run.id,
        RunStatusRequest(status="running"),  # type: ignore[arg-type]
    )
    assert updated.status == WORKFLOW_RUN_STATUS_RUNNING
    assert updated.claim_id is None


async def test_cloud_scheduled_run_is_never_claimable_regression(
    session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(e) Regression: a CLOUD schedule trigger is unaffected by 2a — its run is
    pending_delivery and server-delivered as before, and the local claim plane never
    returns it (a cloud run must never be handed to a desktop executor)."""
    trigger_id, workflow_id = await _seed_trigger(session_factory, concurrency="skip")
    await _make_due(session_factory, trigger_id)
    _patch_gateway(monkeypatch)
    seen = _patch_client(monkeypatch, lambda req: httpx.Response(202, json={"status": "running"}))

    result = await scheduler.run_workflow_scheduler_tick(session_factory=session_factory)
    assert result.created_runs == 1
    assert result.delivered_runs == 1  # cloud lane still delivers
    assert len(seen) == 1

    owner = await _owner(session_factory, workflow_id)
    runs = await _trigger_runs(session_factory, owner, trigger_id)
    assert len(runs) == 1
    assert runs[0].target_mode == "personal_cloud"
    assert runs[0].status not in (WORKFLOW_RUN_STATUS_CLAIMABLE, WORKFLOW_RUN_STATUS_CLAIMED)

    # The local claim poll for this owner returns nothing — cloud runs are off-limits.
    assert await _claim_batch(session_factory, owner=owner) == []
