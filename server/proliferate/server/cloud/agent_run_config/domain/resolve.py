"""Pure agent run config catalog resolution."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from proliferate.constants.automations import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
    CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
)
from proliferate.db.store.cloud_agent_run_config.configs import CloudAgentRunConfigRecord
from proliferate.server.catalogs.models import AgentCatalogAgent, AgentCatalogResponse


@dataclass(frozen=True)
class AgentRunConfigIssue:
    code: str
    message: str


@dataclass(frozen=True)
class ResolvedAgentRunConfig:
    config_id: str
    config_name: str
    agent_kind: str
    model_id: str
    control_values: dict[str, object]
    ignored_keys: tuple[str, ...]


def _catalog_agent(catalog: AgentCatalogResponse, agent_kind: str) -> AgentCatalogAgent | None:
    for agent in catalog.agents:
        if agent.kind == agent_kind:
            return agent
    return None


def canonical_model_id_for_config(
    catalog: AgentCatalogResponse,
    *,
    agent_kind: str,
    model_id: str,
) -> str | None:
    agent = _catalog_agent(catalog, agent_kind)
    if agent is None:
        return None
    for model in agent.session.models:
        if model.status not in {"active", "candidate"}:
            continue
        if model.id == model_id or model_id in model.aliases:
            return model.id
    return None


def validate_config_values(
    catalog: AgentCatalogResponse,
    *,
    agent_kind: str,
    model_id: str,
    control_values: dict[str, object],
) -> AgentRunConfigIssue | None:
    agent = _catalog_agent(catalog, agent_kind)
    if agent is None:
        return AgentRunConfigIssue("agent_kind_unavailable", "Agent kind is not available.")
    if canonical_model_id_for_config(
        catalog,
        agent_kind=agent_kind,
        model_id=model_id,
    ) is None:
        return AgentRunConfigIssue("model_unavailable", "Model is not available for this agent.")
    allowed_controls = {
        control.key: control
        for control in agent.session.controls
        if control.key != "model" and (control.surfaces.automation or control.surfaces.settings)
    }
    for key, value in control_values.items():
        control = allowed_controls.get(key)
        if control is None:
            return AgentRunConfigIssue(
                "control_unavailable",
                f"Control '{key}' is not available for this agent.",
            )
        if control.valueSource == "inline":
            allowed_values = {option.value for option in control.values}
            if str(value) not in allowed_values:
                return AgentRunConfigIssue(
                    "control_value_unavailable",
                    f"Control '{key}' has an unsupported value.",
                )
    return None


def validate_config_execution_scope(
    config: CloudAgentRunConfigRecord,
    *,
    actor_user_id: UUID | None,
    owner_scope: str,
    organization_id: UUID | None,
    usable_in: str,
) -> AgentRunConfigIssue | None:
    if config.status != CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE:
        return AgentRunConfigIssue(
            "agent_run_config_not_found",
            "Agent run config not found.",
        )
    if usable_in == "shared_sandboxes":
        if not config.usable_in_shared_sandboxes:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable",
                "Agent run config is not usable in shared sandboxes.",
            )
        if organization_id is None:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable",
                "Shared sandbox runs require an organization.",
            )
        if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable",
                "Personal agent run configs cannot be used in shared sandboxes.",
            )
        if (
            config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION
            and config.organization_id != organization_id
        ):
            return AgentRunConfigIssue(
                "agent_run_config_not_found",
                "Agent run config not found.",
            )
        return None

    if usable_in == "personal_sandboxes":
        if not config.usable_in_personal_sandboxes:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable",
                "Agent run config is not usable in personal sandboxes.",
            )
        if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
            if actor_user_id is None or config.owner_user_id != actor_user_id:
                return AgentRunConfigIssue(
                    "agent_run_config_not_found",
                    "Agent run config not found.",
                )
        elif config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
            if organization_id is None or config.organization_id != organization_id:
                return AgentRunConfigIssue(
                    "agent_run_config_not_found",
                    "Agent run config not found.",
                )
        elif config.owner_scope != CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
            return AgentRunConfigIssue(
                "agent_run_config_not_found",
                "Agent run config not found.",
            )
        if (
            owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION
            and config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL
        ):
            return AgentRunConfigIssue(
                "agent_run_config_not_usable",
                "Team runs cannot use personal agent run configs.",
            )
        return None

    return AgentRunConfigIssue(
        "agent_run_config_not_usable",
        "Agent run config target scope is invalid.",
    )


def resolve_runtime_values(
    catalog: AgentCatalogResponse,
    config: CloudAgentRunConfigRecord,
) -> ResolvedAgentRunConfig | AgentRunConfigIssue:
    issue = validate_config_values(
        catalog,
        agent_kind=config.agent_kind,
        model_id=config.model_id,
        control_values=config.control_values_json,
    )
    if issue is not None:
        return issue

    agent = _catalog_agent(catalog, config.agent_kind)
    if agent is None:
        return AgentRunConfigIssue("agent_kind_unavailable", "Agent kind is not available.")
    model_id = canonical_model_id_for_config(
        catalog,
        agent_kind=config.agent_kind,
        model_id=config.model_id,
    )
    if model_id is None:
        return AgentRunConfigIssue("model_unavailable", "Model is not available for this agent.")
    allowed_controls = {
        control.key: control
        for control in agent.session.controls
        if control.key != "model" and (control.surfaces.automation or control.surfaces.settings)
    }
    resolved: dict[str, object] = {}
    ignored: list[str] = []
    for key, value in config.control_values_json.items():
        if key in allowed_controls:
            resolved[key] = value
        else:
            ignored.append(key)
    for key, control in allowed_controls.items():
        if key not in resolved and control.defaultValue is not None:
            resolved[key] = control.defaultValue
    return ResolvedAgentRunConfig(
        config_id=str(config.id),
        config_name=config.name,
        agent_kind=config.agent_kind,
        model_id=model_id,
        control_values=resolved,
        ignored_keys=tuple(sorted(ignored)),
    )
