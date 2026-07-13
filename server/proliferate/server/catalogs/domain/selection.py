"""Pure selection helpers over the probe-generated agent catalog."""

from __future__ import annotations

from collections.abc import Iterable

from proliferate.server.catalogs.models import (
    AgentCatalogAgent,
    AgentCatalogModel,
    AgentCatalogModelControl,
    AgentCatalogResponse,
    AgentCatalogSessionControl,
)


def catalog_agent(
    catalog: AgentCatalogResponse,
    agent_kind: str,
) -> AgentCatalogAgent | None:
    return next((agent for agent in catalog.agents if agent.kind == agent_kind), None)


def catalog_model(
    agent: AgentCatalogAgent,
    model_id: str,
    *,
    statuses: Iterable[str] | None = None,
    default_visible_only: bool = False,
) -> AgentCatalogModel | None:
    allowed_statuses = set(statuses) if statuses is not None else None
    for model in agent.session.models:
        if allowed_statuses is not None and model.status not in allowed_statuses:
            continue
        if default_visible_only and not model.defaultVisible:
            continue
        if model.id == model_id or model_id in model.aliases:
            return model
    return None


def session_control(
    agent: AgentCatalogAgent,
    *keys: str,
) -> AgentCatalogSessionControl | None:
    wanted = set(keys)
    return next((control for control in agent.session.controls if control.key in wanted), None)


def applicable_model_control(
    agent: AgentCatalogAgent,
    model: AgentCatalogModel,
    *keys: str,
) -> tuple[AgentCatalogSessionControl, AgentCatalogModelControl] | None:
    """Return a per-model control only when the catalog declares how to apply it."""

    for key in keys:
        agent_control = session_control(agent, key)
        model_control = model.controls.get(key)
        mapping = agent_control.mapping if agent_control is not None else None
        if (
            agent_control is not None
            and model_control is not None
            and mapping is not None
            and (mapping.createField is not None or mapping.liveConfigId is not None)
        ):
            return agent_control, model_control
    return None
