"""Pure eligibility, portable-definition, argument, and identity rules."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal, cast

import rfc8785

_INPUT_REFERENCE_PATTERN = re.compile(r"(?<!\{)\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}(?!\})")
_SAFE_INTEGER_MAX = 9_007_199_254_740_991

EligibilityCode = Literal[
    "stage_count_not_supported",
    "step_count_not_supported",
    "goal_not_supported",
    "default_repository_unavailable",
]
ScalarValue = str | bool | int | float
type CanonicalJsonValue = (
    None
    | bool
    | int
    | float
    | str
    | list[CanonicalJsonValue]
    | tuple[CanonicalJsonValue, ...]
    | dict[str, CanonicalJsonValue]
)


@dataclass(frozen=True)
class EligibilityBlocker:
    code: EligibilityCode
    path: str
    message: str


def collect_run_eligibility_blockers(
    *,
    stages: tuple[dict[str, object], ...],
    default_repo_config_id: object | None,
    default_repository_available: bool,
) -> tuple[EligibilityBlocker, ...]:
    blockers: list[EligibilityBlocker] = []
    if len(stages) != 1:
        blockers.append(
            EligibilityBlocker(
                code="stage_count_not_supported",
                path="stages",
                message="The current Workflow runner requires exactly one stage.",
            )
        )

    for stage_index, stage in enumerate(stages):
        steps = cast(list[dict[str, object]], stage.get("steps", []))
        if len(steps) != 1:
            blockers.append(
                EligibilityBlocker(
                    code="step_count_not_supported",
                    path=f"stages[{stage_index}].steps",
                    message="The current Workflow runner requires exactly one prompt step.",
                )
            )

        for step_index, step in enumerate(steps):
            if step.get("goal") is not None:
                blockers.append(
                    EligibilityBlocker(
                        code="goal_not_supported",
                        path=f"stages[{stage_index}].steps[{step_index}].goal",
                        message="Goals are not supported by the current Workflow runner.",
                    )
                )

    if default_repo_config_id is not None and not default_repository_available:
        blockers.append(
            EligibilityBlocker(
                code="default_repository_unavailable",
                path="defaultRepoConfigId",
                message="The default repository is missing, deleted, or not owned by this user.",
            )
        )

    return tuple(sorted(blockers, key=lambda blocker: (blocker.path, blocker.code)))


def build_portable_definition(
    *,
    inputs: tuple[dict[str, object], ...],
    stages: tuple[dict[str, object], ...],
) -> dict[str, object]:
    stage = stages[0]
    harness = cast(dict[str, object], stage["harnessConfig"])
    step = cast(list[dict[str, object]], stage["steps"])[0]
    model_id = harness.get("modelId")
    if model_id is None:
        model_selection: dict[str, object] = {"kind": "targetDefault"}
    else:
        model_selection = {"kind": "exact", "modelId": str(model_id)}

    portable_harness: dict[str, object] = {
        "agentKind": str(harness["agentKind"]),
        "modelSelection": model_selection,
        "permissionPolicy": "workflowDefault",
    }
    if harness.get("effort") is not None:
        portable_harness["effort"] = str(harness["effort"])

    return {
        "inputs": [dict(input_definition) for input_definition in inputs],
        "stages": [
            {
                "harnessConfig": portable_harness,
                "steps": [{"kind": "agent.prompt", "prompt": str(step["prompt"])}],
            }
        ],
    }


def validate_invocation_arguments(
    definition: dict[str, object],
    arguments: dict[str, ScalarValue],
) -> None:
    inputs = cast(list[dict[str, object]], definition["inputs"])
    stage = cast(list[dict[str, object]], definition["stages"])[0]
    step = cast(list[dict[str, object]], stage["steps"])[0]
    declared = {str(value["name"]): value for value in inputs}

    for name, value in arguments.items():
        input_definition = declared.get(name)
        if input_definition is None:
            raise ValueError(f"argument '{name}' is not a declared input")
        _validate_scalar(name, value, str(input_definition["type"]))

    for name, input_definition in declared.items():
        if bool(input_definition["required"]) and name not in arguments:
            raise ValueError(f"required input '{name}' has no argument")

    prompt = str(step["prompt"])
    references = _INPUT_REFERENCE_PATTERN.findall(prompt)
    remaining = _INPUT_REFERENCE_PATTERN.sub("", prompt)
    if "{{" in remaining or "}}" in remaining:
        raise ValueError("prompt contains a malformed input placeholder")
    for name in references:
        if name not in declared:
            raise ValueError(f"prompt references undeclared input '{name}'")
        if name not in arguments:
            raise ValueError(f"prompt input '{name}' has no argument")


def canonical_json(value: object) -> str:
    return rfc8785.dumps(cast(CanonicalJsonValue, value)).decode("utf-8")


def _validate_scalar(name: str, value: ScalarValue, expected: str) -> None:
    if expected == "string" and isinstance(value, str):
        return
    if expected == "boolean" and isinstance(value, bool):
        return
    if expected == "number" and not isinstance(value, bool) and isinstance(value, int | float):
        if isinstance(value, int) and not -_SAFE_INTEGER_MAX <= value <= _SAFE_INTEGER_MAX:
            raise ValueError(f"argument '{name}' is outside the portable integer range")
        if isinstance(value, float):
            if not math.isfinite(value):
                raise ValueError(f"argument '{name}' must be finite")
            if value.is_integer() and abs(value) > _SAFE_INTEGER_MAX:
                raise ValueError(f"argument '{name}' is outside the portable integer range")
        return
    raise ValueError(f"argument '{name}' must be a {expected}")
