"""Pure cross-field validation for workflow definition documents."""

from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal, cast

_INPUT_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_INPUT_REFERENCE_PATTERN = re.compile(r"(?<!\{)\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}(?!\})")


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
        model_id = harness.get("modelId")
        effort = harness.get("effort")
        if effort is not None and model_id is None:
            return DefinitionIssue(
                path=f"stages.{stage_index}.harnessConfig.effort",
                message="Choose a specific model before setting reasoning effort.",
            )

        steps = cast(list[dict[str, object]], stage["steps"])
        for step_index, step in enumerate(steps):
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
