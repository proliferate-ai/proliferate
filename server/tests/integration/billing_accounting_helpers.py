from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.billing import UsageSegment
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject


def patch_global_session_factory(
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )


async def seed_usage_segment(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    hours: float,
    ended: bool = True,
) -> tuple[uuid.UUID, UsageSegment]:
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)
    # Usage accounting only reads usage_segment rows (workspace_id/sandbox_id
    # are plain UUID columns without foreign keys), so seed synthetic ids
    # instead of CloudWorkspace/CloudSandbox rows. The old workspace/sandbox
    # seeding relied on model fields removed by the #803/#809 cutover.
    segment = UsageSegment(
        user_id=user_id,
        billing_subject_id=subject.id,
        workspace_id=uuid.uuid4(),
        sandbox_id=uuid.uuid4(),
        external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        sandbox_execution_id=None,
        started_at=now - timedelta(hours=hours),
        ended_at=now if ended else None,
        is_billable=True,
        opened_by="provision",
        closed_by="manual_stop" if ended else None,
    )
    db_session.add(segment)
    await db_session.flush()
    return subject.id, segment
