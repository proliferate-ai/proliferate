"""Background reconciliation for LiteLLM agent-auth mirror state."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import suppress

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_agent_auth import store
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.cloud.agent_auth.service import (
    AgentGatewayReconcilePassResult,
    reconcile_agent_gateway_litellm_mirror,
    reconcile_agent_gateway_runtime_grant_freshness,
)
from proliferate.utils.time import duration_ms

logger = logging.getLogger("proliferate.cloud.agent_auth.reconciler")

_reconciler_task: asyncio.Task[None] | None = None


def start_agent_gateway_reconciler() -> None:
    global _reconciler_task
    if not settings.agent_gateway_enabled or not settings.agent_gateway_reconciler_enabled:
        return
    if _reconciler_task is not None and not _reconciler_task.done():
        return
    _reconciler_task = asyncio.create_task(
        _agent_gateway_reconciler_loop(),
        name="agent-gateway-litellm-reconciler",
    )


async def stop_agent_gateway_reconciler() -> None:
    global _reconciler_task
    if _reconciler_task is None:
        return
    _reconciler_task.cancel()
    with suppress(asyncio.CancelledError):
        await _reconciler_task
    _reconciler_task = None


async def run_agent_gateway_reconcile_pass() -> AgentGatewayReconcilePassResult:
    async with db_engine.async_session_factory() as db:
        acquired = await store.try_acquire_agent_gateway_reconciler_lock(db)
        if not acquired:
            logger.debug("agent gateway LiteLLM reconciler skipped; lock already owned")
            return _empty_result()
        try:
            result = await _run_reconcile_pass(db)
            await db.commit()
            return result
        finally:
            await store.release_agent_gateway_reconciler_lock(db)


async def _run_reconcile_pass(db: AsyncSession) -> AgentGatewayReconcilePassResult:
    started = time.perf_counter()
    result = await reconcile_agent_gateway_litellm_mirror(
        db,
        limit=settings.agent_gateway_reconciler_batch_size,
    )
    grant_result = await reconcile_agent_gateway_runtime_grant_freshness(
        db,
        limit=settings.agent_gateway_reconciler_batch_size,
    )
    logger.info(
        "agent gateway LiteLLM reconcile pass completed",
        extra={
            "event": "agent_gateway_litellm_reconcile",
            "budgets_checked": result.budgets_checked,
            "budgets_reconciled": result.budgets_reconciled,
            "budgets_failed": result.budgets_failed,
            "policies_checked": result.policies_checked,
            "policies_reconciled": result.policies_reconciled,
            "policies_failed": result.policies_failed,
            "runtime_grants_checked": grant_result.grants_checked,
            "runtime_grant_targets_refreshed": grant_result.targets_refreshed,
            "runtime_grants_skipped": grant_result.grants_skipped,
            "runtime_grants_failed": grant_result.grants_failed,
            "elapsed_ms": duration_ms(started),
        },
    )
    return result


async def _agent_gateway_reconciler_loop() -> None:
    while True:
        try:
            await run_agent_gateway_reconcile_pass()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            capture_server_sentry_exception(
                exc,
                tags={
                    "domain": "agent_auth",
                    "action": "litellm_reconcile_loop",
                },
            )
            logger.exception("agent gateway LiteLLM reconciler pass failed")
        await asyncio.sleep(max(settings.agent_gateway_reconciler_interval_seconds, 30.0))


def _empty_result() -> AgentGatewayReconcilePassResult:
    return AgentGatewayReconcilePassResult(
        budgets_checked=0,
        budgets_reconciled=0,
        budgets_failed=0,
        policies_checked=0,
        policies_reconciled=0,
        policies_failed=0,
    )
