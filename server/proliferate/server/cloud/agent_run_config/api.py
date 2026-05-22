"""Cloud agent run config API routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.agent_run_config.models import (
    AgentRunConfigCreateRequest,
    AgentRunConfigDefaultRequest,
    AgentRunConfigDefaultResponse,
    AgentRunConfigDefaultsResponse,
    AgentRunConfigListResponse,
    AgentRunConfigResponse,
    AgentRunConfigUpdateRequest,
    config_payload,
    default_payload,
)
from proliferate.server.cloud.agent_run_config.service import (
    archive_agent_run_config,
    create_agent_run_config,
    get_agent_run_config,
    list_agent_run_config_defaults,
    list_agent_run_configs,
    resolved_snapshot,
    set_agent_run_config_default,
    update_agent_run_config,
)

router = APIRouter(prefix="/agent-run-configs", tags=["cloud-agent-run-configs"])


@router.get("", response_model=AgentRunConfigListResponse)
async def list_agent_run_configs_endpoint(
    owner_scope: Annotated[str | None, Query(alias="ownerScope")] = None,
    organization_id: Annotated[UUID | None, Query(alias="organizationId")] = None,
    agent_kind: Annotated[str | None, Query(alias="agentKind")] = None,
    usable_in: Annotated[str | None, Query(alias="usableIn")] = None,
    status: str | None = "active",
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigListResponse:
    values = await list_agent_run_configs(
        db,
        user,
        owner_scope=owner_scope,
        organization_id=organization_id,
        agent_kind=agent_kind,
        usable_in=usable_in,
        status=status,
    )
    return AgentRunConfigListResponse(
        configs=[config_payload(value, resolved=resolved_snapshot(value)) for value in values],
    )


@router.post("", response_model=AgentRunConfigResponse)
async def create_agent_run_config_endpoint(
    body: AgentRunConfigCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigResponse:
    value = await create_agent_run_config(db, user, body)
    return config_payload(value, resolved=resolved_snapshot(value))


@router.get("/defaults", response_model=AgentRunConfigDefaultsResponse)
async def list_agent_run_config_defaults_endpoint(
    owner_scope: Annotated[str, Query(alias="ownerScope")] = "personal",
    organization_id: Annotated[UUID | None, Query(alias="organizationId")] = None,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigDefaultsResponse:
    values = await list_agent_run_config_defaults(
        db,
        user,
        owner_scope=owner_scope,
        organization_id=organization_id,
    )
    return AgentRunConfigDefaultsResponse(defaults=[default_payload(value) for value in values])


@router.put("/defaults/{agent_kind}", response_model=AgentRunConfigDefaultResponse)
async def set_agent_run_config_default_endpoint(
    agent_kind: str,
    body: AgentRunConfigDefaultRequest,
    owner_scope: Annotated[str, Query(alias="ownerScope")] = "personal",
    organization_id: Annotated[UUID | None, Query(alias="organizationId")] = None,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigDefaultResponse:
    value = await set_agent_run_config_default(
        db,
        user,
        owner_scope=owner_scope,
        organization_id=organization_id,
        agent_kind=agent_kind,
        config_id=body.config_id,
    )
    return default_payload(value)


@router.get("/{config_id}", response_model=AgentRunConfigResponse)
async def get_agent_run_config_endpoint(
    config_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigResponse:
    value = await get_agent_run_config(db, user, config_id)
    return config_payload(value, resolved=resolved_snapshot(value))


@router.patch("/{config_id}", response_model=AgentRunConfigResponse)
async def update_agent_run_config_endpoint(
    config_id: UUID,
    body: AgentRunConfigUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigResponse:
    value = await update_agent_run_config(db, user, config_id, body)
    return config_payload(value, resolved=resolved_snapshot(value))


@router.delete("/{config_id}", response_model=AgentRunConfigResponse)
async def archive_agent_run_config_endpoint(
    config_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentRunConfigResponse:
    value = await archive_agent_run_config(db, user, config_id)
    return config_payload(value, resolved=resolved_snapshot(value))
