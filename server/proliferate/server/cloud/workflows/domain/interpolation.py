"""Pure template interpolation and argument coercion for workflow plans.

Template placeholder grammar (spec 3.3): every templated string field may contain

    {{args.<name>}}              -> a workflow argument
    {{steps[<n>].output.<name>}} -> the public output of an earlier step

``StartRun`` resolves ``{{args.*}}`` **eagerly** (the values are known at run
creation) and leaves ``{{steps[n].output.*}}`` **late-bound** for the runtime.

Escaping: substitution is segment-based and never re-scanned. A substituted arg
value additionally has every ``{`` / ``}`` backslash-escaped so a value that
literally contains ``{{steps[0].output.x}}`` can never survive resolution as a
live step-output token (injection guard). The runtime unescapes ``\\{`` / ``\\}``
back to literal braces after its own step-output pass.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from proliferate.constants.workflows import (
    WORKFLOW_ARG_TYPE_BOOLEAN,
    WORKFLOW_ARG_TYPE_ENUM,
    WORKFLOW_ARG_TYPE_NUMBER,
    WORKFLOW_ARG_TYPE_STRING,
)

# A placeholder is ``{{`` not preceded by a backslash, then a reference, then
# ``}}``. References never contain braces, so ``[^{}]`` keeps matching greedy-safe.
_PLACEHOLDER_RE = re.compile(r"(?<!\\)\{\{\s*(?P<ref>[^{}]*?)\s*\}\}")
_ARG_REF_RE = re.compile(r"^args\.(?P<name>[A-Za-z_][A-Za-z0-9_]*)$")
_STEP_REF_RE = re.compile(r"^steps\[(?P<index>\d+)\]\.output\.(?P<name>[A-Za-z_][A-Za-z0-9_]*)$")


class TemplateReferenceError(Exception):
    """Raised when a template placeholder is malformed or resolves nowhere."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ArgReference:
    name: str


@dataclass(frozen=True)
class StepOutputReference:
    index: int
    name: str


Reference = ArgReference | StepOutputReference


def parse_reference(ref: str) -> Reference:
    """Parse a placeholder body into a typed reference, or raise."""

    arg_match = _ARG_REF_RE.match(ref)
    if arg_match is not None:
        return ArgReference(name=arg_match.group("name"))
    step_match = _STEP_REF_RE.match(ref)
    if step_match is not None:
        return StepOutputReference(
            index=int(step_match.group("index")),
            name=step_match.group("name"),
        )
    raise TemplateReferenceError(
        "invalid_template_reference",
        f"'{{{{{ref}}}}}' is not a valid template reference "
        "(expected {{args.NAME}} or {{steps[N].output.NAME}}).",
    )


def iter_references(value: str) -> list[Reference]:
    """Return every typed reference found in a string, in order."""

    return [parse_reference(match.group("ref")) for match in _PLACEHOLDER_RE.finditer(value)]


def validate_string_references(
    value: str,
    *,
    arg_names: frozenset[str],
    step_index: int,
) -> None:
    """Validate every placeholder in one step string field.

    ``step_index`` is the index of the step the field belongs to; a step-output
    reference must point strictly earlier (``index < step_index``). Setup fields
    pass ``step_index=0`` so any step-output reference is rejected.
    """

    for reference in iter_references(value):
        if isinstance(reference, ArgReference):
            if reference.name not in arg_names:
                raise TemplateReferenceError(
                    "unknown_arg_reference",
                    f"Template references unknown argument '{reference.name}'.",
                )
        else:
            if reference.index >= step_index:
                raise TemplateReferenceError(
                    "forward_step_reference",
                    (
                        f"Step {step_index} references output of step "
                        f"{reference.index}, which does not run before it."
                    ),
                )
            if reference.index < 0:
                raise TemplateReferenceError(
                    "invalid_step_reference",
                    "Step output reference index must be non-negative.",
                )


# --- Argument coercion ---------------------------------------------------------


class ArgumentError(Exception):
    """Raised when provided run arguments do not satisfy the args schema."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ArgSpec:
    name: str
    type: str
    required: bool
    has_default: bool
    default: object
    enum_values: tuple[str, ...]


def _coerce_number(name: str, value: object) -> float | int:
    if isinstance(value, bool):
        raise ArgumentError("invalid_argument", f"Argument '{name}' must be a number.")
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            if value.strip().lstrip("+-").isdigit():
                return int(value)
            return float(value)
        except ValueError as exc:
            raise ArgumentError(
                "invalid_argument", f"Argument '{name}' must be a number."
            ) from exc
    raise ArgumentError("invalid_argument", f"Argument '{name}' must be a number.")


def _coerce_boolean(name: str, value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in {"true", "false"}:
        return value.strip().lower() == "true"
    raise ArgumentError("invalid_argument", f"Argument '{name}' must be a boolean.")


def _coerce_one(spec: ArgSpec, value: object) -> object:
    if spec.type == WORKFLOW_ARG_TYPE_STRING:
        if isinstance(value, (dict, list)):
            raise ArgumentError("invalid_argument", f"Argument '{spec.name}' must be a string.")
        return value if isinstance(value, str) else str(value)
    if spec.type == WORKFLOW_ARG_TYPE_NUMBER:
        return _coerce_number(spec.name, value)
    if spec.type == WORKFLOW_ARG_TYPE_BOOLEAN:
        return _coerce_boolean(spec.name, value)
    if spec.type == WORKFLOW_ARG_TYPE_ENUM:
        text = value if isinstance(value, str) else str(value)
        if text not in spec.enum_values:
            raise ArgumentError(
                "invalid_argument",
                f"Argument '{spec.name}' must be one of {list(spec.enum_values)}.",
            )
        return text
    raise ArgumentError("invalid_argument", f"Argument '{spec.name}' has an unknown type.")


def coerce_arguments(arg_specs: list[ArgSpec], provided: dict[str, object]) -> dict[str, object]:
    """Coerce and validate provided run arguments against the args schema.

    Rejects unknown arguments (strict), fills defaults, enforces required, and
    coerces each value to its declared type.
    """

    known = {spec.name for spec in arg_specs}
    unknown = set(provided) - known
    if unknown:
        raise ArgumentError(
            "unknown_argument",
            f"Unknown workflow argument(s): {sorted(unknown)}.",
        )
    resolved: dict[str, object] = {}
    for spec in arg_specs:
        if spec.name in provided:
            resolved[spec.name] = _coerce_one(spec, provided[spec.name])
        elif spec.has_default:
            resolved[spec.name] = _coerce_one(spec, spec.default)
        elif spec.required:
            raise ArgumentError(
                "missing_argument",
                f"Required workflow argument '{spec.name}' was not provided.",
            )
    return resolved


# --- Eager args interpolation --------------------------------------------------


def _escape_braces(rendered: str) -> str:
    return rendered.replace("{", "\\{").replace("}", "\\}")


def _render_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def interpolate_args_in_string(value: str, args: dict[str, object]) -> str:
    """Replace ``{{args.*}}`` with coerced values; keep step-output tokens verbatim.

    Segment-based (no re-scanning): replacements are concatenated as literal text.
    Arg values are brace-escaped so they cannot introduce new live tokens.
    """

    out: list[str] = []
    last = 0
    for match in _PLACEHOLDER_RE.finditer(value):
        out.append(value[last : match.start()])
        reference = parse_reference(match.group("ref"))
        if isinstance(reference, ArgReference):
            out.append(_escape_braces(_render_scalar(args[reference.name])))
        else:
            # Re-emit in canonical form for the runtime's late-bound pass.
            out.append(f"{{{{steps[{reference.index}].output.{reference.name}}}}}")
        last = match.end()
    out.append(value[last:])
    return "".join(out)


def interpolate_args(value: object, args: dict[str, object]) -> object:
    """Recursively interpolate ``{{args.*}}`` in every string within a JSON value."""

    if isinstance(value, str):
        return interpolate_args_in_string(value, args)
    if isinstance(value, list):
        return [interpolate_args(item, args) for item in value]
    if isinstance(value, dict):
        return {key: interpolate_args(item, args) for key, item in value.items()}
    return value
