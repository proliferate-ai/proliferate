"""Background enrollment backfill, usage-import, and top-up workers.

All are started from the app lifespan (mirroring the anonymous-telemetry
sender). The backfill worker first runs the D-3 legacy-enrollment migration
(re-parenting pre-org-only personal rows onto default orgs and re-minting
pre-D-2 shared-identity keys — a no-op once nothing is left), then retries
pending/failed enrollments and enrolls active org memberships whose enroll
hook was lost (org-only discovery), every
``agent_gateway_backfill_interval_seconds``. The usage-import worker pages
LiteLLM spend logs and enforces LLM-credit exhaustion every
``agent_gateway_usage_import_interval_seconds``. The top-up worker charges
overage-enabled subjects that dropped below the credit threshold every
``agent_gateway_topup_interval_seconds`` (and only when the LLM top-up price
is configured). All only run when the gateway is enabled.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import suppress
from uuid import UUID

from proliferate.config import settings
from proliferate.db import session_ops as db_session
from proliferate.integrations.sentry import report_critical
from proliferate.server.ai_gateway.enrollment import backfill_enrollments
from proliferate.server.ai_gateway.free_credits import (
    ZeroGrantCheckResult,
    run_zero_grant_check,
)
from proliferate.server.ai_gateway.migration import migrate_legacy_enrollments
from proliferate.server.ai_gateway.topups import (
    LlmTopupRunResult,
    run_llm_topups,
    topups_enabled,
)
from proliferate.server.ai_gateway.usage_import import (
    UsageImportResult,
    run_usage_import,
)
from proliferate.server.ai_gateway.verification import (
    VerificationResult,
    collect_verification_targets,
    probe_verification_targets,
    record_verification_verdicts,
)

logger = logging.getLogger(__name__)

_BACKFILL_BATCH_LIMIT = 50


async def run_enrollment_backfill_once(*, limit: int = _BACKFILL_BATCH_LIMIT) -> int:
    async with db_session.open_async_transaction() as db:
        # The D-3 migration runs ahead of the ordinary backfill: personal
        # residue converts to the org shape (so the sync pass below only ever
        # sees org rows) and pre-D-2 shared-identity org rows re-mint. Both
        # are idempotent and settle into a no-op once the backlog is drained.
        migrated = await migrate_legacy_enrollments(db, limit=limit)
        return migrated + await backfill_enrollments(db, limit=limit)


async def run_zero_grant_check_once(
    *,
    limit: int = _BACKFILL_BATCH_LIMIT,
    already_alerted_org_ids: set[UUID] | None = None,
) -> ZeroGrantCheckResult:
    # Deliberately its OWN transaction, never the backfill's: the backfill
    # tick's enrollment work has already committed by the time this runs, so
    # a throwing reclaim/heal can never roll it back.
    async with db_session.open_async_transaction() as db:
        return await run_zero_grant_check(
            db,
            limit=limit,
            already_alerted_org_ids=already_alerted_org_ids,
        )


async def _backfill_loop() -> None:
    # Zero-grant guard state, process-local: the cadence stamp and the set of
    # orgs already paged. A restart re-pages each still-broken org once —
    # accepted; paging state is not worth persisting.
    next_zero_grant_check = 0.0
    alerted_org_ids: set[UUID] = set()
    while True:
        try:
            processed = await run_enrollment_backfill_once()
            if processed:
                logger.info(
                    "Agent gateway enrollment backfill processed subjects",
                    extra={"processed": processed},
                )
            if time.monotonic() >= next_zero_grant_check:
                # The guard rides the backfill loop (the spec-shaped home) but
                # on its OWN cadence. Stamped BEFORE the run: a crashing check
                # retries hourly, never on every 300s backfill tick.
                next_zero_grant_check = (
                    time.monotonic() + settings.agent_gateway_zero_grant_check_interval_seconds
                )
                zero_grant = await run_zero_grant_check_once(
                    already_alerted_org_ids=alerted_org_ids
                )
                if zero_grant.checked:
                    logger.info(
                        "Agent gateway zero-grant check processed enrollments",
                        extra={
                            "checked": zero_grant.checked,
                            "healed": zero_grant.healed,
                            "alerted": zero_grant.alerted,
                        },
                    )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "enrollment_backfill"},
            )
        await asyncio.sleep(settings.agent_gateway_backfill_interval_seconds)


async def start_agent_gateway_enrollment_backfill() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled or not settings.run_background_workers:
        return None
    return asyncio.create_task(
        _backfill_loop(),
        name="agent-gateway-enrollment-backfill",
    )


async def stop_agent_gateway_enrollment_backfill(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def run_usage_import_once() -> UsageImportResult:
    async with db_session.open_async_transaction() as db:
        return await run_usage_import(db)


async def _usage_import_loop() -> None:
    while True:
        try:
            result = await run_usage_import_once()
            if result.imported or result.exhausted_subjects:
                logger.info(
                    "Agent gateway usage import processed spend",
                    extra={
                        "imported": result.imported,
                        "exhausted_subjects": result.exhausted_subjects,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "usage_import"},
            )
        await asyncio.sleep(settings.agent_gateway_usage_import_interval_seconds)


async def start_agent_gateway_usage_import() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled or not settings.run_background_workers:
        return None
    return asyncio.create_task(
        _usage_import_loop(),
        name="agent-gateway-usage-import",
    )


async def stop_agent_gateway_usage_import(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def run_verification_once() -> VerificationResult:
    # Three phases, two SHORT transactions: the LiteLLM probes in the middle
    # run with no transaction open, so an outage's worth of HTTP timeouts
    # (potentially many keys x the client timeout) never holds row locks.
    async with db_session.open_async_transaction() as db:
        targets = await collect_verification_targets(db)
    observations = await probe_verification_targets(targets)
    async with db_session.open_async_transaction() as db:
        return await record_verification_verdicts(db, observations)


async def _verification_loop() -> None:
    while True:
        try:
            result = await run_verification_once()
            if result.misconfigured or result.errored:
                logger.info(
                    "Agent gateway verification tick recorded verdicts",
                    extra={
                        "checked": result.checked,
                        "ok": result.ok,
                        "misconfigured": result.misconfigured,
                        "errored": result.errored,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "verification"},
            )
        await asyncio.sleep(settings.agent_gateway_verification_interval_seconds)


async def start_agent_gateway_verification() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled or not settings.run_background_workers:
        return None
    if not settings.agent_gateway_verification_enabled:
        return None
    return asyncio.create_task(
        _verification_loop(),
        name="agent-gateway-verification",
    )


async def stop_agent_gateway_verification(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def run_llm_topups_once() -> LlmTopupRunResult:
    async with db_session.open_async_transaction() as db:
        return await run_llm_topups(db)


async def _topup_loop() -> None:
    while True:
        try:
            result = await run_llm_topups_once()
            if result.topped_up or result.skipped:
                logger.info(
                    "Agent gateway LLM top-up tick processed subjects",
                    extra={
                        "eligible": result.eligible,
                        "topped_up": result.topped_up,
                        "skipped": result.skipped,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "llm_topup"},
            )
        await asyncio.sleep(settings.agent_gateway_topup_interval_seconds)


async def start_agent_gateway_llm_topups() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled or not topups_enabled():
        return None
    if not settings.run_background_workers:
        return None
    return asyncio.create_task(
        _topup_loop(),
        name="agent-gateway-llm-topups",
    )


async def stop_agent_gateway_llm_topups(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
