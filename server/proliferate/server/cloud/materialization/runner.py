"""In-process scheduling for cloud materialization work."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import async_session_factory
from proliferate.db.engine import run_after_commit as db_run_after_commit
from proliferate.integrations.sentry import report_critical
from proliferate.server.billing.authorization import CloudSandboxResumeBlockedError

logger = logging.getLogger("proliferate.cloud.materialization")


def _log_billing_block(exc: CloudSandboxResumeBlockedError, **context: object) -> None:
    """Log an expected billing quota denial without paging.

    A materialization task hitting the live billing gate is routine business
    logic (an out-of-credits owner), not a page-worthy failure, so we emit a
    structured info log with correlation context instead of report_critical
    (which is a pager duty — see CLAUDE.md logging rules).
    """
    logger.info(
        "cloud_materialization_billing_block",
        extra={
            "reason": exc.reason,
            "decision_type": exc.decision_type,
            "billing_subject_id": (
                str(exc.billing_subject_id) if exc.billing_subject_id is not None else None
            ),
            "user_id": str(exc.owner_user_id) if exc.owner_user_id is not None else None,
            "remaining_seconds": exc.remaining_seconds,
            **context,
        },
    )


async def run_after_commit(
    db: AsyncSession,
    *,
    label: str,
    task: Callable[[], Awaitable[None]],
) -> None:
    async def _run() -> None:
        try:
            await task()
        except CloudSandboxResumeBlockedError as exc:
            _log_billing_block(exc, label=label)
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "cloud_materialization", "label": label},
            )

    async def _callback() -> None:
        asyncio.create_task(_run())

    await db_run_after_commit(db, _callback)


def spawn_materialization_task(
    fn: Callable[..., Awaitable[None]],
    **kwargs: object,
) -> None:
    asyncio.create_task(_run_with_fresh_session(fn, kwargs))


async def _run_with_fresh_session(
    fn: Callable[..., Awaitable[None]],
    kwargs: Mapping[str, Any],
) -> None:
    async with async_session_factory() as db:
        try:
            await fn(db, **kwargs)
            await db.commit()
        except CloudSandboxResumeBlockedError as exc:
            await db.rollback()
            _log_billing_block(exc, fn=getattr(fn, "__name__", repr(fn)))
        except Exception as exc:
            await db.rollback()
            report_critical(
                exc,
                tags={
                    "domain": "cloud_materialization",
                    "fn": getattr(fn, "__name__", repr(fn)),
                },
            )
