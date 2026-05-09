"""Claim lifecycle helpers for the cloud automation executor."""

from __future__ import annotations

import asyncio
import logging

from proliferate.db.store.automation_run_claim_transitions import (
    mark_run_failed,
)
from proliferate.db.store.automation_run_claim_values import (
    AutomationRunClaimValue,
)
from proliferate.db.store.automation_run_claims import (
    heartbeat_run_claim,
    load_current_run_claim,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ACTIVE_CLAIM_STATUSES,
    automation_error_message,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_executor_config import CloudExecutorConfig
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")


async def fail_claim(
    claim: AutomationRunClaimValue,
    *,
    code: str,
    message: str | None = None,
) -> None:
    failed = await mark_run_failed(
        run_id=claim.id,
        claim_id=claim.claim_id,
        error_code=code,
        message=(message or automation_error_message(code)),
        now=utcnow(),
        active_statuses=ACTIVE_CLAIM_STATUSES,
        claim_is_active=claim_is_active,
    )
    if not failed:
        logger.info(
            "automation cloud executor failed to mark run failed run_id=%s error_code=%s",
            claim.id,
            code,
        )


async def heartbeat_loop(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
    stop_event: asyncio.Event,
    stale_claim_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=config.heartbeat_interval_seconds)
            break
        except TimeoutError:
            pass
        try:
            refreshed = await heartbeat_run_claim(
                run_id=claim.id,
                claim_id=claim.claim_id,
                claim_ttl=config.claim_ttl,
                now=utcnow(),
                active_statuses=ACTIVE_CLAIM_STATUSES,
                claim_is_active=claim_is_active,
            )
        except Exception:
            logger.exception("automation cloud executor heartbeat failed run_id=%s", claim.id)
            continue
        if refreshed is None:
            stale_claim_event.set()
            logger.info("automation cloud executor claim lost run_id=%s", claim.id)
            return


async def require_current_claim(
    claim: AutomationRunClaimValue,
) -> AutomationRunClaimValue | None:
    current = await load_current_run_claim(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
        active_statuses=ACTIVE_CLAIM_STATUSES,
        claim_is_active=claim_is_active,
    )
    if current is None:
        logger.info("automation cloud executor claim is no longer current run_id=%s", claim.id)
    return current
