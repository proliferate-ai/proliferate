"""Cloud model-snapshot persistence: soft-versioned machine observations.

One row per (harness_kind, auth_context_id, owner_user_id) is ``active``; every
prior write is retained as ``inactive``, which is the audit trail that makes
"what changed between refreshes" answerable without storing diffs
(model-catalog.md §Storage). There are no ownerless rows: the server never
generates a snapshot, so ``owner_user_id`` is NOT NULL and the seed tier is a
read-time fallback to the shipped catalog rather than stored state.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_MODEL_SNAPSHOT_STATUS_ACTIVE,
    AGENT_MODEL_SNAPSHOT_STATUS_INACTIVE,
)
from proliferate.db.models.cloud.agent_gateway import AgentModelSnapshot
from proliferate.db.store.agent_gateway.mappers import model_snapshot_record
from proliferate.db.store.agent_gateway.records import AgentModelSnapshotRecord


async def create_model_snapshot(
    db: AsyncSession,
    *,
    harness_kind: str,
    auth_context_id: str,
    owner_user_id: UUID,
    snapshot_json: str,
    probed_at: datetime | None = None,
) -> AgentModelSnapshotRecord:
    """Insert a new active snapshot, retiring prior active rows for the scope.

    Deactivate-then-insert, and ``update`` rather than a single-row targeted
    write, because the scope carries no unique key (model-catalog.md §Storage
    keeps the soft-versioning discipline as-is): a racing pair of Worker upload
    ticks can leave two active rows, and the next write must collapse *all* of
    them rather than assume there was one.
    """
    await db.execute(
        update(AgentModelSnapshot)
        .where(
            AgentModelSnapshot.harness_kind == harness_kind,
            AgentModelSnapshot.auth_context_id == auth_context_id,
            AgentModelSnapshot.owner_user_id == owner_user_id,
            AgentModelSnapshot.status == AGENT_MODEL_SNAPSHOT_STATUS_ACTIVE,
        )
        .values(status=AGENT_MODEL_SNAPSHOT_STATUS_INACTIVE)
    )

    row = AgentModelSnapshot(
        harness_kind=harness_kind,
        auth_context_id=auth_context_id,
        owner_user_id=owner_user_id,
        snapshot_json=snapshot_json,
        status=AGENT_MODEL_SNAPSHOT_STATUS_ACTIVE,
    )
    if probed_at is not None:
        # The uploaded entry carries the timestamp of the probe itself, which ran
        # on the sandbox's runtime possibly many ticks before this upload landed.
        row.probed_at = probed_at
    db.add(row)
    await db.flush()
    return model_snapshot_record(row)


async def get_active_model_snapshot(
    db: AsyncSession,
    *,
    harness_kind: str,
    auth_context_id: str,
    owner_user_id: UUID,
) -> AgentModelSnapshotRecord | None:
    """The owner's current observation for the scope, or None when unobserved.

    None is the read-time seed condition: the caller falls back to the shipped
    catalog's models rather than to a stored seed row.

    ``id`` is a tie-break on ``probed_at``, and it is load-bearing rather than
    decorative: because the scope carries no unique key, two racing upload ticks
    can leave two active rows — and a Worker re-sending its last entry sends the
    SAME ``probedAt``, so the tie is the common case, not the exotic one. Ordering
    on the timestamp alone leaves the winner to physical row order, which
    Postgres is free to change under a HOT update or a VACUUM, so the served
    model list could flip without any write. The rows are equivalent when the
    entry really is identical, but "equivalent" is not "deterministic", and a
    picker that changes answers on its own is not debuggable.
    """
    query = (
        select(AgentModelSnapshot)
        .where(
            AgentModelSnapshot.harness_kind == harness_kind,
            AgentModelSnapshot.auth_context_id == auth_context_id,
            AgentModelSnapshot.owner_user_id == owner_user_id,
            AgentModelSnapshot.status == AGENT_MODEL_SNAPSHOT_STATUS_ACTIVE,
        )
        .order_by(AgentModelSnapshot.probed_at.desc(), AgentModelSnapshot.id.desc())
        .limit(1)
    )
    row = (await db.execute(query)).scalar_one_or_none()
    return model_snapshot_record(row) if row is not None else None
