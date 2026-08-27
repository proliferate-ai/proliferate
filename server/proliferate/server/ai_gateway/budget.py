"""Gateway budget availability (the launch-gating predicate).

Second enforcement wall for LLM credit exhaustion: the first wall is the
LiteLLM virtual-key disable applied by the usage importer
(``usage_import._enforce_subject_exhaustion``). This predicate is consumed at
the point where a client acquires gateway access — the agent-auth state
render (the cloud materializer and ``GET /agent-auth/state``, which hand
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
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord

_ZERO = Decimal("0")

# The LLM-credit sibling of ``billing_credits_exhausted`` (whose compute-side
# producer died with the cloud sandbox stack, cull part 2).
#
# NO PRODUCT-SERVER ROUTE EMITS THIS TODAY. Its only producer was the 402 on the
# server-side catalog prober, deleted in B4 (the server no longer generates
# snapshots, so it has no gateway call to gate). The constant is kept, not
# deleted, because it is still a live *client* contract: the release scenarios
# classify it off the LiteLLM proxy response
# (``managed-cloud-fixture-smoke-1.ts``'s ``PRODUCT_LLM_CREDIT_DENIAL_CODE``,
# and ``t3-bill-4.ts``), and deleting the name would leave those string literals
# with nothing in the server to anchor them to.
#
# Exhaustion itself is still enforced, by the two walls that always did the real
# work: the usage importer disables the LiteLLM virtual keys, and the agent-auth
# state render withholds key material from an exhausted subject
# (``materialization/materialize/agent_auth.py``) so the runtime fails closed at
# launch. What is missing is a product-server 402 carrying this code — tracked as
# a model-gateway gap, not silently dropped.
AGENT_GATEWAY_CREDITS_EXHAUSTED_CODE = "agent_gateway_credits_exhausted"


def _explicit_default_budget_configured() -> bool:
    """Whether the deployment configured a real (positive) default team budget.

    The org budget setting defaults to a value LiteLLM would read as
    *uncapped* ("0"/empty), so only a strictly positive configured value
    counts as a funding source. This is the one non-ledger way a subject can
    be funded: a deployment that runs no credit ledger at all caps spend with
    the configured LiteLLM team budget instead. Orgs are the only billing
    subject, so there is exactly one such setting.
    """
    raw = settings.agent_gateway_default_org_budget_usd.strip()
    if not raw:
        return False
    try:
        return Decimal(raw) > _ZERO
    except ArithmeticError:
        return False


async def get_gateway_enrollment_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    """The enrollment that governs a user's gateway sessions.

    v1 payer law (model-gateway.md §Account model): the payer is the user's
    DEFAULT org — the org their identity was placed into at signup, i.e. the
    earliest active membership — always, unconditionally. There is no funding
    guard, no funded-org fallback, and no personal-enrollment fallback (the
    D-3 migration re-parented all pre-D-2 personal rows onto each user's
    default org and retired them): whether the resolved subject is funded is
    enforced at the budget layer (:func:`is_gateway_budget_available`, plus
    the LiteLLM team-budget mirror flooring unfunded subjects at the
    exhausted floor), never by re-routing payment to a different subject.
    """
    default_org = await organization_store.get_default_organization_for_user(db, user_id)
    if default_org is None:
        return None
    return await agent_gateway_store.get_enrollment_for_organization(
        db,
        organization_id=default_org.organization.id,
        user_id=user_id,
    )


async def is_gateway_budget_available(db: AsyncSession, user_id: UUID) -> bool:
    """Whether a user may launch a gateway-route session.

    An unfunded subject fails closed (model-gateway.md §Account model): a
    subject with no active credit grant and no explicitly configured positive
    default budget gets no gateway — the state renderer withholds key
    material off this predicate, and the mirrored LiteLLM team budget sits at
    the exhausted floor. There is no "no grant means unlimited" branch.

    True when the gateway is disabled (nothing to gate), when no enrollment
    exists at all (there is no key material either — the renderer withholds
    on the missing keys, not on this predicate), when the subject holds
    remaining credit, or when a grant-less subject is covered by an
    explicitly configured positive default budget (the LiteLLM team budget
    is then the guardrail). Checks the same enrollment the state renderer
    hands out key material for, so the gate and the keys it guards always
    agree on the paying subject.
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
        return _explicit_default_budget_configured()
    return balance.remaining_usd > _ZERO
