"""Pure invocation-time rules: argument validation, interpolation, bundles.

Everything here is a pure function over already-loaded data. Placement
resolution (which consults repository/environment stores) lives in the
service layer; this module treats the resolved logical placement as data.

Interpolation is single-pass and only replaces exact ``{{inputs.name}}``
tokens (PR2 design §6.2): a regex substitution walks the original text once,
so inserted input text is never rescanned for new tokens. Canonical scalar
rendering — exact string, RFC 8785 canonical number text, lowercase
``true``/``false`` — comes from the shared canonical module so the rendered
stages digest identically in every language.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal, cast
from uuid import UUID

from proliferate.utils.canonical_json import canonical_json, sha256_hex

_INPUT_REFERENCE_PATTERN = re.compile(r"(?<!\{)\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}(?!\})")

# Integers beyond the IEEE-754 exact range cannot canonicalize consistently
# across languages; the canonical module would reject them, so the argument
# validator reports the typed issue up front instead of a late ValueError.
_MAX_SAFE_INTEGER = 2**53

WorkflowArgumentValue = str | int | float | bool


@dataclass(frozen=True)
class InvocationIssue:
    code: Literal[
        "workflow_input_unknown",
        "workflow_input_missing",
        "workflow_input_type_mismatch",
        "workflow_input_number_not_finite",
        "workflow_input_number_outside_exact_range",
        "workflow_optional_input_reference_missing",
        "workflow_request_not_canonical",
        "invalid_workflow_definition",
    ]
    message: str
    path: str | None = None


def validate_request_canonicalizable(request: dict[str, object]) -> InvocationIssue | None:
    """Reject request values the cross-language canonical form cannot carry.

    ``json.loads`` admits three things RFC 8785 canonicalization rejects:
    lone surrogates in strings, non-finite numbers (``NaN``/``Infinity``
    literals), and integers beyond the IEEE-754 exact range. They must become
    structured 400s at ingress — before hashing or persistence — never a
    ``ValueError`` from the canonical module (a 500).
    """

    return _scan_canonicalizable(request, path="")


def _scan_canonicalizable(value: object, *, path: str) -> InvocationIssue | None:
    if isinstance(value, str):
        return _issue_for_string(value, path=path)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        if abs(value) > _MAX_SAFE_INTEGER:
            return _canonical_issue(
                "workflow_input_number_outside_exact_range",
                "must be within the IEEE-754 exact integer range (|value| <= 2^53).",
                path=path,
            )
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return _canonical_issue(
                "workflow_input_number_not_finite",
                "must be a finite number.",
                path=path,
            )
        return None
    if isinstance(value, dict):
        for key, item in value.items():
            key_path = f"{path}.{key}" if path else str(key)
            issue = _issue_for_string(str(key), path=key_path)
            if issue is not None:
                return issue
            issue = _scan_canonicalizable(item, path=key_path)
            if issue is not None:
                return issue
        return None
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            issue = _scan_canonicalizable(item, path=f"{path}.{index}" if path else str(index))
            if issue is not None:
                return issue
        return None
    return None


def _issue_for_string(value: str, *, path: str) -> InvocationIssue | None:
    if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        # The offending path may itself carry the surrogate (dict keys are
        # scanned as part of their own path). Scrub it so the typed 400 body
        # stays UTF-8 encodable instead of crashing response rendering.
        safe_path = scrub_lone_surrogates(path)
        return InvocationIssue(
            code="workflow_request_not_canonical",
            message=f"Request value at '{safe_path}' contains a lone surrogate.",
            path=safe_path,
        )
    return None


def scrub_lone_surrogates(text: str) -> str:
    """Replace surrogate code points with visible ``\\uXXXX`` escapes."""

    return "".join(
        f"\\u{ord(char):04x}" if 0xD800 <= ord(char) <= 0xDFFF else char for char in text
    )


def _canonical_issue(
    code: Literal[
        "workflow_input_number_not_finite",
        "workflow_input_number_outside_exact_range",
    ],
    suffix: str,
    *,
    path: str,
) -> InvocationIssue:
    # Argument values keep their precise typed input codes; the same defect
    # anywhere else in the request is the generic non-canonical rejection.
    if path.startswith("inputs."):
        return InvocationIssue(
            code=code,
            message=f"Input '{path.removeprefix('inputs.')}' {suffix}",
            path=path,
        )
    return InvocationIssue(
        code="workflow_request_not_canonical",
        message=f"Request value at '{path}' {suffix}",
        path=path,
    )


def repository_identity(git_provider: str, git_owner: str, git_repo_name: str) -> str:
    """Stable repository identity string frozen into resolved placement."""

    return f"{git_provider}:{git_owner}/{git_repo_name}"


@dataclass(frozen=True)
class ResolvedArguments:
    arguments: dict[str, WorkflowArgumentValue]


def validate_arguments(
    *,
    inputs_declaration: list[dict[str, object]],
    arguments: dict[str, object],
) -> ResolvedArguments | InvocationIssue:
    """Validate caller arguments against the exact PR1 input declaration."""

    declared: dict[str, dict[str, object]] = {
        str(entry["name"]): entry for entry in inputs_declaration
    }
    for name in arguments:
        if name not in declared:
            return InvocationIssue(
                code="workflow_input_unknown",
                message=f"Unknown input '{name}'.",
                path=f"inputs.{name}",
            )

    validated: dict[str, WorkflowArgumentValue] = {}
    for name, declaration in declared.items():
        if name not in arguments:
            if bool(declaration["required"]):
                return InvocationIssue(
                    code="workflow_input_missing",
                    message=f"Input '{name}' is required.",
                    path=f"inputs.{name}",
                )
            continue
        value = arguments[name]
        issue = _validate_scalar(
            name=name,
            declared_type=str(declaration["type"]),
            value=value,
        )
        if issue is not None:
            return issue
        validated[name] = value  # type: ignore[assignment]
    return ResolvedArguments(arguments=validated)


def _type_mismatch(name: str, declared_type: str, path: str) -> InvocationIssue:
    return InvocationIssue(
        code="workflow_input_type_mismatch",
        message=f"Input '{name}' must be a {declared_type}.",
        path=path,
    )


def _validate_scalar(
    *,
    name: str,
    declared_type: str,
    value: object,
) -> InvocationIssue | None:
    path = f"inputs.{name}"
    if declared_type == "string":
        if not isinstance(value, str):
            return _type_mismatch(name, declared_type, path)
        return None
    if declared_type == "boolean":
        if not isinstance(value, bool):
            return _type_mismatch(name, declared_type, path)
        return None
    if declared_type == "number":
        # bool is a subclass of int and is not a JSON number.
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return _type_mismatch(name, declared_type, path)
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return InvocationIssue(
                code="workflow_input_number_not_finite",
                message=f"Input '{name}' must be a finite number.",
                path=path,
            )
        if isinstance(value, int) and abs(value) > _MAX_SAFE_INTEGER:
            return InvocationIssue(
                code="workflow_input_number_outside_exact_range",
                message=(
                    f"Input '{name}' must be within the IEEE-754 exact integer "
                    "range (|value| <= 2^53)."
                ),
                path=path,
            )
        return None
    return InvocationIssue(
        code="invalid_workflow_definition",
        message=f"Input '{name}' has unsupported declared type '{declared_type}'.",
        path=path,
    )


def resolve_stages(
    *,
    stages: list[dict[str, object]],
    inputs_declaration: list[dict[str, object]],
    arguments: dict[str, WorkflowArgumentValue],
) -> list[dict[str, object]] | InvocationIssue:
    """Produce input-resolved stages via single-pass exact-token interpolation."""

    declared_names = {str(entry["name"]) for entry in inputs_declaration}
    optional_names = {
        str(entry["name"]) for entry in inputs_declaration if not bool(entry["required"])
    }
    rendered = {name: _render_scalar(value) for name, value in arguments.items()}

    resolved: list[dict[str, object]] = []
    for stage_index, stage in enumerate(stages):
        steps: list[dict[str, object]] = []
        for step_index, step in enumerate(cast(list[dict[str, object]], stage["steps"])):
            path = f"stages.{stage_index}.steps.{step_index}"
            prompt = _interpolate(
                str(step["prompt"]),
                declared_names=declared_names,
                optional_names=optional_names,
                rendered=rendered,
                path=f"{path}.prompt",
            )
            if isinstance(prompt, InvocationIssue):
                return prompt
            resolved_step: dict[str, object] = {"kind": str(step["kind"]), "prompt": prompt}
            goal = step.get("goal")
            if isinstance(goal, dict):
                objective = _interpolate(
                    str(goal["objective"]),
                    declared_names=declared_names,
                    optional_names=optional_names,
                    rendered=rendered,
                    path=f"{path}.goal.objective",
                )
                if isinstance(objective, InvocationIssue):
                    return objective
                resolved_step["goal"] = {"objective": objective}
            steps.append(resolved_step)
        resolved.append(
            {
                "harnessConfig": dict(cast(dict[str, object], stage["harnessConfig"])),
                "steps": steps,
            }
        )
    return resolved


def _interpolate(
    text: str,
    *,
    declared_names: set[str],
    optional_names: set[str],
    rendered: dict[str, str],
    path: str,
) -> str | InvocationIssue:
    referenced = _INPUT_REFERENCE_PATTERN.findall(text)
    remaining = _INPUT_REFERENCE_PATTERN.sub("", text)
    if "{{" in remaining or "}}" in remaining:
        return InvocationIssue(
            code="invalid_workflow_definition",
            message="Templates may only use the exact form '{{inputs.name}}'.",
            path=path,
        )
    for name in referenced:
        if name not in declared_names:
            return InvocationIssue(
                code="invalid_workflow_definition",
                message=f"Template references unknown input '{name}'.",
                path=path,
            )
        if name not in rendered:
            if name in optional_names:
                return InvocationIssue(
                    code="workflow_optional_input_reference_missing",
                    message=(
                        f"Optional input '{name}' is referenced by this workflow "
                        "and must be provided."
                    ),
                    path=path,
                )
            return InvocationIssue(
                code="workflow_input_missing",
                message=f"Input '{name}' is required.",
                path=path,
            )
    return _INPUT_REFERENCE_PATTERN.sub(lambda match: rendered[match.group(1)], text)


def _render_scalar(value: WorkflowArgumentValue) -> str:
    if isinstance(value, str):
        return value
    # Booleans and numbers render exactly as their RFC 8785 canonical JSON
    # text ("true"/"false", ECMAScript number formatting).
    return canonical_json(value)


def build_resolved_bundle(
    *,
    run_id: UUID,
    definition_id: UUID,
    definition_revision: int,
    definition_schema_version: int,
    definition_title: str,
    definition_default_repo_config_id: UUID | None,
    validated_catalog_version: str,
    inputs_declaration: list[dict[str, object]],
    stages: list[dict[str, object]],
    arguments: dict[str, WorkflowArgumentValue],
    resolved_placement: dict[str, object],
    resolved_stages: list[dict[str, object]],
) -> dict[str, object]:
    """Assemble the immutable logical bundle (PR2 design §6.3)."""

    return {
        "contractVersion": 1,
        "runId": str(run_id),
        "definition": {
            "id": str(definition_id),
            "revision": definition_revision,
            "schemaVersion": definition_schema_version,
            "title": definition_title,
            "defaultRepoConfigId": (
                None
                if definition_default_repo_config_id is None
                else str(definition_default_repo_config_id)
            ),
            "validatedCatalogVersion": validated_catalog_version,
            "inputs": inputs_declaration,
            "stages": stages,
        },
        "arguments": dict(arguments),
        "resolvedPlacement": resolved_placement,
        "resolvedStages": resolved_stages,
    }


def request_hash(
    *,
    definition_id: UUID,
    expected_revision: int,
    arguments: dict[str, object],
    target: dict[str, object],
    logical_placement: dict[str, object],
) -> str:
    """Digest of the normalized caller request syntax (PR2 design §6.3).

    Computed before resolving mutable defaults so an idempotent replay is
    matched on what the caller asked for, not on what defaults resolved to.
    """

    return sha256_hex(
        {
            "definitionId": str(definition_id),
            "expectedRevision": expected_revision,
            "inputs": dict(arguments),
            "target": target,
            "placement": logical_placement,
        }
    )
