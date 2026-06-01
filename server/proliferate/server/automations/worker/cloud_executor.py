"""Cloud automation executor."""

from __future__ import annotations

import asyncio
import logging

from proliferate.constants.automations import (
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
)
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_agent_run_config as run_config_store
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.server.automations.domain.claim_lifecycle import (
    RECLAIMABLE_STATUSES,
    unconfigured_agent_failure,
)
from proliferate.server.automations.worker.claim_transactions import (
    claim_cloud_automation_runs,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_execution.pipeline import (
    run_automation_pipeline,
)
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    heartbeat_loop,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    CloudExecutorConfig,
    build_cloud_executor_config,
    default_cloud_executor_config,
)
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

__all__ = [
    "CloudExecutorConfig",
    "build_cloud_executor_config",
    "process_cloud_automation_run",
    "run_cloud_executor_loop",
]


async def process_cloud_automation_run(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> None:
    heartbeat_stop = asyncio.Event()
    stale_claim = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        heartbeat_loop(
            claim,
            config=config,
            stop_event=heartbeat_stop,
            stale_claim_event=stale_claim,
        )
    )
    try:
        if claim.agent_kind is None:
            await fail_claim(claim, code="agent_not_configured")
            return
        if claim.agent_kind not in SUPPORTED_CLOUD_AGENTS:
            await fail_claim(claim, code="agent_not_ready")
            return
        if not await _claim_run_config_is_current(claim):
            return

        await run_automation_pipeline(
            AutomationExecutionContext(claim=claim),
            config=config,
            stale_claim_event=stale_claim,
        )
    except Exception:
        logger.exception("automation cloud executor run failed unexpectedly run_id=%s", claim.id)
        await fail_claim(claim, code="unexpected_executor_error")
    finally:
        heartbeat_stop.set()
        try:
            await asyncio.wait_for(heartbeat_task, timeout=2.0)
        except TimeoutError:
            heartbeat_task.cancel()
        except Exception:
            logger.exception(
                "automation cloud executor heartbeat cleanup failed run_id=%s",
                claim.id,
            )


async def _claim_run_config_is_current(claim: AutomationRunClaimValue) -> bool:
    config_id = claim.cloud_agent_run_config_id_snapshot
    if config_id is None:
        await fail_claim(claim, code="agent_run_config_not_found")
        return False
    async with db_engine.async_session_factory() as db:
        config = await run_config_store.get_config(db, config_id)
    if config is None:
        await fail_claim(claim, code="agent_run_config_not_found")
        return False
    issue = validate_config_execution_scope(
        config,
        actor_user_id=claim.user_id,
        owner_scope=claim.owner_scope,
        organization_id=claim.organization_id,
        usable_in=(
            "shared_sandboxes"
            if claim.target_mode == AUTOMATION_TARGET_MODE_SHARED_CLOUD
            else "personal_sandboxes"
        ),
    )
    if issue is not None:
        await fail_claim(claim, code=issue.code)
        return False
    return True


async def run_cloud_executor_loop(
    *,
    config: CloudExecutorConfig | None = None,
    stop_event: asyncio.Event | None = None,
) -> None:
    resolved = config or default_cloud_executor_config()
    stop_event = stop_event or asyncio.Event()
    logger.info(
        "Automation cloud executor started executor_id=%s concurrency=%s",
        resolved.executor_id,
        resolved.concurrency,
    )
    tasks: set[asyncio.Task[None]] = set()
    while not stop_event.is_set():
        done = {task for task in tasks if task.done()}
        for task in done:
            tasks.remove(task)
            try:
                task.result()
            except Exception:
                logger.exception("automation cloud executor task crashed")

        try:
            available = max(0, resolved.concurrency - len(tasks))
            if available:
                claims = await claim_cloud_automation_runs(
                    executor_id=resolved.executor_id,
                    claim_ttl=resolved.claim_ttl,
                    limit=available,
                    now=utcnow(),
                    reclaimable_statuses=RECLAIMABLE_STATUSES,
                    unconfigured_agent_failure=unconfigured_agent_failure(),
                )
                for claim in claims:
                    tasks.add(
                        asyncio.create_task(process_cloud_automation_run(claim, config=resolved))
                    )
        except Exception:
            logger.exception("automation cloud executor claim loop failed")

        timeout = resolved.poll_interval_seconds if not tasks else 1.0
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=timeout)
        except TimeoutError:
            continue

    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("Automation cloud executor stopped executor_id=%s", resolved.executor_id)
