"""Cloud automation executor."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from proliferate.constants.automations import (
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
)
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_agent_run_config as run_config_store
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.automations.domain.claim_lifecycle import (
    ACTIVE_CLAIM_STATUSES,
    RECLAIMABLE_STATUSES,
    unconfigured_agent_failure,
)
from proliferate.server.automations.worker.claim_transactions import (
    claim_cloud_automation_run,
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
)
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.utils.time import utcnow


def _claim_correlation_fields(claim: AutomationRunClaimValue) -> dict[str, object | None]:
    """Correlation identity for a single automation run's unit of work."""
    return {
        "organization_id": claim.organization_id,
        "user_id": claim.user_id,
        "session_id": claim.anyharness_session_id,
        "sandbox_profile_id": claim.sandbox_profile_id,
        "cloud_workspace_id": claim.cloud_workspace_id,
        "cloud_target_id": claim.cloud_target_id_snapshot,
        "anyharness_workspace_id": claim.anyharness_workspace_id,
    }

logger = logging.getLogger(__name__)


class CloudAutomationRunBusy(Exception):
    def __init__(self, *, retry_after_seconds: float) -> None:
        super().__init__("Automation run is already claimed.")
        self.retry_after_seconds = retry_after_seconds


__all__ = [
    "CloudExecutorConfig",
    "CloudAutomationRunBusy",
    "build_cloud_executor_config",
    "execute_cloud_automation_run",
    "process_cloud_automation_run",
]


async def execute_cloud_automation_run(
    run_id: UUID,
    *,
    config: CloudExecutorConfig | None = None,
) -> bool:
    resolved = config or build_cloud_executor_config()
    attempt = await claim_cloud_automation_run(
        run_id=run_id,
        executor_id=resolved.executor_id,
        claim_ttl=resolved.claim_ttl,
        now=utcnow(),
        reclaimable_statuses=RECLAIMABLE_STATUSES,
        active_statuses=ACTIVE_CLAIM_STATUSES,
        unconfigured_agent_failure=unconfigured_agent_failure(),
    )
    claim = attempt.claim
    if claim is None:
        if attempt.retry_after_seconds is not None:
            raise CloudAutomationRunBusy(
                retry_after_seconds=attempt.retry_after_seconds,
            )
        logger.info("automation cloud executor run not claimable run_id=%s", run_id)
        return False
    with with_correlation_context(**_claim_correlation_fields(claim)):
        await process_cloud_automation_run(claim, config=resolved)
    return True


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
