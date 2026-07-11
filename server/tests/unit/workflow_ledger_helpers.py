"""Shared row factories for the WS2a workflow-ledger skeleton tests."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workflows import (
    Workflow,
    WorkflowRun,
    WorkflowTrigger,
    WorkflowVersion,
)
from proliferate.utils.time import utcnow


async def make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"ledger-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def make_run(db: AsyncSession, user: User) -> WorkflowRun:
    now = utcnow()
    workflow = Workflow(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="ledger-skeleton",
        created_at=now,
        updated_at=now,
    )
    db.add(workflow)
    await db.flush()
    version = WorkflowVersion(
        id=uuid.uuid4(),
        workflow_id=workflow.id,
        version_n=1,
        definition_json={"version": 1},
        created_by_user_id=user.id,
        created_at=now,
    )
    db.add(version)
    await db.flush()
    run = WorkflowRun(
        id=uuid.uuid4(),
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={},
        status="pending_delivery",
        created_at=now,
        updated_at=now,
    )
    db.add(run)
    await db.flush()
    return run


async def make_poll_trigger(
    db: AsyncSession, user: User, workflow_id: uuid.UUID
) -> WorkflowTrigger:
    now = utcnow()
    trigger = WorkflowTrigger(
        id=uuid.uuid4(),
        workflow_id=workflow_id,
        kind="poll",
        enabled=True,
        concurrency_policy="skip",
        target_mode="local",
        repo_full_name="acme/widgets",
        poll_url="https://example.invalid/poll",
        poll_interval_secs=300,
        args_json={},
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(trigger)
    await db.flush()
    return trigger
