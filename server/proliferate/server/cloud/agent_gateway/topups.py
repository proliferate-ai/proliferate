"""LLM credit top-ups + budget reactivation (spec section 7, PR 9).

Overage-enabled billing subjects whose remaining LLM credit drops below
``agent_gateway_topup_threshold_usd`` are auto-charged one
``agent_gateway_llm_topup_price_id`` unit through Stripe (invoice item →
invoice → finalize, the one-off charge counterpart of the compute-overage
meter-event pattern; the LLM price is distinct from the compute meter/price
ids). The charge lands as a ``topup`` credit grant, and any enrollment the
grant pushes back above zero remaining is reactivated: virtual key
unblocked (re-minted when unblock is unsupported), ``budget_status`` back
to ``ok``, and the LiteLLM team/key budget raised to the new allowance.

Idempotency has two interlocking layers:

* the Stripe idempotency key is derived from the subject's *top-up epoch*
  (its count of existing top-up grants), so a tick that crashed between
  charging and granting replays into the same Stripe invoice; and
* the grant's ``source_ref`` is the resulting invoice id, so the ledger
  insert itself dedupes.

The whole feature is off until ``agent_gateway_llm_topup_price_id`` is set
(empty default). Payment collection is asynchronous on Stripe's side
(``charge_automatically`` + ``auto_advance``); like compute overage, credit
is extended when the invoice is finalized, and failed payments surface
through Stripe dunning rather than clawing back the grant.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_BUDGET_STATUS_OK,
    LLM_CREDIT_SOURCE_TOPUP,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.agent_gateway.records import LlmCreditGrantRecord
from proliferate.db.store.billing_subjects import get_billing_subject_by_id
from proliferate.integrations import litellm
from proliferate.integrations import stripe as stripe_billing
from proliferate.integrations.litellm import LiteLLMIntegrationError
from proliferate.integrations.stripe import StripeIntegrationError
from proliferate.server.cloud.agent_gateway.enrollment import (
    enrollment_key_alias,
    enrollment_key_metadata,
    enrollment_subject_label,
)

logger = logging.getLogger(__name__)

_ZERO = Decimal("0")

LLM_TOPUP_PURPOSE = "llm_topup"

# Keyset-pagination page size for scanning subjects with active enrollments.
_SUBJECT_SCAN_PAGE_SIZE = 500


@dataclass(frozen=True)
class LlmTopupRunResult:
    """Summary of one top-up worker tick, returned for logging/tests."""

    scanned: int
    eligible: int
    topped_up: int
    skipped: int


def topups_enabled() -> bool:
    """Whether auto top-ups can actually fund an overage subject.

    Requires both the LLM top-up Stripe price *and* a valid positive top-up
    amount. A misconfigured amount (0 / unparsable) must fail safe: the
    importer keys its overage-exemption on this predicate, so if top-ups can't
    fund a subject we must keep enforcing (disable the key) rather than
    silently leave overage subjects uncapped and unbilled.
    """
    if not settings.agent_gateway_llm_topup_price_id:
        return False
    return topup_amount_usd() > _ZERO


def _decimal_setting(raw: str) -> Decimal:
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        return _ZERO


def topup_threshold_usd() -> Decimal:
    return _decimal_setting(settings.agent_gateway_topup_threshold_usd)


def topup_amount_usd() -> Decimal:
    return _decimal_setting(settings.agent_gateway_topup_amount_usd)


async def create_llm_topup_grant(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    amount_usd: Decimal,
    source_ref: str,
) -> LlmCreditGrantRecord:
    """Record a top-up credit grant and reactivate anything it re-funds.

    ``source_ref`` (the Stripe invoice/charge id) makes the ledger insert
    idempotent — replaying the same top-up returns the existing grant and
    reactivation simply converges.
    """
    grant = await agent_gateway_store.create_llm_credit_grant(
        db,
        billing_subject_id=billing_subject_id,
        source=LLM_CREDIT_SOURCE_TOPUP,
        amount_usd=amount_usd,
        source_ref=source_ref,
    )
    await reactivate_subject_if_credited(db, billing_subject_id)
    return grant


async def reactivate_subject_if_credited(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime | None = None,
) -> int:
    """Bring a subject's enrollments back in service after credit arrives.

    When remaining credit is positive again, every active enrollment gets its
    exhausted virtual key unblocked (re-minted if the proxy rejects unblock),
    ``budget_status`` flipped back to ``ok``, and the LiteLLM team + key budget
    rewritten. For a hard-capped subject that is the total granted amount
    (LiteLLM budgets compare against lifetime team spend, and our imported
    usage is that same spend, so ``granted`` is "remaining" expressed in
    LiteLLM's terms). For an overage-enabled subject it is ``None`` — an
    explicit uncap that *removes* any hard cap the enrollment set before
    overage was turned on; without this rewrite the top-up charges but the key
    stays blocked at its old cap.

    Returns the number of enrollments reactivated or re-budgeted.
    """
    balance = await agent_gateway_store.get_remaining_credit_usd(
        db,
        billing_subject_id,
        now=now,
    )
    if balance.remaining_usd <= _ZERO:
        return 0
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    uncapped = subject is not None and subject.overage_enabled
    budget = None if uncapped else float(balance.granted_usd)

    reactivated = 0
    enrollments = await agent_gateway_store.list_active_enrollments_for_subject(
        db,
        billing_subject_id=billing_subject_id,
    )
    for enrollment in enrollments:
        try:
            await _reactivate_enrollment(db, enrollment, budget=budget)
        except LiteLLMIntegrationError as error:
            logger.warning(
                "Failed to reactivate enrollment after top-up",
                extra={
                    "enrollment_id": str(enrollment.id),
                    "error_code": error.code,
                },
            )
            continue
        reactivated += 1
    return reactivated


async def _reactivate_enrollment(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
    *,
    budget: float | None,
) -> None:
    virtual_key_id = enrollment.virtual_key_id
    if enrollment.budget_status != AGENT_GATEWAY_BUDGET_STATUS_OK and virtual_key_id is not None:
        try:
            await litellm.enable_virtual_key(key_or_token_id=virtual_key_id)
        except LiteLLMIntegrationError:
            # /key/unblock unavailable on this proxy build: hard-replace the
            # key (delete + mint keeps the alias) and persist the new value.
            virtual_key_id = await _remint_virtual_key(db, enrollment, budget=budget)
    # Always rewrite the LiteLLM budget: ``budget`` is the granted allowance
    # for a hard-capped subject, or ``None`` (explicit uncap) for an
    # overage-enabled one. Skipping the ``None`` case would leave an overage
    # subject pinned at whatever cap its enrollment set, so the top-up charges
    # but the key never unblocks.
    if enrollment.litellm_team_id:
        await litellm.update_team_budget(
            team_id=enrollment.litellm_team_id,
            max_budget=budget,
        )
    if virtual_key_id:
        await litellm.set_key_budget(
            key_or_token_id=virtual_key_id,
            max_budget=budget,
        )
    if enrollment.budget_status != AGENT_GATEWAY_BUDGET_STATUS_OK:
        await agent_gateway_store.set_enrollment_budget_status(
            db,
            enrollment_id=enrollment.id,
            budget_status=AGENT_GATEWAY_BUDGET_STATUS_OK,
        )


async def _remint_virtual_key(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
    *,
    budget: float | None,
) -> str | None:
    if enrollment.virtual_key_id is None or enrollment.litellm_team_id is None:
        return enrollment.virtual_key_id
    label = enrollment_subject_label(enrollment)
    minted = await litellm.rotate_virtual_key(
        key_or_token_id=enrollment.virtual_key_id,
        user_id=enrollment.litellm_user_id or label,
        team_id=enrollment.litellm_team_id,
        alias=enrollment_key_alias(enrollment),
        max_budget=budget,
        metadata=enrollment_key_metadata(enrollment),
    )
    await agent_gateway_store.mark_enrollment_synced(
        db,
        enrollment_id=enrollment.id,
        litellm_team_id=enrollment.litellm_team_id,
        litellm_user_id=enrollment.litellm_user_id,
        virtual_key_id=minted.token_id or None,
        virtual_key=minted.key,
        sync_fingerprint=enrollment.sync_fingerprint,
    )
    return minted.token_id or None


async def run_llm_topups(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> LlmTopupRunResult:
    """One top-up worker tick: charge + grant + reactivate low subjects.

    Only overage-enabled billing subjects with an active enrollment *and an
    existing credit grant* are considered, and only when their remaining
    credit is below the threshold. Subjects with no grant at all run on the
    LiteLLM default budget and are off the credit ledger — charging them would
    retroactively bill spend they incurred for free, so they are never topped
    up (mirrors the importer's zero-grant exemption). Subjects without a Stripe
    customer are skipped (logged) — there is nothing to charge. A subject deep
    in the red converges one top-up per tick, never more, so spend after
    exhaustion stays bounded.

    All active subjects are scanned via keyset pagination so the worker never
    starves subjects beyond a single page.
    """
    if not settings.agent_gateway_enabled or not topups_enabled():
        return LlmTopupRunResult(scanned=0, eligible=0, topped_up=0, skipped=0)
    amount = topup_amount_usd()
    if amount <= _ZERO:
        return LlmTopupRunResult(scanned=0, eligible=0, topped_up=0, skipped=0)
    threshold = topup_threshold_usd()

    scanned = 0
    eligible = 0
    topped_up = 0
    skipped = 0
    after: UUID | None = None
    while True:
        subject_ids = await agent_gateway_store.list_billing_subject_ids_with_active_enrollments(
            db,
            limit=_SUBJECT_SCAN_PAGE_SIZE,
            after=after,
        )
        if not subject_ids:
            break
        for billing_subject_id in subject_ids:
            scanned += 1
            subject = await get_billing_subject_by_id(db, billing_subject_id)
            if subject is None or not subject.overage_enabled:
                continue
            balance = await agent_gateway_store.get_remaining_credit_usd(
                db,
                billing_subject_id,
                now=now,
            )
            # No grant: subject rides the LiteLLM default budget and is off the
            # ledger — never bill its (free) historical spend via a top-up.
            if balance.granted_usd <= _ZERO:
                continue
            if balance.remaining_usd >= threshold:
                continue
            eligible += 1
            if not subject.stripe_customer_id:
                skipped += 1
                logger.warning(
                    "Overage-enabled subject needs an LLM top-up but has no Stripe customer",
                    extra={"billing_subject_id": str(billing_subject_id)},
                )
                continue
            try:
                invoice_id = await _charge_llm_topup(
                    db,
                    billing_subject_id=billing_subject_id,
                    stripe_customer_id=subject.stripe_customer_id,
                )
            except StripeIntegrationError as error:
                skipped += 1
                logger.warning(
                    "LLM top-up charge failed; will retry next tick",
                    extra={
                        "billing_subject_id": str(billing_subject_id),
                        "error_code": error.code,
                    },
                )
                continue
            await create_llm_topup_grant(
                db,
                billing_subject_id=billing_subject_id,
                amount_usd=amount,
                source_ref=f"{LLM_TOPUP_PURPOSE}:{invoice_id}",
            )
            topped_up += 1
            logger.info(
                "LLM credit top-up charged and granted",
                extra={
                    "billing_subject_id": str(billing_subject_id),
                    "stripe_invoice_id": invoice_id,
                },
            )
        if len(subject_ids) < _SUBJECT_SCAN_PAGE_SIZE:
            break
        after = subject_ids[-1]
    return LlmTopupRunResult(
        scanned=scanned,
        eligible=eligible,
        topped_up=topped_up,
        skipped=skipped,
    )


async def _charge_llm_topup(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_customer_id: str,
) -> str:
    """Charge one top-up through Stripe; returns the finalized invoice id.

    The idempotency key encodes the subject's top-up epoch (count of existing
    top-up grants): a crash after charging replays into the same Stripe
    invoice next tick, and the grant's ``source_ref`` dedupe then makes the
    whole sequence exactly-once. Once a grant lands the epoch advances, so a
    still-low subject legitimately charges a fresh invoice on the next tick.
    """
    epoch = await agent_gateway_store.count_topup_grants(db, billing_subject_id)
    idempotency_base = f"{LLM_TOPUP_PURPOSE}:{billing_subject_id}:{epoch}"
    invoice = await stripe_billing.create_invoice(
        stripe_customer_id=stripe_customer_id,
        billing_subject_id=str(billing_subject_id),
        purpose=LLM_TOPUP_PURPOSE,
        idempotency_key=f"{idempotency_base}:invoice",
    )
    invoice_id = invoice.get("id")
    if not isinstance(invoice_id, str) or not invoice_id:
        raise StripeIntegrationError(
            "stripe_invalid_response", "Stripe did not return an invoice id."
        )
    await stripe_billing.create_invoice_item(
        stripe_customer_id=stripe_customer_id,
        invoice_id=invoice_id,
        price_id=settings.agent_gateway_llm_topup_price_id,
        billing_subject_id=str(billing_subject_id),
        purpose=LLM_TOPUP_PURPOSE,
        idempotency_key=f"{idempotency_base}:item",
    )
    await stripe_billing.finalize_invoice(
        invoice_id=invoice_id,
        idempotency_key=f"{idempotency_base}:finalize",
    )
    return invoice_id
