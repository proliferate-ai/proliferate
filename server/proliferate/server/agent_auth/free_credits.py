"""Free LLM credits granted at signup (model-gateway.md §Billing integration).

Every new human gets a one-time ``settings.agent_gateway_free_credit_usd``
grant landing on their DEFAULT ORG's billing subject — orgs are the only
billing subject, and a "personal org" is just the default org created at
signup that nobody else has joined. The grant is deduped through
``free_cloud_allocation`` (the same anti-abuse guard the compute free trial
uses, keyed on the linked GitHub identity): one grant per human, ever. A
second account on the same GitHub identity gets nothing, creating additional
orgs mints nothing, and a joining member never brings their grant into
another org — it stays on their default org forever, which is what keeps
invite-farming worthless. The grant is the credit side of the LLM ledger;
the LiteLLM team budget then mirrors the remaining credit so the proxy
hard-stops when the ledger is spent.
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
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.billing_subjects import (
    ensure_agent_gateway_free_credit_allocation,
    ensure_organization_billing_subject,
)

logger = logging.getLogger(__name__)


def free_credit_amount_usd() -> Decimal:
    """Configured free-credit amount; non-positive means the grant is off."""
    try:
        amount = Decimal(settings.agent_gateway_free_credit_usd)
    except (ArithmeticError, ValueError):
        return Decimal("0")
    return amount if amount > 0 else Decimal("0")


async def ensure_signup_free_credit_grant(
    db: AsyncSession,
    user_id: UUID,
) -> bool:
    """Grant the one-time free LLM credit onto the user's default org.

    Returns True if the grant exists on the default org's billing subject
    after this call (freshly created or already present). Idempotent: the
    ``free_cloud_allocation`` guard reserves the allocation once per GitHub
    identity, and the credit grant's ``source_ref`` makes the ledger insert
    itself idempotent, so repeated enrollment/backfill passes never
    double-credit. An identity whose allocation is already claimed by a
    different billing subject (another account, or a pre-migration personal
    subject) gets nothing — one grant per human, ever.
    """
    amount = free_credit_amount_usd()
    if amount <= 0:
        return False
    default_org = await organization_store.get_default_organization_for_user(db, user_id)
    if default_org is None:
        # Signup always creates the default org before enrollment runs; an
        # org-less user here is a not-yet-placed identity the backfill worker
        # will revisit once a membership exists.
        return False
    subject = await ensure_organization_billing_subject(db, default_org.organization.id)
    reserved = await ensure_agent_gateway_free_credit_allocation(
        db,
        user_id=user_id,
        billing_subject=subject,
        period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    )
    if not reserved:
        # No linked GitHub identity, or the allocation belongs to another
        # billing subject (already claimed elsewhere). No credit here.
        return False
    grant = await agent_gateway_store.create_llm_credit_grant(
        db,
        billing_subject_id=subject.id,
        user_id=user_id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=amount,
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{subject.id}",
    )
    return grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP
