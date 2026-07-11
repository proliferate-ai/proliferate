"""Feature-off workflow execution surfaces for WF-ID.

WF-ID ends at immutable plan/source identity, materialization offers, and one
accepted redacted binding. Runtime delivery, refresh, ping reconciliation, and
cancel/takeover require the final credential envelope plus authenticated
observation/control contracts owned by later packets.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.service import _visible_run

ACTIVATION_UNAVAILABLE_CODE = "workflow_final_envelope_unavailable"


def _activation_unavailable() -> CloudApiError:
    return CloudApiError(
        ACTIVATION_UNAVAILABLE_CODE,
        "Workflow execution is parked until the final credential envelope is available.",
        status_code=409,
    )


async def deliver_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Reject before billing, sandbox wake, network, or ledger mutation."""

    del db, user, run
    raise _activation_unavailable()


async def refresh_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Reject before runtime reads or observed-state mutation."""

    del db, user, run
    raise _activation_unavailable()


async def observe_run_ping(db: AsyncSession, *, run_id: UUID, actor: ActorIdentity) -> None:
    """Reject the legacy unauthenticated-observation reconciliation path."""

    del db, run_id, actor
    raise _activation_unavailable()


async def cancel_run(db: AsyncSession, user: ActorIdentity, run_id: UUID) -> WorkflowRunRecord:
    """Keep every visible pre-cutover run parked; do not release runtime state."""

    await _visible_run(db, user=user, run_id=run_id)
    raise _activation_unavailable()
