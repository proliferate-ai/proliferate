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
    AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
    AGENT_USAGE_EVENT_STATUS_IMPORTED,
    AGENT_USAGE_EVENT_STATUS_NEEDS_REVIEW,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import billing as billing_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.agent_gateway import usage as llm_usage_store
from proliferate.db.store.billing_subjects import get_billing_subject_by_id
from proliferate.integrations import litellm
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMSpendLogEntry
from proliferate.server.billing.budget_limits import window_bounds
from proliferate.server.cloud.agent_gateway.topups import (
    reactivate_enrollment_if_credited,
    topups_enabled,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

_ZERO = Decimal("0")

# Keyset-pagination page size for the limit_reached sweep below.
_LIMIT_REACHED_SWEEP_PAGE_SIZE = 500


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

    Org-wide LLM cap enforcement runs twice: once for orgs with new spend this
    tick, and once as a sweep over every org still holding a ``limit_reached``
    member (regardless of new spend) so a cap raise/disable can re-enable a
    fully-disabled org even on a tick with zero imported rows.
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

    # Org budget-limit enforcement (spec §4.1): for every org touched this tick,
    # apply its enabled LLM caps to all member keys (org enrollments share the
    # org's billing subject).
    affected_orgs: dict[UUID, UUID] = {
        enrollment.organization_id: enrollment.billing_subject_id
        for enrollment in touched.values()
        if enrollment.organization_id is not None
    }
    for organization_id, subject_id in affected_orgs.items():
        await _enforce_org_llm_limits(
            db,
            organization_id=organization_id,
            billing_subject_id=subject_id,
            now=at,
        )

    # Sweep every org still holding a ``limit_reached`` member, regardless of
    # whether it had new spend this tick. An org-wide cap that disables every
    # member key stops the org from producing any new spend at all, so
    # ``affected_orgs`` above would never see it again — a later cap raise or
    # limit-disable must still be able to clear ``limit_reached`` on a
    # zero-new-spend tick.
    after: UUID | None = None
    while True:
        page = await agent_gateway_store.list_organizations_with_limit_reached_enrollments(
            db,
            limit=_LIMIT_REACHED_SWEEP_PAGE_SIZE,
            after=after,
        )
        if not page:
            break
        for organization_id, subject_id in page:
            if organization_id not in affected_orgs:
                await _enforce_org_llm_limits(
                    db,
                    organization_id=organization_id,
                    billing_subject_id=subject_id,
                    now=at,
                )
        if len(page) < _LIMIT_REACHED_SWEEP_PAGE_SIZE:
            break
        after = page[-1][0]

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


async def _enforce_org_llm_limits(
    db: AsyncSession,
    *,
    organization_id: UUID,
    billing_subject_id: UUID,
    now: datetime,
) -> None:
    """Apply the org's enabled LLM budget caps to its member virtual keys.

    Every enabled limit row is checked independently (spec: ``BillingBudgetLimit``
    docstring — "both can coexist; enforcement checks both"): a per-user row is
    compared against that member's own window spend, an org-wide row against the
    whole subject's window spend. A member is over cap if ANY applicable limit
    breaches — not just the raw-tightest one, since caps on different windows
    (e.g. a per-user $5/day cap and an org-wide $100/month cap) aren't
    comparable by raw value. Over cap disables the key and sets
    ``budget_status='limit_reached'`` (only from ``ok`` — never overriding
    ``exhausted``); back under cap with positive credit re-enables it.
    """
    limits = await billing_store.list_budget_limits(db, organization_id)
    enabled_llm_limits = [
        limit for limit in limits if limit.kind == "llm" and limit.enabled
    ]
    enrollments = await agent_gateway_store.list_active_enrollments_for_subject(
        db,
        billing_subject_id=billing_subject_id,
    )
    if not enrollments:
        return

    spend_cache: dict[tuple[str, UUID | None], float] = {}

    async def _window_spend(window: str, scope_user_id: UUID | None) -> float:
        key = (window, scope_user_id)
        if key not in spend_cache:
            start, end = window_bounds(window, now)
            spend_cache[key] = await llm_usage_store.llm_cost_usd_in_window(
                db,
                billing_subject_id=billing_subject_id,
                start=start,
                end=end,
                user_id=scope_user_id,
            )
        return spend_cache[key]

    for enrollment in enrollments:
        if enrollment.user_id is None:
            continue
        over_cap = False
        for limit in enabled_llm_limits:
            if limit.user_id is not None and limit.user_id != enrollment.user_id:
                continue
            scope_user_id = enrollment.user_id if limit.user_id is not None else None
            used = await _window_spend(limit.window, scope_user_id)
            if used >= float(limit.cap_value):
                over_cap = True
                break

        if over_cap:
            await _apply_llm_limit_reached(db, enrollment)
        elif enrollment.budget_status == AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED:
            await reactivate_enrollment_if_credited(
                db,
                billing_subject_id,
                enrollment,
                now=now,
            )


async def _apply_llm_limit_reached(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
) -> None:
    """Disable a member's key and flip it to ``limit_reached`` (idempotent).

    Skips enrollments already ``limit_reached`` or ``exhausted`` — credit
    exhaustion is the stronger signal and is cleared by top-up reactivation.
    """
    if enrollment.budget_status in (
        AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
        AGENT_GATEWAY_BUDGET_STATUS_EXHAUSTED,
    ):
        return
    if enrollment.virtual_key_id:
        try:
            await litellm.disable_virtual_key(key_or_token_id=enrollment.virtual_key_id)
        except LiteLLMIntegrationError as error:
            logger.warning(
                "Failed to disable virtual key at budget limit",
                extra={
                    "enrollment_id": str(enrollment.id),
                    "error_code": error.code,
                },
            )
            return
    await agent_gateway_store.set_enrollment_budget_status(
        db,
        enrollment_id=enrollment.id,
        budget_status=AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
    )


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
