from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject


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
    workspace = CloudWorkspace(
        user_id=user_id,
        billing_subject_id=subject.id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="main",
        git_base_branch="main",
        status="running" if not ended else "stopped",
        status_detail="Running" if not ended else "Stopped",
        last_error=None,
        template_version="v1",
        runtime_generation=1,
    )
    db_session.add(workspace)
    await db_session.flush()

    sandbox = CloudSandbox(
        cloud_workspace_id=workspace.id,
        provider="e2b",
        external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        status="running" if not ended else "paused",
        template_version="v1",
        started_at=now - timedelta(hours=hours),
        stopped_at=now if ended else None,
    )
    db_session.add(sandbox)
    await db_session.flush()

    segment = UsageSegment(
        user_id=user_id,
        billing_subject_id=subject.id,
        workspace_id=workspace.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=sandbox.external_sandbox_id,
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
