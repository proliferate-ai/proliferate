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

_ZERO = Decimal("0")

# Stable machine code on the 402 detail body when the gate blocks — the
# LLM-credit sibling of ``billing_credits_exhausted`` (the compute-side code
# in ``server.billing.authorization``). Part of the client contract; do not
# rename without updating consumers.
AGENT_GATEWAY_CREDITS_EXHAUSTED_CODE = "agent_gateway_credits_exhausted"


async def is_gateway_budget_available(db: AsyncSession, user_id: UUID) -> bool:
    """Whether a user may launch a gateway-route session.

    True when the gateway is disabled (LiteLLM budgets are the only guardrail),
    or the user has no credit grant (default-budget subjects are never blocked
    on the ledger), or their remaining LLM credit is above zero. False only when
    a granted subject has spent its credit. Checks the same enrollment the state
    renderer hands out key material for (the user's personal enrollment), so the
    gate and the key it guards always agree on the paying subject.
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
