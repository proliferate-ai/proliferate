"""Gateway budget availability (the launch-gating predicate).

Second enforcement wall for LLM credit exhaustion: the first wall is the
LiteLLM virtual-key disable applied by the usage importer
(``usage_import._enforce_subject_exhaustion``). This predicate is consumed at
the point where a client acquires gateway access — the agent-auth state
render (the cloud materializer and ``GET /agent-gateway/state``, which hand
out the decrypted virtual key) — so an exhausted subject stops receiving key
material even if the LiteLLM-side disable lagged or failed.

Lives in its own leaf module (imports only config + stores) because the state
renderer in ``materialization/materialize/agent_auth.py`` needs it and
``usage_import`` sits behind an import cycle
(usage_import -> topups -> materialization.service -> materialize.agent_auth).
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_runtime_usage import resolve_organization_id_for_user

_ZERO = Decimal("0")

# Stable machine code on the 402 detail body when the gate blocks — the
# LLM-credit sibling of ``billing_credits_exhausted`` (the compute-side code
# in ``server.billing.authorization``). Part of the client contract; do not
# rename without updating consumers.
AGENT_GATEWAY_CREDITS_EXHAUSTED_CODE = "agent_gateway_credits_exhausted"


def _explicit_org_budget_configured() -> bool:
    """Whether the deployment configured a real (non-default) org team budget.

    ``agent_gateway_default_org_budget_usd`` defaults to "0", which LiteLLM
    reads as *uncapped* rather than as zero — so the default is the absence of
    a cap, not a cap of nothing.
    """
    raw = settings.agent_gateway_default_org_budget_usd.strip()
    if not raw:
        return False
    try:
        return Decimal(raw) > _ZERO
    except ArithmeticError:
        return False


async def _subject_is_funded(db: AsyncSession, billing_subject_id: UUID) -> bool:
    """Whether a billing subject actually funds gateway spend.

    Funded means a positive LLM credit grant (the ledger the importer debits
    and the gate reads) or an explicitly configured org team budget. A subject
    with neither has no funding source at all, and every LLM guardrail reads as
    "unlimited" for it (see :func:`get_gateway_enrollment_for_user`).
    """
    balance = await agent_gateway_store.get_remaining_credit_usd(db, billing_subject_id)
    if balance.granted_usd > _ZERO:
        return True
    return _explicit_org_budget_configured()


async def get_gateway_enrollment_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    """The enrollment that governs a user's gateway sessions.

    An org member (current membership, same resolution
    ``resolve_billing_subject_id_for_user`` and ``ensure_org_enrollment`` use)
    is governed by their **org** enrollment rather than their personal one —
    closing the model-gateway.md org-member gap where sessions previously
    always resolved the personal enrollment regardless of org membership.

    Funding-follows-attribution guard (interim; founder end-state ruling
    pending). Routing to the org subject unconditionally is not safe on hosted,
    where EVERY user gets a default personal org: an org billing subject with
    no credit grant makes ``is_gateway_budget_available`` return ``True``
    unconditionally (the ``granted_usd <= 0`` "no ledger, LiteLLM budget is the
    guardrail" branch), while the org team's default budget of "0" means
    *uncapped* in LiteLLM. Both walls open at once, the personal free-credit
    grant is never consulted, and spend is unbounded. So the org enrollment
    governs only when the org subject is actually funded
    (:func:`_org_subject_is_funded`); otherwise this resolves the personal
    enrollment — the pre-B3 behavior, where the personal grant is the cap.

    Org choice is deterministic when a user holds several memberships: it is
    the first active membership ordered by organization NAME
    (``get_current_membership_for_user``), the same choice compute attribution
    makes. Renaming an org can therefore move the payer; that instability is
    inherited from the compute path and pinned by test, not introduced here.
    """
    organization_id = await resolve_organization_id_for_user(db, user_id)
    if organization_id is not None:
        org_enrollment = await agent_gateway_store.get_enrollment_for_organization(
            db,
            organization_id=organization_id,
            user_id=user_id,
        )
        if org_enrollment is not None and await _subject_is_funded(
            db,
            org_enrollment.billing_subject_id,
        ):
            return org_enrollment
    return await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)


async def is_gateway_budget_available(db: AsyncSession, user_id: UUID) -> bool:
    """Whether a user may launch a gateway-route session.

    True when the gateway is disabled (LiteLLM budgets are the only guardrail),
    or the user has no credit grant (default-budget subjects are never blocked
    on the ledger), or their remaining LLM credit is above zero. False only when
    a granted subject has spent its credit. Checks the same enrollment the state
    renderer hands out key material for (the org enrollment for an org member,
    else the personal one), so the gate and the keys it guards always agree on
    the paying subject.
    """
    if not settings.agent_gateway_enabled:
        return True
    enrollment = await get_gateway_enrollment_for_user(db, user_id)
    if enrollment is None:
        return True
    balance = await agent_gateway_store.get_remaining_credit_usd(
        db,
        enrollment.billing_subject_id,
    )
    if balance.granted_usd <= _ZERO:
        return True
    return balance.remaining_usd > _ZERO
