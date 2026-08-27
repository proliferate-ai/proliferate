"""Seat usage-probe sample persistence (agent_auth spec §2, flow 5).

**Advisory only, never a launch gate.** The only legitimate importers of this
module are flow 5's usage probe (the writer, ``server/agent_auth/seats.py``)
and the ``GET /seats/usage`` read behind the settings meters — an import-scan
test (``tests/unit/test_agent_seat_usage_probe.py``) enforces that no
launch/render-path module ever reads samples, so the constraint survives
refactors. Samples never carry credential material.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
    AGENT_API_KEY_STATUS_ACTIVE,
)
from proliferate.db.models.agent_gateway import AgentApiKey, SeatUsageSample
from proliferate.db.store.agent_gateway.mappers import seat_usage_sample_record
from proliferate.db.store.agent_gateway.records import SeatUsageSampleRecord
from proliferate.lib.infra.time.wall_clock import utcnow


async def insert_seat_usage_sample(
    db: AsyncSession,
    *,
    api_key_id: UUID,
    status: str,
    sampled_at: datetime | None = None,
    util_5h: float | None = None,
    util_7d: float | None = None,
    reset_5h: datetime | None = None,
    reset_7d: datetime | None = None,
    binding_window: str | None = None,
) -> SeatUsageSampleRecord:
    row = SeatUsageSample(
        api_key_id=api_key_id,
        sampled_at=sampled_at if sampled_at is not None else utcnow(),
        util_5h=util_5h,
        util_7d=util_7d,
        reset_5h=reset_5h,
        reset_7d=reset_7d,
        binding_window=binding_window,
        status=status,
    )
    db.add(row)
    await db.flush()
    return seat_usage_sample_record(row)


async def latest_seat_usage_samples(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[SeatUsageSampleRecord]:
    """The meters read: the latest sample per ACTIVE seat, in vault order.

    Seats with no sample yet simply have no row here — the pane renders the
    honest "no usage data yet" state from their absence.
    """
    seat_ids = list(
        (
            await db.execute(
                select(AgentApiKey.id)
                .where(
                    AgentApiKey.user_id == user_id,
                    AgentApiKey.status == AGENT_API_KEY_STATUS_ACTIVE,
                    AgentApiKey.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
                )
                .order_by(AgentApiKey.created_at, AgentApiKey.id)
            )
        )
        .scalars()
        .all()
    )
    if not seat_ids:
        return []
    ranked = (
        select(
            SeatUsageSample,
            func.row_number()
            .over(
                partition_by=SeatUsageSample.api_key_id,
                order_by=(SeatUsageSample.sampled_at.desc(), SeatUsageSample.id.desc()),
            )
            .label("recency_rank"),
        )
        .where(SeatUsageSample.api_key_id.in_(seat_ids))
        .subquery()
    )
    sample = aliased(SeatUsageSample, ranked)
    rows = (
        (await db.execute(select(sample).where(ranked.c.recency_rank == 1)))
        .scalars()
        .all()
    )
    by_seat = {row.api_key_id: row for row in rows}
    return [
        seat_usage_sample_record(by_seat[seat_id])
        for seat_id in seat_ids
        if seat_id in by_seat
    ]


async def recent_seat_usage_samples(
    db: AsyncSession,
    *,
    api_key_id: UUID,
    limit: int = 8,
) -> list[SeatUsageSampleRecord]:
    """One seat's newest samples, newest first — the cadence engine's input."""
    rows = (
        (
            await db.execute(
                select(SeatUsageSample)
                .where(SeatUsageSample.api_key_id == api_key_id)
                .order_by(SeatUsageSample.sampled_at.desc(), SeatUsageSample.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [seat_usage_sample_record(row) for row in rows]


async def prune_seat_usage_samples(
    db: AsyncSession,
    *,
    older_than: datetime,
) -> int:
    """Delete samples older than the retention horizon (the writer's pass)."""
    result = await db.execute(
        delete(SeatUsageSample).where(SeatUsageSample.sampled_at < older_than)
    )
    # Result[Any] does not surface rowcount in the stubs; the DELETE's cursor
    # result always carries one.
    return int(getattr(result, "rowcount", 0) or 0)
