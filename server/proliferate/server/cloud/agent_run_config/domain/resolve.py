"""Pure agent run config catalog resolution."""

from __future__ import annotations

from dataclasses import dataclass

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
    active_model_ids = {
        model.id for model in agent.session.models if model.status in {"active", "candidate"}
    }
    if model_id not in active_model_ids:
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
        model_id=config.model_id,
        control_values=resolved,
        ignored_keys=tuple(sorted(ignored)),
    )
