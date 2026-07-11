"""Observed-run snapshot mirror with revision CAS (feature spec §5.4).

The server accepts a whole ``ObservedRun`` snapshot only at exactly the current
revision plus one. The optimistic ``UPDATE ... WHERE observed_revision = :n``
is the WS2c acceptance primitive; this module owns only the mechanical CAS.
"""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflows import WorkflowRun
from proliferate.db.store.workflow_ledger.records import ObservedCasResult
from proliferate.utils.time import utcnow


def _canonical_snapshot_bytes(snapshot: dict[str, object]) -> str:
    """Stable serialization used only for the identical-retry check.

    RFC 8785 canonicalization proper is WS2b's hashing concern; for the
    "identical retry is a no-op" rule a deterministic sorted-key dump suffices
    to compare two payloads the store received.
    """

    return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))


async def cas_observed_snapshot(
    db: AsyncSession,
    *,
    run_id: UUID,
    revision: int,
    snapshot_json: dict[str, object],
    observed_state: str | None = None,
    observed_quiescence_state: str | None = None,
) -> ObservedCasResult:
    """Accept an observed snapshot only at exactly ``current revision + 1``.

    ``observed_revision IS NULL`` counts as revision 0, so the first accepted
    snapshot is revision 1. Returns the typed outcome; the caller owns auditing
    a ``conflict`` and resynchronizing on ``future_rejected``.
    """

    current = (
        await db.execute(
            select(WorkflowRun.observed_revision, WorkflowRun.observed_snapshot_json).where(
                WorkflowRun.id == run_id
            )
        )
    ).one_or_none()
    if current is None:
        raise ValueError(f"workflow run {run_id} does not exist")
    current_revision = current[0] or 0

    if revision == current_revision:
        prior = current[1]
        if prior is not None and _canonical_snapshot_bytes(dict(prior)) == (
            _canonical_snapshot_bytes(snapshot_json)
        ):
            return "retry_noop"
        return "conflict"
    if revision < current_revision:
        return "stale_rejected"
    if revision > current_revision + 1:
        return "future_rejected"

    values: dict[str, object] = {
        "observed_revision": revision,
        "observed_snapshot_json": snapshot_json,
        "updated_at": utcnow(),
    }
    if observed_state is not None:
        values["observed_state"] = observed_state
    if observed_quiescence_state is not None:
        values["observed_quiescence_state"] = observed_quiescence_state

    # The optimistic guard: only the exact prior revision may advance. A racing
    # writer that got there first makes this a zero-row update.
    guard = (
        WorkflowRun.observed_revision.is_(None)
        if current_revision == 0
        else WorkflowRun.observed_revision == current_revision
    )
    result = await db.execute(
        update(WorkflowRun)
        .where(WorkflowRun.id == run_id, guard)
        .values(**values)
        .returning(WorkflowRun.id)
    )
    return "applied" if result.scalar_one_or_none() is not None else "conflict"


async def get_observed_snapshot(
    db: AsyncSession, *, run_id: UUID
) -> tuple[int, dict[str, object] | None]:
    """The run's (observed_revision, observed_snapshot_json); revision 0 = none."""

    row = (
        await db.execute(
            select(WorkflowRun.observed_revision, WorkflowRun.observed_snapshot_json).where(
                WorkflowRun.id == run_id
            )
        )
    ).one_or_none()
    if row is None:
        raise ValueError(f"workflow run {run_id} does not exist")
    revision, snapshot = row
    return (revision or 0, dict(snapshot) if snapshot is not None else None)
