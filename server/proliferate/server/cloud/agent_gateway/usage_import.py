"""LiteLLM spend-log importer + LLM-credit exhaustion enforcement (PR 8).

The importer pages LiteLLM ``/spend/logs`` with an overlap window, resolves
each row's virtual key back to a Proliferate enrollment (and thus a billing
subject), and writes a deduped ``agent_llm_usage_event`` ledger row — the debit
side of the LLM credit ledger (spec section 7). After importing, every affected
billing subject is reconciled: when its remaining credit reaches zero the
enrollment's LiteLLM virtual key is disabled and its ``budget_status`` is
flipped to ``exhausted`` so gateway-route launches can fail closed.

LiteLLM's ``/spend/logs`` only accepts ``YYYY-MM-DD`` date bounds, parsed at
midnight: ``end_date`` matches ``startTime <= end_date 00:00:00``, so a bare
``now.date()`` would exclude every row logged so far *today*. The cursor is
stored at full timestamp precision but the poll window is widened to whole
days, and ``end_date`` is pushed to ``now + 1 day`` so same-day spend is
covered. The overlap window re-reads recent rows every tick;
``insert_usage_event_once`` dedupes on ``litellm_request_id`` so overlapping
windows never double-count.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED,
    AGENT_USAGE_EVENT_STATUS_IMPORTED,
    AGENT_USAGE_EVENT_STATUS_NEEDS_REVIEW,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import get_billing_subject_by_id
from proliferate.integrations import litellm
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMSpendLogEntry
from proliferate.server.cloud.agent_gateway.topups import topups_enabled
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

_ZERO = Decimal("0")


@dataclass(frozen=True)
class UsageImportResult:
    """Summary of one importer tick, returned for logging/tests."""

    imported: int
    skipped_duplicate: int
    unresolved: int
    exhausted_subjects: int
    max_occurred_at: datetime | None


def _overlap_window_start(
    last_seen: datetime | None,
    *,
    overlap_seconds: float,
    now: datetime,
) -> datetime:
    """Start of the poll window: ``last_seen - overlap`` (clamped to <= now).

    With no cursor yet we look back one overlap window from now — the first
    tick after enablement still catches very recent spend without paging all
    of history.
    """
    anchor = last_seen if last_seen is not None else now
    start = anchor - timedelta(seconds=max(overlap_seconds, 0.0))
    return min(start, now)


def _parse_occurred_at(entry: LiteLLMSpendLogEntry) -> datetime | None:
    """LiteLLM spend timestamps are ISO strings; prefer end, fall back to start."""
    for raw in (entry.end_time, entry.start_time):
        if not raw:
            continue
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    return None


def _metadata_str(entry: LiteLLMSpendLogEntry, key: str) -> str | None:
    raw = entry.metadata.get(key)
    return raw if isinstance(raw, str) and raw else None


async def run_usage_import(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> UsageImportResult:
    """Import LiteLLM spend logs since the cursor and enforce credit exhaustion.

    Idempotent across overlapping windows: dedupe is on ``litellm_request_id``.
    The cursor advances to the max ``occurred_at`` seen so the next tick starts
    from there (minus the overlap). Rows whose virtual key cannot be resolved
    to an enrollment are still recorded (with null subject links and a
    ``needs_review`` status) so spend is never silently dropped.
    """
    at = now or utcnow()
    cursor = await agent_gateway_store.get_usage_import_cursor(db)
    last_seen = cursor.last_seen_occurred_at if cursor is not None else None
    window_start = _overlap_window_start(
        last_seen,
        overlap_seconds=settings.agent_gateway_usage_import_overlap_seconds,
        now=at,
    )

    try:
        entries = await litellm.page_spend_logs(
            start_date=window_start.date().isoformat(),
            # LiteLLM bounds end_date at midnight, so today's spend is only
            # included once end_date is at least tomorrow's date.
            end_date=(at + timedelta(days=1)).date().isoformat(),
        )
    except LiteLLMIntegrationError as error:
        logger.warning(
            "LiteLLM spend-log poll failed",
            extra={"error_code": error.code},
        )
        await agent_gateway_store.advance_usage_import_cursor(
            db,
            last_seen_occurred_at=None,
            status="error",
            last_error_code=error.code,
            last_error_message=error.message,
        )
        return UsageImportResult(0, 0, 0, 0, last_seen)

    imported = 0
    skipped = 0
    unresolved = 0
    max_occurred_at = last_seen
    # Enrollments touched this tick; reconciled once at the end.
    touched: dict[UUID, AgentGatewayEnrollmentRecord] = {}
    touched_subjects: set[UUID] = set()

    for entry in entries:
        if not entry.request_id:
            continue
        occurred_at = _parse_occurred_at(entry)
        if occurred_at is None:
            occurred_at = at

        enrollment: AgentGatewayEnrollmentRecord | None = None
        if entry.api_key:
            enrollment = await agent_gateway_store.get_enrollment_by_virtual_key_id(
                db,
                virtual_key_id=entry.api_key,
            )

        user_id: UUID | None = None
        organization_id: UUID | None = None
        billing_subject_id: UUID | None = None
        status = AGENT_USAGE_EVENT_STATUS_IMPORTED
        if enrollment is not None:
            user_id = enrollment.user_id
            organization_id = enrollment.organization_id
            billing_subject_id = enrollment.billing_subject_id
        else:
            # Unresolved key: the virtual key is not (or no longer) in our
            # enrollment table. LiteLLM spend logs do not echo a key's mint-time
            # metadata at the top level, so there is nothing to fall back to —
            # record the row for manual review rather than silently dropping it.
            status = AGENT_USAGE_EVENT_STATUS_NEEDS_REVIEW
            unresolved += 1
            logger.warning(
                "LiteLLM spend row has an unresolved virtual key",
                extra={
                    "litellm_request_id": entry.request_id,
                    "api_key_hint": entry.api_key[:12] if entry.api_key else None,
                },
            )

        was_inserted = await agent_gateway_store.insert_usage_event_once(
            db,
            litellm_request_id=entry.request_id,
            occurred_at=occurred_at,
            virtual_key_id=entry.api_key or None,
            litellm_team_id=entry.team_id,
            user_id=user_id,
            organization_id=organization_id,
            billing_subject_id=billing_subject_id,
            model=entry.model or None,
            prompt_tokens=entry.prompt_tokens,
            completion_tokens=entry.completion_tokens,
            total_tokens=entry.total_tokens,
            cost_usd=entry.spend,
            status=status,
            workspace_id=_metadata_str(entry, "proliferate_workspace_id"),
            session_id=_metadata_str(entry, "proliferate_session_id"),
            raw_metadata_json=json.dumps(entry.metadata) if entry.metadata else None,
        )
        if was_inserted:
            imported += 1
        else:
            skipped += 1

        if max_occurred_at is None or occurred_at > max_occurred_at:
            max_occurred_at = occurred_at
        if enrollment is not None and billing_subject_id is not None:
            touched[enrollment.id] = enrollment
            touched_subjects.add(billing_subject_id)

    exhausted = 0
    for subject_id in touched_subjects:
        subject_enrollments = [e for e in touched.values() if e.billing_subject_id == subject_id]
        if await _enforce_subject_exhaustion(db, subject_id, subject_enrollments, now=at):
            exhausted += len(subject_enrollments)

    await agent_gateway_store.advance_usage_import_cursor(
        db,
        last_seen_occurred_at=max_occurred_at,
        status="idle",
    )

    logger.info(
        "LiteLLM usage import tick complete",
        extra={
            "imported": imported,
            "skipped_duplicate": skipped,
            "unresolved": unresolved,
            "exhausted": exhausted,
        },
    )
    return UsageImportResult(
        imported=imported,
        skipped_duplicate=skipped,
        unresolved=unresolved,
        exhausted_subjects=exhausted,
        max_occurred_at=max_occurred_at,
    )


async def _enforce_subject_exhaustion(
    db: AsyncSession,
    billing_subject_id: UUID,
    enrollments: list[AgentGatewayEnrollmentRecord],
    *,
    now: datetime,
) -> bool:
    """Disable virtual keys + flip budget_status when a subject is out of credit.

    Only subjects that actually hold a credit grant are enforced: with no grant
    at all, the LiteLLM default budget is the guardrail (see enrollment sync),
    and a zero-grant subject would otherwise be permanently "exhausted".
    Overage-enabled subjects are exempt while auto top-ups are configured —
    the top-up worker funds them back above zero instead of the key
    bouncing disabled/enabled between ticks. Reactivation on top-up lives in
    ``topups.reactivate_subject_if_credited``; this only ever tightens.
    """
    balance = await agent_gateway_store.get_remaining_credit_usd(
        db,
        billing_subject_id,
        now=now,
    )
    if balance.granted_usd <= _ZERO or balance.remaining_usd > _ZERO:
        return False
    if topups_enabled():
        subject = await get_billing_subject_by_id(db, billing_subject_id)
        if subject is not None and subject.overage_enabled:
            return False

    enforced = False
    for enrollment in enrollments:
        if enrollment.budget_status == AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED:
            continue
        if enrollment.virtual_key_id:
            try:
                await litellm.disable_virtual_key(key_or_token_id=enrollment.virtual_key_id)
            except LiteLLMIntegrationError as error:
                logger.warning(
                    "Failed to disable exhausted virtual key",
                    extra={
                        "enrollment_id": str(enrollment.id),
                        "error_code": error.code,
                    },
                )
                continue
        await agent_gateway_store.set_enrollment_budget_status(
            db,
            enrollment_id=enrollment.id,
            budget_status=AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED,
        )
        enforced = True
    return enforced


async def is_gateway_budget_available(db: AsyncSession, user_id: UUID) -> bool:
    """Whether a user may launch a gateway-route session (later launch-gating).

    True when the gateway is disabled (LiteLLM budgets are the only guardrail),
    or the user has no credit grant (default-budget subjects are never blocked
    on the ledger), or their remaining LLM credit is above zero. False only when
    a granted subject has spent its credit — the exhaustion signal PR 4's
    capabilities endpoint will consume.
    """
    if not settings.agent_gateway_enabled:
        return True
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    if enrollment is None:
        return True
    balance = await agent_gateway_store.get_remaining_credit_usd(
        db,
        enrollment.billing_subject_id,
    )
    if balance.granted_usd <= _ZERO:
        return True
    return balance.remaining_usd > _ZERO
