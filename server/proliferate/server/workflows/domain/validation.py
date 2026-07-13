"""Pure cross-field validation for workflow definition documents."""

from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal, cast

from proliferate.server.catalogs.domain.selection import (
    applicable_model_control,
    catalog_agent,
    catalog_model,
)
from proliferate.server.catalogs.models import AgentCatalogResponse

_INPUT_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_INPUT_REFERENCE_PATTERN = re.compile(r"(?<!\{)\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}(?!\})")
_EFFORT_CONTROL_KEYS = ("effort", "reasoning_effort")


@dataclass(frozen=True)
class DefinitionIssue:
    path: str
    message: str
    kind: Literal["invalid_definition", "catalog_selection_unavailable"] = "invalid_definition"


@dataclass(frozen=True)
class ValidatedDefinitionDocument:
    inputs: list[dict[str, object]]
    stages: list[dict[str, object]]


def validate_definition_document(
    catalog: AgentCatalogResponse,
    *,
    inputs: list[dict[str, object]],
    stages: list[dict[str, object]],
) -> ValidatedDefinitionDocument | DefinitionIssue:
    normalized_inputs = deepcopy(inputs)
    normalized_stages = deepcopy(stages)

    input_names: set[str] = set()
    for index, input_definition in enumerate(normalized_inputs):
        name = str(input_definition["name"])
        if not _INPUT_NAME_PATTERN.fullmatch(name):
            return DefinitionIssue(
                path=f"inputs.{index}.name",
                message=(
                    "Input names must start with a letter and contain only letters, numbers, "
                    "and underscores."
                ),
            )
        if name in input_names:
            return DefinitionIssue(
                path=f"inputs.{index}.name",
                message=f"Input name '{name}' is duplicated.",
            )
        input_names.add(name)

    for stage_index, stage in enumerate(normalized_stages):
        harness = cast(dict[str, object], stage["harnessConfig"])
        agent_kind = str(harness["agentKind"])
        agent = catalog_agent(catalog, agent_kind)
        if agent is None:
            return DefinitionIssue(
                path=f"stages.{stage_index}.harnessConfig.agentKind",
                message=f"Agent harness '{agent_kind}' is not available.",
                kind="catalog_selection_unavailable",
            )

        model_id = harness.get("modelId")
        effort = harness.get("effort")
        model = None
        if model_id is not None:
            model = catalog_model(
                agent,
                str(model_id),
                statuses={"active"},
                default_visible_only=True,
            )
            if model is None:
                return DefinitionIssue(
                    path=f"stages.{stage_index}.harnessConfig.modelId",
                    message=f"Model '{model_id}' is not available for {agent.displayName}.",
                    kind="catalog_selection_unavailable",
                )
            harness["modelId"] = model.id

        if effort is not None:
            if model is None:
                return DefinitionIssue(
                    path=f"stages.{stage_index}.harnessConfig.effort",
                    message="Choose a specific model before setting reasoning effort.",
                )
            resolved_control = applicable_model_control(
                agent,
                model,
                *_EFFORT_CONTROL_KEYS,
            )
            if resolved_control is None:
                return DefinitionIssue(
                    path=f"stages.{stage_index}.harnessConfig.effort",
                    message=f"Model '{model.id}' does not expose an authorable effort control.",
                    kind="catalog_selection_unavailable",
                )
            _, model_control = resolved_control
            if str(effort) not in model_control.values:
                return DefinitionIssue(
                    path=f"stages.{stage_index}.harnessConfig.effort",
                    message=f"Effort '{effort}' is not supported by model '{model.id}'.",
                    kind="catalog_selection_unavailable",
                )

        steps = cast(list[dict[str, object]], stage["steps"])
        for step_index, step in enumerate(steps):
            goal = step.get("goal")
            if goal is not None and not agent.session.supportsGoals:
                return DefinitionIssue(
                    path=f"stages.{stage_index}.steps.{step_index}.goal",
                    message=f"{agent.displayName} does not support workflow goals.",
                    kind="catalog_selection_unavailable",
                )
            for field_name, text in _step_template_fields(step):
                issue = _validate_template(
                    str(text),
                    input_names=input_names,
                    path=f"stages.{stage_index}.steps.{step_index}.{field_name}",
                )
                if issue is not None:
                    return issue

    return ValidatedDefinitionDocument(inputs=normalized_inputs, stages=normalized_stages)


def _step_template_fields(step: dict[str, object]) -> list[tuple[str, str]]:
    fields = [("prompt", str(step["prompt"]))]
    goal = step.get("goal")
    if isinstance(goal, dict):
        fields.append(("goal.objective", str(goal["objective"])))
    return fields


def _validate_template(
    text: str,
    *,
    input_names: set[str],
    path: str,
) -> DefinitionIssue | None:
    referenced_names = _INPUT_REFERENCE_PATTERN.findall(text)
    remaining = _INPUT_REFERENCE_PATTERN.sub("", text)
    if "{{" in remaining or "}}" in remaining:
        return DefinitionIssue(
            path=path,
            message="Templates may only use the exact form '{{inputs.name}}'.",
        )
    unknown = next((name for name in referenced_names if name not in input_names), None)
    if unknown is not None:
        return DefinitionIssue(
            path=path,
            message=f"Template references unknown input '{unknown}'.",
        )
    return None
