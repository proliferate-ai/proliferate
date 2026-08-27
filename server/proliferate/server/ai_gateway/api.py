"""HTTP routes for the agent-gateway account.

``gateway_account_router`` serves ``/agent-gateway`` (enrollment,
capabilities — the gateway-account concerns model-gateway.md scopes that
prefix to). The agent-auth platform routes (key vault, selections, state,
org policy) live in ``proliferate.server.agent_auth.api`` under their own
``/agent-auth`` prefix.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.ai_gateway import service
from proliferate.server.ai_gateway.models import (
    AgentGatewayCapabilitiesResponse,
    AgentGatewayEnrollmentResponse,
    enrollment_payload,
    verification_verdict_payload,
)

gateway_account_router = APIRouter(prefix="/agent-gateway", tags=["cloud-agent-gateway"])


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


@gateway_account_router.get("/capabilities", response_model=AgentGatewayCapabilitiesResponse)
async def get_agent_gateway_capabilities_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayCapabilitiesResponse:
    (
        gateway_enabled,
        public_base_url,
        enrollment_status,
        credits_exhausted,
    ) = await service.get_capabilities(
        db,
        user_id=user.id,
    )
    verdicts = await service.get_verification_verdicts(db, user_id=user.id)
    return AgentGatewayCapabilitiesResponse(
        gateway_enabled=gateway_enabled,
        public_base_url=public_base_url,
        enrollment_status=enrollment_status,
        credits_exhausted=credits_exhausted,
        verifications=[verification_verdict_payload(record) for record in verdicts],
    )


@gateway_account_router.get("/enrollment", response_model=AgentGatewayEnrollmentResponse)
async def get_agent_gateway_enrollment_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayEnrollmentResponse:
    record = await service.get_enrollment(db, user_id=user.id)
    return enrollment_payload(record)
