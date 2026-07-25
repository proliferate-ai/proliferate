"""Monotonic compare-and-set transitions for workflow delivery rows.

`workflow_invocation_delivery` mutates only through the CAS transitions
below: a late `failed` can never overwrite `accepted` or
cancellation-pending state, the runtime projection only stores strictly
greater revisions, and the first fixed runtime payload wins for every later
attempt (PR2 design §7.2/§8.3).

Custody fences: once `control_plane_runtime_outcome` records `runtime_lost`
(see `workflow_delivery_loss`), no transition below can deliver, accept,
project, or converge that row again; acceptance and projection require the
exact fixed payload digest, data epoch, run binding, and typed target
identity — a managed Cloud sandbox or a desktop install — correlated against
the immutable invocation row.

Local cancellation convergence is legal only for a `queued` row that provably
never left Cloud. Once `handoff_started_at` is set, a same-epoch absence at
the target is a signal to re-PUT the fixed body with `cancelRequested=true`,
never permission to mark the delivery cancelled here (design §8.1/§16).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocation, WorkflowInvocationDelivery
from proliferate.db.store.workflow_delivery_custody import (
    DELIVERY_STATUS_ACCEPTED,
    DELIVERY_STATUS_CANCELLED,
    DELIVERY_STATUS_DELIVERING,
    DELIVERY_STATUS_FAILED,
    DELIVERY_STATUS_QUEUED,
    ExpectedDeliveryTarget,
    ManagedCloudTarget,
    WorkflowDeliverySnapshot,
    delivery_snapshot,
    exact_target_conditions,
    invocation_target_exists,
    no_terminal_observation_condition,
)
from proliferate.utils.canonical_json import canonical_json, sha256_hex
from proliferate.utils.time import utcnow

_PRE_ACCEPTANCE_STATUSES = (DELIVERY_STATUS_QUEUED, DELIVERY_STATUS_DELIVERING)
_LIVE_CUSTODY_STATUSES = (DELIVERY_STATUS_DELIVERING, DELIVERY_STATUS_ACCEPTED)
_NONTERMINAL_STATUSES = (
    DELIVERY_STATUS_QUEUED,
    DELIVERY_STATUS_DELIVERING,
    DELIVERY_STATUS_ACCEPTED,
)
# Transport-envelope keys (design §7.2). Custody stores only the immutable
# run object; these fields are reconstructed per delivery attempt and may
# never enter the custodied body.
_RESERVED_TRANSPORT_KEYS = frozenset({"run", "control", "expectedDataEpoch"})


async def insert_workflow_delivery(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowDeliverySnapshot:
    row = WorkflowInvocationDelivery(
        invocation_id=invocation_id,
        status=DELIVERY_STATUS_QUEUED,
        attempt_count=0,
        updated_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    return delivery_snapshot(row)


async def get_workflow_delivery(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowDeliverySnapshot | None:
    row = (
        await db.execute(
            select(WorkflowInvocationDelivery).where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def get_workflow_delivery_for_update(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowDeliverySnapshot | None:
    """Lock and re-read the delivery row for a gate-then-enqueue decision.

    ``SELECT … FOR UPDATE`` holds the row lock until the caller's transaction
    commits, so a concurrent loss/projection/acceptance CAS cannot slip in
    between the eligibility check and the outbox insert (finding H).
    """

    row = (
        await db.execute(
            select(WorkflowInvocationDelivery)
            .where(WorkflowInvocationDelivery.invocation_id == invocation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def request_delivery_cancel(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowDeliverySnapshot | None:
    """Durably record cancellation intent; first false-to-true wins.

    The marker is written only on a nonterminal row — a delivery that already
    failed or cancelled has nothing left to cancel, and a terminal `failed`
    row must keep proving no cancellation raced it. A row whose projection
    already shows a terminal AnyHarness status is the run's result: there is
    nothing left to cancel, so no late marker is written. A queued row that
    was never offered to a target is terminally cancelled in the same
    statement family; anything later must converge at the target (PR2 design
    §16).
    """

    now = utcnow()
    await db.execute(
        update(WorkflowInvocationDelivery)
        .where(
            WorkflowInvocationDelivery.invocation_id == invocation_id,
            WorkflowInvocationDelivery.status.in_(_NONTERMINAL_STATUSES),
            WorkflowInvocationDelivery.cancel_requested_at.is_(None),
            no_terminal_observation_condition(),
        )
        .values(cancel_requested_at=now, updated_at=now)
    )
    await db.execute(
        update(WorkflowInvocationDelivery)
        .where(
            WorkflowInvocationDelivery.invocation_id == invocation_id,
            WorkflowInvocationDelivery.status == DELIVERY_STATUS_QUEUED,
            WorkflowInvocationDelivery.handoff_started_at.is_(None),
            WorkflowInvocationDelivery.cancel_requested_at.is_not(None),
        )
        .values(status=DELIVERY_STATUS_CANCELLED, finished_at=now, updated_at=now)
    )
    await db.flush()
    return await get_workflow_delivery(db, invocation_id=invocation_id)


async def record_delivery_cancelled_converged(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowDeliverySnapshot | None:
    """Terminal cancellation for a row that provably never left Cloud.

    Only a ``queued`` row without handoff evidence may converge locally
    (design §16). Once ``handoff_started_at`` is set the payload may be in
    flight and the delivery stays ``delivering``/``accepted`` with the cancel
    marker pending: a same-epoch absence at the target means re-PUT the fixed
    body with ``cancelRequested=true``, never local cancellation. The
    database CHECK (`ck_wf_delivery_cancelled_unoffered`) is the last fence.
    """

    now = utcnow()
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                WorkflowInvocationDelivery.status == DELIVERY_STATUS_QUEUED,
                WorkflowInvocationDelivery.handoff_started_at.is_(None),
                WorkflowInvocationDelivery.cancel_requested_at.is_not(None),
            )
            .values(status=DELIVERY_STATUS_CANCELLED, finished_at=now, updated_at=now)
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def mark_delivery_handoff_started(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """Record target-handoff evidence before any network I/O.

    Legal from ``queued`` (first attempt) and ``delivering`` (retry); returns
    ``None`` when the row is terminal, accepted, or runtime-lost, so a late
    handler attempt stops instead of resurrecting the delivery. The typed
    expected target must match the correlated invocation's target kind and
    desktop install; a managed sandbox binds first-writer and is immutable —
    an attempt naming a different sandbox is refused, never rebound.
    """

    now = utcnow()
    values: dict[str, object] = {
        "status": DELIVERY_STATUS_DELIVERING,
        "handoff_started_at": func.coalesce(WorkflowInvocationDelivery.handoff_started_at, now),
        "attempt_count": WorkflowInvocationDelivery.attempt_count + 1,
        "last_attempt_at": now,
        "updated_at": now,
    }
    conditions: list[ColumnElement[bool]] = [
        WorkflowInvocationDelivery.invocation_id == invocation_id,
        WorkflowInvocationDelivery.status.in_(_PRE_ACCEPTANCE_STATUSES),
        WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
        invocation_target_exists(invocation_id, expected_target),
    ]
    if isinstance(expected_target, ManagedCloudTarget):
        values["cloud_sandbox_id"] = func.coalesce(
            WorkflowInvocationDelivery.cloud_sandbox_id, expected_target.cloud_sandbox_id
        )
        conditions.append(
            WorkflowInvocationDelivery.cloud_sandbox_id.is_(None)
            | (WorkflowInvocationDelivery.cloud_sandbox_id == expected_target.cloud_sandbox_id)
        )
    else:
        conditions.append(WorkflowInvocationDelivery.cloud_sandbox_id.is_(None))
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(*conditions)
            .values(**values)
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def fix_runtime_payload(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    run_json: dict[str, object],
    anyharness_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """First-writer CAS for the immutable run object (design §7.2).

    Custody is the bare canonical ``run`` object only — the transport
    envelope (``expectedDataEpoch``/``run``/``control``) is reconstructed per
    attempt from the custodied data epoch, the immutable run, and the current
    durable cancellation state, so transport fields can never hide differing
    custody behind an identical digest. Fixing requires handoff evidence on a
    live ``delivering`` row with no runtime outcome — a run may never be
    fixed onto a queued, terminal, or lost delivery. The digest is recomputed
    here from the canonical run — a caller-supplied digest is never trusted,
    so body and digest cannot diverge. The run must be bound to this exact
    invocation (``runId``) and must embed the invocation's exact
    ``bundleDigest`` (design §6.3); a mismatched body — including one
    smuggling reserved transport keys — is an invariant violation, not a
    losable race. Every attempt after the winner must use the returned
    Cloud-custodied run; a different prepared candidate loses the CAS and
    must not be sent. The winning run is returned only off a fully fixed,
    live row under the exact typed target — a caller holding the wrong
    target identity, or racing a terminal/lost row, gets ``None``, never the
    custodied run.
    """

    if not anyharness_data_epoch:
        raise ValueError("Runtime payload requires the durable AnyHarness data epoch.")
    reserved = _RESERVED_TRANSPORT_KEYS & run_json.keys()
    if reserved:
        raise ValueError(
            "Run custody stores the bare run object; reserved transport keys are "
            f"forbidden: {sorted(reserved)}."
        )
    if run_json.get("runId") != str(invocation_id):
        raise ValueError("Run object runId must equal the invocation ID.")
    invocation_bundle_digest = await db.scalar(
        select(WorkflowInvocation.bundle_digest).where(WorkflowInvocation.id == invocation_id)
    )
    if invocation_bundle_digest is None:
        return None
    if run_json.get("bundleDigest") != invocation_bundle_digest:
        raise ValueError("Run object bundleDigest must equal the invocation's bundle digest.")
    computed_digest = sha256_hex(run_json)
    now = utcnow()
    target_conditions = exact_target_conditions(invocation_id, expected_target)
    await db.execute(
        update(WorkflowInvocationDelivery)
        .where(
            WorkflowInvocationDelivery.invocation_id == invocation_id,
            WorkflowInvocationDelivery.runtime_payload_digest.is_(None),
            WorkflowInvocationDelivery.status == DELIVERY_STATUS_DELIVERING,
            WorkflowInvocationDelivery.handoff_started_at.is_not(None),
            WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
            *target_conditions,
        )
        .values(
            runtime_payload_json=canonical_json(run_json),
            runtime_payload_digest=computed_digest,
            anyharness_data_epoch=anyharness_data_epoch,
            updated_at=now,
        )
    )
    await db.flush()
    winner = (
        await db.execute(
            select(WorkflowInvocationDelivery).where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                WorkflowInvocationDelivery.runtime_payload_digest.is_not(None),
                WorkflowInvocationDelivery.status.in_(_LIVE_CUSTODY_STATUSES),
                WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
                *target_conditions,
            )
        )
    ).scalar_one_or_none()
    return None if winner is None else delivery_snapshot(winner)


async def record_delivery_accepted(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    anyharness_run_id: str,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
    anyharness_workspace_id: str | None = None,
) -> WorkflowDeliverySnapshot | None:
    """Monotonic acceptance bound to the exact fixed custody (design §7.2).

    Legal only from ``delivering`` with handoff evidence, the winning payload
    digest, the fixed data epoch, and the exact typed target identity
    correlated against the invocation row. The AnyHarness run ID must be the
    bundle ``runId`` — the invocation ID — so a result for a different run
    can never bind here. Acceptance arriving after a cancel request is valid:
    the row becomes accepted with the cancellation marker still pending
    (design §16). A replay of an already-recorded acceptance under the exact
    custody is an idempotent no-op success; the workspace ID is monotonic —
    an acceptance recorded without it may be filled in by a later replay that
    knows it (``accepted_at`` untouched), an omitted workspace matches any
    recorded acceptance, and a conflicting non-null workspace returns
    ``None``. Any mismatched custody field returns ``None``.
    """

    if not expected_runtime_payload_digest:
        raise ValueError("Acceptance requires the exact fixed runtime payload digest.")
    if not expected_data_epoch:
        raise ValueError("Acceptance requires the exact fixed AnyHarness data epoch.")
    if anyharness_workspace_id is not None and not anyharness_workspace_id:
        raise ValueError("An AnyHarness workspace ID must be non-empty when supplied.")
    if anyharness_run_id != str(invocation_id):
        return None
    now = utcnow()
    custody_conditions: list[ColumnElement[bool]] = [
        WorkflowInvocationDelivery.invocation_id == invocation_id,
        WorkflowInvocationDelivery.handoff_started_at.is_not(None),
        WorkflowInvocationDelivery.runtime_payload_digest == expected_runtime_payload_digest,
        WorkflowInvocationDelivery.anyharness_data_epoch == expected_data_epoch,
        WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
        *exact_target_conditions(invocation_id, expected_target),
    ]
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.status == DELIVERY_STATUS_DELIVERING,
                *custody_conditions,
            )
            .values(
                status=DELIVERY_STATUS_ACCEPTED,
                anyharness_run_id=anyharness_run_id,
                anyharness_workspace_id=anyharness_workspace_id,
                accepted_at=now,
                updated_at=now,
            )
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    if row is not None:
        return delivery_snapshot(row)
    if anyharness_workspace_id is not None:
        filled = (
            await db.execute(
                update(WorkflowInvocationDelivery)
                .where(
                    WorkflowInvocationDelivery.status == DELIVERY_STATUS_ACCEPTED,
                    WorkflowInvocationDelivery.anyharness_run_id == anyharness_run_id,
                    WorkflowInvocationDelivery.anyharness_workspace_id.is_(None),
                    *custody_conditions,
                )
                .values(anyharness_workspace_id=anyharness_workspace_id, updated_at=now)
                .returning(WorkflowInvocationDelivery)
            )
        ).scalar_one_or_none()
        if filled is not None:
            return delivery_snapshot(filled)
    replay_conditions: list[ColumnElement[bool]] = [
        WorkflowInvocationDelivery.status == DELIVERY_STATUS_ACCEPTED,
        WorkflowInvocationDelivery.anyharness_run_id == anyharness_run_id,
        *custody_conditions,
    ]
    if anyharness_workspace_id is not None:
        replay_conditions.append(
            WorkflowInvocationDelivery.anyharness_workspace_id == anyharness_workspace_id
        )
    replay = (
        await db.execute(select(WorkflowInvocationDelivery).where(*replay_conditions))
    ).scalar_one_or_none()
    return None if replay is None else delivery_snapshot(replay)


async def record_delivery_failed_before_handoff(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    error_code: str,
    error_message: str,
) -> WorkflowDeliverySnapshot | None:
    """Deterministic rejection of a row that never left Cloud.

    Legal only from ``queued`` without handoff evidence — once the payload
    may have been offered to a target, failing the row requires the exact
    custody proof (`record_delivery_failed_after_handoff`). Guarded so a
    failure can never overwrite a cancellation-pending row (design §7.2).
    """

    now = utcnow()
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                WorkflowInvocationDelivery.status == DELIVERY_STATUS_QUEUED,
                WorkflowInvocationDelivery.handoff_started_at.is_(None),
                WorkflowInvocationDelivery.cancel_requested_at.is_(None),
                WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
            )
            .values(
                status=DELIVERY_STATUS_FAILED,
                error_code=error_code,
                error_message=error_message,
                finished_at=now,
                updated_at=now,
            )
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def record_delivery_failed_after_handoff(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    error_code: str,
    error_message: str,
    expected_runtime_payload_digest: str | None,
    expected_data_epoch: str | None,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """Deterministic target rejection bound to the exact offered custody.

    Legal only from ``delivering`` with handoff evidence and the exact typed
    target; the caller states exactly the payload digest and epoch it
    observed on the row it acted on (``None`` before the payload was fixed),
    so a prover holding a stale or foreign view can never fail a live row.
    A late failure can never overwrite ``accepted``, a cancellation-pending
    row, or a runtime-lost row (design §7.2); those return ``None``.
    """

    now = utcnow()
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                WorkflowInvocationDelivery.status == DELIVERY_STATUS_DELIVERING,
                WorkflowInvocationDelivery.handoff_started_at.is_not(None),
                WorkflowInvocationDelivery.runtime_payload_digest.is_not_distinct_from(
                    expected_runtime_payload_digest
                ),
                WorkflowInvocationDelivery.anyharness_data_epoch.is_not_distinct_from(
                    expected_data_epoch
                ),
                WorkflowInvocationDelivery.cancel_requested_at.is_(None),
                WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
                *exact_target_conditions(invocation_id, expected_target),
            )
            .values(
                status=DELIVERY_STATUS_FAILED,
                error_code=error_code,
                error_message=error_message,
                finished_at=now,
                updated_at=now,
            )
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


async def update_runtime_projection(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    anyharness_run_id: str,
    runtime_revision: int,
    runtime_observation_json: dict[str, object],
    runtime_observed_at: datetime,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """Store only strictly greater revisions (design §8.3); stale is a no-op.

    Projections bind to the accepted run's full custody: the row must be
    ``accepted``, carry the same AnyHarness run ID, the winning payload
    digest, the fixed data epoch, and the exact typed target, and have no
    control-plane runtime outcome — a lost runtime's projection is frozen at
    its last honest revision. A projection already showing a terminal
    AnyHarness status is the run's result and is never overwritten, even by a
    greater revision.
    """

    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                WorkflowInvocationDelivery.status == DELIVERY_STATUS_ACCEPTED,
                WorkflowInvocationDelivery.anyharness_run_id == anyharness_run_id,
                WorkflowInvocationDelivery.runtime_payload_digest
                == expected_runtime_payload_digest,
                WorkflowInvocationDelivery.anyharness_data_epoch == expected_data_epoch,
                WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
                no_terminal_observation_condition(),
                *exact_target_conditions(invocation_id, expected_target),
                (
                    WorkflowInvocationDelivery.runtime_revision.is_(None)
                    | (WorkflowInvocationDelivery.runtime_revision < runtime_revision)
                ),
            )
            .values(
                runtime_revision=runtime_revision,
                runtime_observation_json=dict(runtime_observation_json),
                runtime_observed_at=runtime_observed_at,
                updated_at=utcnow(),
            )
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)
