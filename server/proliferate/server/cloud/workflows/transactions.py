"""Request-lane transaction orchestration for the workflow cloud lane (§10.2).

Commit-before-delivery: the StartRun request must persist the run intent durably
BEFORE any sandbox/runtime network call, so a rolled-back request can never orphan
a runtime. This helper commits the caller's transaction, then delivers in a fresh
unit. It lives here (not in ``api.py``) so the route handler imports only
``get_async_session`` from the engine — the server-boundary rule reserves any other
``db.engine`` import for non-API layers (mirrors ``cloud_sandboxes/transactions.py``).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db.engine import commit_session
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run


async def commit_then_deliver_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Commit the run intent (§10.2), then deliver the cloud run in a fresh unit.

    ``deliver_cloud_run`` stays idempotent, so a delivery failure here leaves a
    committed ``pending_delivery`` run with ``delivery_state=retryable_ready`` that
    /deliver and the WS4a outbox relay retry — never an orphaned runtime.
    """

    await commit_session(db)
    return await deliver_cloud_run(db, user, run)
