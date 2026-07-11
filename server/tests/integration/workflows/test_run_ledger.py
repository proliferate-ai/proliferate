"""T1-WF-LEDGER-01: WS2c run-ledger acceptance on real Postgres.

Exercises the observation-revision CAS matrix, commit-before-delivery, the
orphaned-never-regresses invariant, and the pre-acceptance cancellation matrix
against the real database (the ``db_session`` fixture is a Postgres session), so
the optimistic ``UPDATE ... WHERE observed_revision`` guard and the axis writes
are proven end to end.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import workflow_ledger as ledger
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import CloudSandboxGatewayAccess
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.server.cloud.workflows import delivery
from proliferate.server.cloud.workflows.worker import service as worker_service

pytestmark = pytest.mark.asyncio

_PLAN_HASH = "sha256:" + "a" * 64


@dataclass(frozen=True)
class _Actor:
    id: uuid.UUID


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"ledger-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_run(
    db: AsyncSession,
    user: User,
    *,
    status: str = "delivered",
    plan_hash: str | None = _PLAN_HASH,
    target_mode: str = "personal_cloud",
):
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowVersion
    from proliferate.utils.time import utcnow

    now = utcnow()
    workflow = Workflow(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="ledger-wf",
        created_at=now,
        updated_at=now,
    )
    db.add(workflow)
    await db.flush()
    version = WorkflowVersion(
        id=uuid.uuid4(),
        workflow_id=workflow.id,
        version_n=1,
        definition_json={"version": 1},
        created_by_user_id=user.id,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    return await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode=target_mode,
        resolved_plan_json={"run_id": "x", "steps": []},
        anyharness_workspace_id="sandbox-ws-1",
        status=status,
        plan_hash=plan_hash,
        plan_version=2,
        desired_state="running",
        delivery_state="delivered" if status == "delivered" else "ready",
    )


def _snapshot(
    run,
    *,
    revision: int,
    observed_state: str = "running",
    plan_hash: str | None = None,
    binding_hash: str = "",
    execution_generation: int = 0,
    sessions: dict | None = None,
    steps: list | None = None,
    quiescence: str = "active",
    extra: dict | None = None,
) -> dict:
    snap = {
        "schemaVersion": 2,
        "runId": str(run.id),
        "planHash": run.plan_hash if plan_hash is None else plan_hash,
        "bindingHash": binding_hash,
        "executionGeneration": execution_generation,
        "revision": revision,
        "observedState": observed_state,
        "quiescenceState": quiescence,
        "globalCursor": "0.-.0",
        "laneCursors": {},
        "sessions": sessions or {},
        "steps": steps or [],
        "worktrees": {},
        "cost": {"usd": "0", "tokens": 0},
        "timing": {"startedAt": "2026-07-10T00:00:00Z", "updatedAt": "2026-07-10T00:00:00Z"},
    }
    if extra:
        snap.update(extra)
    return snap


def _patch_gateway(monkeypatch, *, raises: Exception | None = None) -> None:
    async def _access(*_a: object, **_k: object) -> CloudSandboxGatewayAccess:
        if raises is not None:
            raise raises
        return CloudSandboxGatewayAccess(
            upstream_base_url="https://sandbox.test",
            upstream_token="sandbox-token",
            runtime_generation=1,
        )

    monkeypatch.setattr(delivery, "ensure_cloud_sandbox_gateway_access", _access)


# --- observation CAS matrix (spec §5.4) ----------------------------------------


async def test_observation_cas_matrix(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)

    # accept +1 (revision 1): applied, mirrored into legacy fields.
    r1 = await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    assert r1.result == "applied"
    assert r1.acked_revision == 1
    assert r1.run is not None and r1.run.status == "running"
    assert r1.run.observed_state == "running"
    assert r1.run.observed_revision == 1
    assert r1.run.execution_health == "healthy"

    # identical-bytes retry at the current revision: no-op ACK, no regression.
    r_retry = await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    assert r_retry.result == "retry_noop"
    assert r_retry.acked_revision == 1

    # conflicting same-revision payload: 409 audited failure, run unchanged.
    r_conflict = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(run, revision=1, observed_state="waiting_action_result"),
    )
    assert r_conflict.result == "conflict"
    assert r_conflict.acked_revision == 1

    # future revision (gap): rejected for resync, carries the acked revision.
    r_future = await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=5)
    )
    assert r_future.result == "future_rejected"
    assert r_future.acked_revision == 1

    # accept +1 again (revision 2).
    r2 = await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=2)
    )
    assert r2.result == "applied"

    # stale (older) revision: ignored ACK, does not regress observed state.
    r_stale = await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    assert r_stale.result == "stale_rejected"
    current = await store.get_run(db_session, run.id)
    assert current is not None and current.observed_revision == 2


async def test_observation_terminal_is_immutable(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    # revision 2: terminal completion.
    r_done = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(run, revision=2, observed_state="completed", quiescence="quiescent"),
    )
    assert r_done.result == "applied"
    assert r_done.run is not None and r_done.run.status == "completed"
    assert r_done.run.finished_at is not None

    # A duplicate terminal report at the same revision + identical bytes: no-op.
    r_dupe = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(run, revision=2, observed_state="completed", quiescence="quiescent"),
    )
    assert r_dupe.result == "retry_noop"

    # A NEW revision after terminal is rejected — the terminal snapshot is frozen.
    r_after = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(run, revision=3, observed_state="running"),
    )
    assert r_after.result == "terminal_immutable"
    current = await store.get_run(db_session, run.id)
    assert current is not None and current.status == "completed" and current.observed_revision == 2


async def test_observation_identity_must_match(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    # Wrong plan hash -> identity mismatch 409.
    with pytest.raises(CloudApiError) as exc:
        await worker_service.report_observed_run(
            db_session,
            _Actor(run.executor_user_id),
            run.id,
            _snapshot(run, revision=1, plan_hash="sha256:" + "b" * 64),
        )
    assert exc.value.code == "workflow_observation_identity_mismatch"
    assert exc.value.status_code == 409


async def test_observation_legacy_null_hash_accepts_sentinel(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    # A legacy run with NULL identity columns accepts the WS5a ''/''/0 sentinels.
    run = await _make_run(db_session, user, plan_hash=None)
    result = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(run, revision=1, plan_hash="", binding_hash="", execution_generation=0),
    )
    assert result.result == "applied"


async def test_observation_maps_sessions_and_steps(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    result = await worker_service.report_observed_run(
        db_session,
        _Actor(run.executor_user_id),
        run.id,
        _snapshot(
            run,
            revision=1,
            sessions={"main": "sess-1", "fix_a": "sess-2"},
            steps=[
                {"stepKey": "0.-.0", "attempt": 1, "status": "completed", "output": {"ok": True}},
                {"stepKey": "0.-.1", "attempt": 1, "status": "running"},
            ],
        ),
    )
    assert result.run is not None
    assert result.run.anyharness_session_ids == ["sess-1", "sess-2"]
    assert result.run.step_outputs_json == {"0.-.0": {"ok": True}}
    # One step left the running/pending phase.
    assert result.run.step_cursor == 1


# --- commit-before-delivery (§10.2) --------------------------------------------


async def test_commit_before_delivery_failure_leaves_retryable(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After the run intent is committed, a delivery failure leaves a durable
    ``pending_delivery`` row with ``delivery_state=retryable_ready`` and NO observed
    state — a failed delivery never fabricates an observation (§8.1)."""

    user = await _make_user(db_session)
    run = await _make_run(db_session, user, status="pending_delivery")
    # Commit the intent (as the StartRun endpoint does before delivering).
    await db_session.commit()

    _patch_gateway(
        monkeypatch,
        raises=CloudApiError("cloud_sandbox_missing", "no sandbox", status_code=409),
    )
    result = await delivery.deliver_cloud_run(db_session, _Actor(run.executor_user_id), run)

    assert result.status == "pending_delivery"
    assert result.delivery_state == "retryable_ready"
    assert result.observed_state is None
    assert result.observed_revision is None
    assert result.error_code == "delivery_failed"

    # The run row persists post-commit (the intent was durable before delivery).
    persisted = await store.get_run(db_session, run.id)
    assert persisted is not None and persisted.delivery_state == "retryable_ready"


# --- orphaned / suspect never regress observed state (§8.1) --------------------


async def test_refresh_failure_marks_suspect_without_touching_observed(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    # Land a real observation first.
    await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    observed_before = await store.get_run(db_session, run.id)
    assert observed_before is not None

    # An unreachable executor during refresh marks execution_health SUSPECT but
    # must NOT mutate any observed_* field.
    _patch_gateway(monkeypatch, raises=CloudRuntimeReconnectError("unreachable"))
    with pytest.raises(CloudApiError) as exc:
        await delivery.refresh_cloud_run(db_session, _Actor(run.executor_user_id), observed_before)
    assert exc.value.code == "cloud_run_refresh_failed"

    after = await store.get_run(db_session, run.id)
    assert after is not None
    assert after.execution_health == "suspect"
    # Observed axes are untouched.
    assert after.observed_state == observed_before.observed_state
    # The revision is unchanged, so the stored snapshot cannot have advanced.
    assert after.observed_revision == observed_before.observed_revision
    assert after.status == observed_before.status


async def test_orphaned_marker_never_overwrites_observed(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    run = await _make_run(db_session, user)
    await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    # Stamping the server-owned orphaned marker leaves the runtime observation intact.
    await store.update_run(db_session, run_id=run.id, execution_health="orphaned")
    after = await store.get_run(db_session, run.id)
    assert after is not None
    assert after.execution_health == "orphaned"
    assert after.observed_state == "running"
    assert after.observed_revision == 1


# --- pre-acceptance cancellation matrix (§8.3) ---------------------------------


async def test_pre_acceptance_cancel(db_session: AsyncSession) -> None:
    """Branch 1: an unclaimed run with no prepared lease cancels in one transaction —
    ``cancelled_before_acceptance``, desired ``cancel_requested``, offer invalidated,
    NO fabricated runtime observation, NO durable cancel command."""

    user = await _make_user(db_session)
    run = await _make_run(db_session, user, status="pending_delivery")
    # A delivery offer exists (an outbox row): it must be invalidated on cancel.
    await ledger.enqueue_outbox(db_session, kind="cloud_delivery", payload_json={}, run_id=run.id)

    cancelled = await delivery.cancel_run(db_session, user, run.id)
    assert cancelled.status == "cancelled"
    assert cancelled.desired_state == "cancel_requested"
    assert cancelled.preaccept_cancel_state == "cancelled_before_acceptance"
    # No fabricated runtime observation.
    assert cancelled.observed_state is None
    assert cancelled.observed_revision is None

    # The delivery offer was invalidated; no durable cancel command exists (nothing
    # was ever claimed to command).
    commands = await ledger.list_undelivered_control_commands(db_session, run_id=run.id)
    assert commands == ()


async def test_post_claim_cancel_enqueues_control_command(db_session: AsyncSession) -> None:
    """Branch 2: a run past acceptance (a runtime observation exists) cancels with
    today's terminal write PLUS a durable ``workflow_control_command`` and desired
    ``cancel_requested`` — no ``cancelled_before_acceptance``."""

    user = await _make_user(db_session)
    run = await _make_run(db_session, user, status="running")
    # A runtime observation exists -> the run is past acceptance.
    await worker_service.report_observed_run(
        db_session, _Actor(run.executor_user_id), run.id, _snapshot(run, revision=1)
    )
    fresh = await store.get_run(db_session, run.id)
    assert fresh is not None

    cancelled = await delivery.cancel_run(db_session, user, run.id)
    assert cancelled.status == "cancelled"
    assert cancelled.desired_state == "cancel_requested"
    assert cancelled.preaccept_cancel_state is None
    # The prior runtime observation is NOT overwritten by a fabricated cancel.
    assert cancelled.observed_state == "running"

    commands = await ledger.list_undelivered_control_commands(db_session, run_id=run.id)
    assert len(commands) == 1
    assert commands[0].kind == "cancel"
    assert commands[0].plan_hash == run.plan_hash
