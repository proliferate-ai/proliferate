"""Free LLM credits granted at enrollment (spec section 7).

At signup every user gets a one-time ``settings.agent_gateway_free_credit_usd``
grant, deduped through ``free_cloud_allocation`` (the same anti-abuse guard the
compute free trial uses, keyed on the linked GitHub identity). The grant is the
credit side of the LLM ledger; the LiteLLM team budget is then set to the
remaining credit so the proxy hard-stops when the ledger is spent.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.billing_subjects import (
    ensure_agent_gateway_free_credit_allocation,
    ensure_personal_billing_subject,
)

logger = logging.getLogger(__name__)


def free_credit_amount_usd() -> Decimal:
    """Configured free-credit amount; non-positive means the grant is off."""
    try:
        amount = Decimal(settings.agent_gateway_free_credit_usd)
    except (ArithmeticError, ValueError):
        return Decimal("0")
    return amount if amount > 0 else Decimal("0")


async def ensure_user_free_credit_grant(
    db: AsyncSession,
    user_id: UUID,
) -> bool:
    """Grant the one-time free LLM credit for a user; returns True if granted.

    Idempotent: the ``free_cloud_allocation`` guard reserves the allocation
    once per GitHub identity, and the credit grant's ``source_ref`` makes the
    ledger insert itself idempotent, so repeated enrollment/backfill passes
    never double-credit.
    """
    amount = free_credit_amount_usd()
    if amount <= 0:
        return False
    reserved = await ensure_agent_gateway_free_credit_allocation(
        db,
        user_id=user_id,
        period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    )
    if not reserved:
        # No linked GitHub identity, or the allocation belongs to another
        # subject (already claimed elsewhere). No credit for this user.
        return False
    subject = await ensure_personal_billing_subject(db, user_id)
    grant = await agent_gateway_store.create_llm_credit_grant(
        db,
        billing_subject_id=subject.id,
        user_id=user_id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=amount,
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{subject.id}",
    )
    return grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP
