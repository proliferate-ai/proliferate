"""Proof-specific runtime-loss transitions for workflow deliveries.

Runtime loss is proof-specific (PR2 design §8.3): an observed epoch change,
the authoritative same-epoch absence of an *accepted* run, or irreversible
managed sandbox destruction. A merely `delivering` same-epoch 404 is a
re-PUT, not loss. A real terminal AnyHarness observation always takes
precedence over loss: loss-first fences all later work; terminal-first
blocks loss. Once recorded, no delivery transition can deliver, accept,
project, or converge that row again.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import ColumnElement, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocationDelivery
from proliferate.db.store.workflow_delivery_custody import (
    DELIVERY_STATUS_ACCEPTED,
    DELIVERY_STATUS_DELIVERING,
    ExpectedDeliveryTarget,
    ManagedCloudTarget,
    WorkflowDeliverySnapshot,
    delivery_snapshot,
    exact_target_conditions,
    no_terminal_observation_condition,
)
from proliferate.utils.time import utcnow

RuntimeLostProof = Literal["epoch_changed", "accepted_run_absent", "sandbox_destroyed"]


async def _record_runtime_lost(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    reason: RuntimeLostProof,
    expected_runtime_revision: int | None,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
    status_condition: ColumnElement[bool],
) -> WorkflowDeliverySnapshot | None:
    """Shared loss CAS: every proof fences the same custody (design §8.3).

    Loss exists only after handoff may have occurred, against the exact fixed
    payload digest, data epoch, typed target, and the projection revision the
    prover observed. A live outcome is one-shot, and a projection already
    showing a terminal AnyHarness status always wins — in either commit
    order: loss-first freezes later projections, terminal-first blocks loss.
    """

    now = utcnow()
    row = (
        await db.execute(
            update(WorkflowInvocationDelivery)
            .where(
                WorkflowInvocationDelivery.invocation_id == invocation_id,
                status_condition,
                WorkflowInvocationDelivery.handoff_started_at.is_not(None),
                WorkflowInvocationDelivery.runtime_payload_digest
                == expected_runtime_payload_digest,
                WorkflowInvocationDelivery.anyharness_data_epoch == expected_data_epoch,
                WorkflowInvocationDelivery.runtime_revision.is_not_distinct_from(
                    expected_runtime_revision
                ),
                WorkflowInvocationDelivery.control_plane_runtime_outcome.is_(None),
                no_terminal_observation_condition(),
                *exact_target_conditions(invocation_id, expected_target),
            )
            .values(
                control_plane_runtime_outcome="runtime_lost",
                control_plane_runtime_outcome_at=now,
                control_plane_runtime_outcome_reason=reason,
                updated_at=now,
            )
            .returning(WorkflowInvocationDelivery)
        )
    ).scalar_one_or_none()
    return None if row is None else delivery_snapshot(row)


def _expected_live_status_condition(
    expected_status: Literal["delivering", "accepted"],
) -> ColumnElement[bool]:
    if expected_status not in (DELIVERY_STATUS_DELIVERING, DELIVERY_STATUS_ACCEPTED):
        raise ValueError("Runtime loss applies only to a delivering or accepted row.")
    return WorkflowInvocationDelivery.status == expected_status


async def record_runtime_lost_epoch_changed(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_status: Literal["delivering", "accepted"],
    expected_runtime_revision: int | None,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    observed_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """Loss proof: the target's durable data epoch changed after handoff.

    The proof is the observed replacement epoch itself — reporting the fixed
    epoch back is not an epoch change and is an invariant violation, not a
    losable race (a same-epoch 404 of a merely delivering run means re-PUT).
    """

    if not observed_data_epoch or observed_data_epoch == expected_data_epoch:
        raise ValueError(
            "An epoch-change proof requires an observed epoch that differs from"
            " the fixed data epoch."
        )
    return await _record_runtime_lost(
        db,
        invocation_id=invocation_id,
        reason="epoch_changed",
        expected_runtime_revision=expected_runtime_revision,
        expected_runtime_payload_digest=expected_runtime_payload_digest,
        expected_data_epoch=expected_data_epoch,
        expected_target=expected_target,
        status_condition=_expected_live_status_condition(expected_status),
    )


async def record_runtime_lost_accepted_run_absent(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    anyharness_run_id: str,
    expected_runtime_revision: int | None,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    expected_target: ExpectedDeliveryTarget,
) -> WorkflowDeliverySnapshot | None:
    """Loss proof: authoritative same-epoch absence of an *accepted* run.

    Only an accepted run can be proven absent — AnyHarness durably owned it,
    so a same-epoch 404 is authoritative. For a merely delivering row the
    same 404 means the PUT never landed and must be retried, never loss.
    """

    return await _record_runtime_lost(
        db,
        invocation_id=invocation_id,
        reason="accepted_run_absent",
        expected_runtime_revision=expected_runtime_revision,
        expected_runtime_payload_digest=expected_runtime_payload_digest,
        expected_data_epoch=expected_data_epoch,
        expected_target=expected_target,
        status_condition=(
            (WorkflowInvocationDelivery.status == DELIVERY_STATUS_ACCEPTED)
            & (WorkflowInvocationDelivery.anyharness_run_id == anyharness_run_id)
        ),
    )


async def record_runtime_lost_sandbox_destroyed(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    expected_status: Literal["delivering", "accepted"],
    expected_runtime_revision: int | None,
    expected_runtime_payload_digest: str,
    expected_data_epoch: str,
    expected_target: ManagedCloudTarget,
) -> WorkflowDeliverySnapshot | None:
    """Loss proof: irreversible destruction of the exact managed sandbox.

    Managed targets only — the typed target carries the exact bound sandbox
    ID, so destruction of some other sandbox can never lose this delivery.
    Pause and ordinary unreachability are never this proof.
    """

    if not isinstance(expected_target, ManagedCloudTarget):
        raise ValueError("Sandbox destruction requires a managed Cloud target.")

    return await _record_runtime_lost(
        db,
        invocation_id=invocation_id,
        reason="sandbox_destroyed",
        expected_runtime_revision=expected_runtime_revision,
        expected_runtime_payload_digest=expected_runtime_payload_digest,
        expected_data_epoch=expected_data_epoch,
        expected_target=expected_target,
        status_condition=_expected_live_status_condition(expected_status),
    )
