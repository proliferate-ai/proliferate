"""Shared factories for workflow action and notification tests."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.utils.time import utcnow


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-fx-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _make_run_record(
    *,
    run_id: uuid.UUID | None = None,
    executor_user_id: uuid.UUID | None = None,
    step_outputs_json: dict | None = None,
    resolved_plan_json: dict | None = None,
) -> WorkflowRunRecord:
    now = utcnow()
    return WorkflowRunRecord(
        id=run_id or uuid.uuid4(),
        workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(),
        trigger_kind="manual",
        trigger_id=None,
        scheduled_for=None,
        executor_user_id=executor_user_id or uuid.uuid4(),
        args_json={},
        target_mode="local",
        resolved_plan_json=resolved_plan_json or {},
        status="completed",
        step_cursor=1,
        step_outputs_json=step_outputs_json,
        anyharness_workspace_id=None,
        anyharness_session_ids=None,
        error_code=None,
        error_message=None,
        cost_usd=None,
        cost_tokens=None,
        created_at=now,
        updated_at=now,
        delivered_at=None,
        started_at=now,
        finished_at=now,
    )


async def _make_sweep_run(db_session: AsyncSession, *, name: str) -> uuid.UUID:
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=name,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run_id = uuid.uuid4()
    run_row = WorkflowRun(
        id=run_id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={
            "steps": [{"kind": "notify", "message": "s", "slack_channel_id": "C1", "key": "0.-.0"}]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "s"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()
    return run_id
