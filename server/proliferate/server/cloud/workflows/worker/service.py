"""Feature-off executor reporting boundary for WF-ID."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.delivery import ACTIVATION_UNAVAILABLE_CODE
from proliferate.server.cloud.workflows.models import RunStatusRequest
from proliferate.server.cloud.workflows.service import _visible_run


def _reporting_unavailable() -> CloudApiError:
    return CloudApiError(
        ACTIVATION_UNAVAILABLE_CODE,
        "Workflow execution reporting is parked until authenticated "
        "final-envelope contracts exist.",
        status_code=409,
    )


async def mark_run_delivered(
    db: AsyncSession, user: ActorIdentity, run_id: UUID
) -> WorkflowRunRecord:
    """Reject legacy delivery acknowledgement without mutating the run."""

    await _visible_run(db, user=user, run_id=run_id)
    raise _reporting_unavailable()


async def report_run_status(
    db: AsyncSession,
    user: ActorIdentity,
    run_id: UUID,
    body: RunStatusRequest,
    *,
    authed_via_run_token: bool = False,
) -> WorkflowRunRecord:
    """Reject owner/legacy-token status reports without observations or actions."""

    del body, authed_via_run_token
    await _visible_run(db, user=user, run_id=run_id)
    raise _reporting_unavailable()
