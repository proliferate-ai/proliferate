"""Fire-and-forget agent gateway enrollment scheduling for signup flows.

Mirrors the Customer.io desktop-auth scheduler: auth flows call the
``schedule_*`` functions synchronously; enrollment runs on its own task with
its own DB transaction so login latency and login success never depend on
LiteLLM.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops as db_session
from proliferate.server.cloud.agent_gateway.enrollment import (
    ensure_org_enrollment,
    ensure_user_enrollment,
)

logger = logging.getLogger(__name__)

type AfterCommit = Callable[[], Coroutine[None, None, None]]


async def _enroll_user(user_id: UUID) -> None:
    async with db_session.open_async_transaction() as db:
        await ensure_user_enrollment(db, user_id)


async def _enroll_organization(organization_id: UUID, user_id: UUID) -> None:
    async with db_session.open_async_transaction() as db:
        await ensure_org_enrollment(db, organization_id, user_id)


def _handle_enrollment_task_completion(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    logger.exception(
        "Agent gateway enrollment task failed unexpectedly",
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def _spawn(coro_name: str, coro: Coroutine[None, None, None]) -> None:
    try:
        task = asyncio.create_task(coro, name=coro_name)
    except Exception:
        coro.close()
        logger.exception("Could not schedule agent gateway enrollment task")
        return
    task.add_done_callback(_handle_enrollment_task_completion)


def _defer_or_skip(db: AsyncSession, name: str, spawn_after_commit: AfterCommit) -> None:
    """Best-effort deferral; enrollment must never break an auth flow.

    When deferral is impossible (e.g. a stubbed session in tests), skip —
    the backfill worker enrolls any subject the hooks missed.
    """
    try:
        db_session.defer_after_commit(db, spawn_after_commit)
    except Exception:
        logger.warning(
            "Could not defer agent gateway enrollment scheduling; backfill will cover it",
            extra={"task_name": name},
        )


def schedule_agent_gateway_user_enrollment(
    user_id: UUID,
    *,
    db: AsyncSession | None = None,
) -> None:
    """Schedule enrollment for a user.

    Passing the request ``db`` defers scheduling until after its transaction
    commits so the enrollment task (own session) can see a freshly created
    user row; rows that never commit never enroll. Without a ``db`` the task
    starts immediately (customerio-scheduler pattern).
    """
    name = f"agent-gateway-enroll-user-{user_id}"
    if db is None:
        _spawn(name, _enroll_user(user_id))
        return

    async def _spawn_after_commit() -> None:
        _spawn(name, _enroll_user(user_id))

    _defer_or_skip(db, name, _spawn_after_commit)


def schedule_agent_gateway_org_enrollment(
    organization_id: UUID,
    user_id: UUID,
    *,
    db: AsyncSession | None = None,
) -> None:
    """Schedule org enrollment for a single member (one virtual key per member)."""
    name = f"agent-gateway-enroll-org-{organization_id}-user-{user_id}"
    if db is None:
        _spawn(name, _enroll_organization(organization_id, user_id))
        return

    async def _spawn_after_commit() -> None:
        _spawn(name, _enroll_organization(organization_id, user_id))

    _defer_or_skip(db, name, _spawn_after_commit)
