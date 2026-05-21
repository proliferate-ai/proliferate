"""Cloud agent run config API models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_agent_run_config.configs import (
    CloudAgentRunConfigDefaultRecord,
    CloudAgentRunConfigRecord,
)
from proliferate.server.cloud.agent_run_config.domain.resolve import ResolvedAgentRunConfig

AgentRunConfigOwnerScope = Literal["system", "personal", "organization"]
AgentRunConfigDefaultOwnerScope = Literal["personal", "organization"]
AgentRunConfigStatus = Literal["active", "archived"]
AgentRunConfigUsableIn = Literal["personal_sandboxes", "shared_sandboxes"]


class AgentRunConfigBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AgentRunConfigCreateRequest(AgentRunConfigBaseModel):
    owner_scope: AgentRunConfigOwnerScope = Field(alias="ownerScope")
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    name: str
    agent_kind: str = Field(alias="agentKind")
    model_id: str = Field(alias="modelId")
    control_values: dict[str, object] = Field(default_factory=dict, alias="controlValues")
    usable_in_personal_sandboxes: bool = Field(True, alias="usableInPersonalSandboxes")
    usable_in_shared_sandboxes: bool = Field(False, alias="usableInSharedSandboxes")


class AgentRunConfigUpdateRequest(AgentRunConfigBaseModel):
    name: str | None = None
    model_id: str | None = Field(default=None, alias="modelId")
    control_values: dict[str, object] | None = Field(default=None, alias="controlValues")
    usable_in_personal_sandboxes: bool | None = Field(
        default=None,
        alias="usableInPersonalSandboxes",
    )
    usable_in_shared_sandboxes: bool | None = Field(
        default=None,
        alias="usableInSharedSandboxes",
    )


class AgentRunConfigDefaultRequest(AgentRunConfigBaseModel):
    config_id: UUID = Field(alias="configId")


class AgentRunConfigResolvedSnapshot(AgentRunConfigBaseModel):
    config_id: str = Field(alias="configId")
    config_name: str = Field(alias="configName")
    agent_kind: str = Field(alias="agentKind")
    model_id: str = Field(alias="modelId")
    control_values: dict[str, object] = Field(alias="controlValues")
    ignored_keys: list[str] = Field(alias="ignoredKeys")


class AgentRunConfigResponse(AgentRunConfigBaseModel):
    id: str
    owner_scope: AgentRunConfigOwnerScope = Field(alias="ownerScope")
    owner_user_id: str | None = Field(alias="ownerUserId")
    organization_id: str | None = Field(alias="organizationId")
    created_by_user_id: str = Field(alias="createdByUserId")
    name: str
    agent_kind: str = Field(alias="agentKind")
    model_id: str = Field(alias="modelId")
    control_values: dict[str, object] = Field(alias="controlValues")
    usable_in_personal_sandboxes: bool = Field(alias="usableInPersonalSandboxes")
    usable_in_shared_sandboxes: bool = Field(alias="usableInSharedSandboxes")
    seed_key: str | None = Field(alias="seedKey")
    system_default_rank: int | None = Field(alias="systemDefaultRank")
    status: AgentRunConfigStatus
    resolved: AgentRunConfigResolvedSnapshot | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    archived_at: str | None = Field(alias="archivedAt")


class AgentRunConfigListResponse(AgentRunConfigBaseModel):
    configs: list[AgentRunConfigResponse]


class AgentRunConfigDefaultResponse(AgentRunConfigBaseModel):
    id: str
    owner_scope: AgentRunConfigDefaultOwnerScope = Field(alias="ownerScope")
    owner_user_id: str | None = Field(alias="ownerUserId")
    organization_id: str | None = Field(alias="organizationId")
    agent_kind: str = Field(alias="agentKind")
    config_id: str = Field(alias="configId")
    created_by_user_id: str = Field(alias="createdByUserId")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AgentRunConfigDefaultsResponse(AgentRunConfigBaseModel):
    defaults: list[AgentRunConfigDefaultResponse]


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _resolved_payload(
    resolved: ResolvedAgentRunConfig | None,
) -> AgentRunConfigResolvedSnapshot | None:
    if resolved is None:
        return None
    return AgentRunConfigResolvedSnapshot(
        config_id=resolved.config_id,
        config_name=resolved.config_name,
        agent_kind=resolved.agent_kind,
        model_id=resolved.model_id,
        control_values=resolved.control_values,
        ignored_keys=list(resolved.ignored_keys),
    )


def config_payload(
    value: CloudAgentRunConfigRecord,
    *,
    resolved: ResolvedAgentRunConfig | None = None,
) -> AgentRunConfigResponse:
    return AgentRunConfigResponse(
        id=str(value.id),
        owner_scope=value.owner_scope,  # type: ignore[arg-type]
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        organization_id=str(value.organization_id) if value.organization_id else None,
        created_by_user_id=str(value.created_by_user_id),
        name=value.name,
        agent_kind=value.agent_kind,
        model_id=value.model_id,
        control_values=value.control_values_json,
        usable_in_personal_sandboxes=value.usable_in_personal_sandboxes,
        usable_in_shared_sandboxes=value.usable_in_shared_sandboxes,
        seed_key=value.seed_key,
        system_default_rank=value.system_default_rank,
        status=value.status,  # type: ignore[arg-type]
        resolved=_resolved_payload(resolved),
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
        archived_at=_iso(value.archived_at),
    )


def default_payload(value: CloudAgentRunConfigDefaultRecord) -> AgentRunConfigDefaultResponse:
    return AgentRunConfigDefaultResponse(
        id=str(value.id),
        owner_scope=value.owner_scope,  # type: ignore[arg-type]
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        organization_id=str(value.organization_id) if value.organization_id else None,
        agent_kind=value.agent_kind,
        config_id=str(value.config_id),
        created_by_user_id=str(value.created_by_user_id),
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
    )
