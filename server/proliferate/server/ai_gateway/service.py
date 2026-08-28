"""Agent gateway account services: capabilities + enrollment reads.

The ``/agent-gateway`` surface's orchestration: the governing enrollment's
sync/budget status for the settings surface, and the per-harness verification
verdicts the FR-3 loop records. Store legality errors surface as typed
:class:`CloudApiError` values so the API layer maps them uniformly.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.agent_gateway import (
    AgentGatewayEnrollmentKeyRecord,
    AgentGatewayEnrollmentRecord,
    list_active_enrollment_keys,
)
from proliferate.server.ai_gateway import budget
from proliferate.server.ai_gateway.budget import get_gateway_enrollment_for_user
from proliferate.server.api_errors import CloudApiError

_ENROLLMENT_STATUS_NONE = "none"


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


async def get_capabilities(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[bool, str | None, str, bool]:
    """Return (gateway_enabled, public_base_url, enrollment_status, credits_exhausted).

    Status comes from the GOVERNING (never personal) enrollment, and
    ``credits_exhausted`` negates the renderer's key-withholding predicate
    (``is_gateway_budget_available``) — UI and render never disagree (AA-3).
    """
    enrollment = await get_gateway_enrollment_for_user(db, user_id)
    return (
        settings.agent_gateway_enabled,
        settings.agent_gateway_litellm_public_base_url or None,
        enrollment.sync_status if enrollment is not None else _ENROLLMENT_STATUS_NONE,
        not await budget.is_gateway_budget_available(db, user_id),
    )


async def get_verification_verdicts(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AgentGatewayEnrollmentKeyRecord]:
    """The per-harness gateway-enablement verdicts for the governing enrollment.

    Surfaces the FR-3 verification loop's output additively on the capabilities
    read (agent-auth.md): the enrollment-surface fallback rather than extending
    the pinned ``state.json`` wire shape. Only keys with a recorded verdict are
    returned; an unverified key is omitted.
    """
    enrollment = await get_gateway_enrollment_for_user(db, user_id)
    if enrollment is None:
        return []
    keys = await list_active_enrollment_keys(db, enrollment_id=enrollment.id)
    return [key for key in keys if key.verification_status is not None]


async def get_enrollment(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    """The governing enrollment for this user: the default org's, always."""
    enrollment = await get_gateway_enrollment_for_user(db, user_id)
    if enrollment is None:
        raise CloudApiError(
            "agent_gateway_enrollment_not_found",
            "No agent gateway enrollment exists for this user.",
            status_code=404,
        )
    return enrollment
