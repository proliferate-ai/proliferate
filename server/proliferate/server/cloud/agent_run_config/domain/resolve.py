"""Saved launch intent and execution-scope rules for agent run configs."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from proliferate.constants.cloud_agent_run_config import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
    CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
)
from proliferate.db.store.cloud_agent_run_config import CloudAgentRunConfigRecord


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
    control_values: dict[str, str]
    ignored_keys: tuple[str, ...]


def validate_config_values(
    *,
    agent_kind: str,
    model_id: str,
    control_values: dict[str, str],
) -> AgentRunConfigIssue | None:
    """Validate shape only; target launch options validate membership at create."""

    if not agent_kind.strip():
        return AgentRunConfigIssue("agent_kind_unavailable", "Agent kind is required.")
    if not model_id.strip():
        return AgentRunConfigIssue("model_unavailable", "Model is required.")
    for key, value in control_values.items():
        if not key.strip():
            return AgentRunConfigIssue("control_unavailable", "Control id is required.")
        if not isinstance(value, str) or not value:
            return AgentRunConfigIssue(
                "control_value_unavailable",
                f"Control '{key}' must have a non-empty string value.",
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
        return AgentRunConfigIssue("agent_run_config_not_found", "Agent run config not found.")
    if usable_in == "shared_sandboxes":
        if not config.usable_in_shared_sandboxes or organization_id is None:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable", "Config is not usable in shared sandboxes."
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
            return AgentRunConfigIssue("agent_run_config_not_found", "Agent run config not found.")
        return None

    if usable_in == "personal_sandboxes":
        if not config.usable_in_personal_sandboxes:
            return AgentRunConfigIssue(
                "agent_run_config_not_usable", "Config is not usable in personal sandboxes."
            )
        if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
            if actor_user_id is None or config.owner_user_id != actor_user_id:
                return AgentRunConfigIssue(
                    "agent_run_config_not_found", "Agent run config not found."
                )
        elif config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
            if organization_id is None or config.organization_id != organization_id:
                return AgentRunConfigIssue(
                    "agent_run_config_not_found", "Agent run config not found."
                )
        elif config.owner_scope != CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
            return AgentRunConfigIssue("agent_run_config_not_found", "Agent run config not found.")
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
        "agent_run_config_not_usable", "Agent run config target scope is invalid."
    )


def resolve_runtime_values(
    config: CloudAgentRunConfigRecord,
) -> ResolvedAgentRunConfig | AgentRunConfigIssue:
    values = {
        str(key): value
        for key, value in config.control_values_json.items()
        if isinstance(value, str)
    }
    issue = validate_config_values(
        agent_kind=config.agent_kind,
        model_id=config.model_id,
        control_values=values,
    )
    if issue is not None:
        return issue
    return ResolvedAgentRunConfig(
        config_id=str(config.id),
        config_name=config.name,
        agent_kind=config.agent_kind,
        model_id=config.model_id,
        control_values=values,
        ignored_keys=(),
    )
