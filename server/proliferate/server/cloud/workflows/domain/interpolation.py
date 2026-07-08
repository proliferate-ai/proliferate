"""Pure template interpolation and input coercion for workflow plans (format v2).

Stored template grammar (data-contract §1.3 / B6): every templated string field
may contain

    {{inputs.<name>}}          -> a workflow input (eager, resolved at StartRun)
    {{<emit_name>.<field>}}     -> a field of an earlier ``agent.emit`` step

``StartRun`` resolves ``{{inputs.*}}`` **eagerly** (the values are known at run
creation) and **rewrites** ``{{<emit>.<field>}}`` to the runtime's indexed form
``{{steps[<n>].output.<field>}}`` at flatten time — so the runtime keeps its
existing indexed grammar (templates.rs is unchanged) and never learns emit names.

Reserved first segments (never legal emit names): ``inputs``, ``steps``,
``fields``. ``steps`` is reserved so the rewrite target can never collide with an
emit name; ``fields`` is reserved for the notify agent-filled follow-up.

Escaping: substitution is segment-based and never re-scanned. A substituted input
value additionally has every ``{`` / ``}`` backslash-escaped so a value that
literally contains ``{{steps[0].output.x}}`` can never survive resolution as a
live step-output token (injection guard). The runtime unescapes ``\\{`` / ``\\}``
back to literal braces after its own step-output pass.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from proliferate.constants.workflows import (
    WORKFLOW_INPUT_TYPE_BOOLEAN,
    WORKFLOW_INPUT_TYPE_CHOICE,
    WORKFLOW_INPUT_TYPE_NUMBER,
    WORKFLOW_INPUT_TYPE_TEXT,
    WORKFLOW_RESERVED_REF_SEGMENTS,
)

# A placeholder is ``{{`` not preceded by a backslash, then a reference, then
# ``}}``. References never contain braces, so ``[^{}]`` keeps matching greedy-safe.
_PLACEHOLDER_RE = re.compile(r"(?<!\\)\{\{\s*(?P<ref>[^{}]*?)\s*\}\}")
_INPUT_REF_RE = re.compile(r"^inputs\.(?P<name>[A-Za-z_][A-Za-z0-9_]*)$")
# {{<emit_name>.<field>}} — a two-segment ref whose first segment is not reserved.
_EMIT_REF_RE = re.compile(
    r"^(?P<emit>[A-Za-z_][A-Za-z0-9_]*)\.(?P<field>[A-Za-z_][A-Za-z0-9_]*)$"
)
# The runtime's indexed form — the *output* of the rewrite, kept parseable so a
# rewritten string still validates and re-emits verbatim.
_STEP_REF_RE = re.compile(r"^steps\[(?P<index>\d+)\]\.output\.(?P<name>[A-Za-z_][A-Za-z0-9_]*)$")


class TemplateReferenceError(Exception):
    """Raised when a template placeholder is malformed or resolves nowhere."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class InputReference:
    name: str


@dataclass(frozen=True)
class EmitReference:
    emit: str
    field: str


@dataclass(frozen=True)
class StepOutputReference:
    index: int
    name: str


Reference = InputReference | EmitReference | StepOutputReference


def parse_reference(ref: str) -> Reference:
    """Parse a placeholder body into a typed reference, or raise."""

    input_match = _INPUT_REF_RE.match(ref)
    if input_match is not None:
        return InputReference(name=input_match.group("name"))
    step_match = _STEP_REF_RE.match(ref)
    if step_match is not None:
        return StepOutputReference(
            index=int(step_match.group("index")),
            name=step_match.group("name"),
        )
    emit_match = _EMIT_REF_RE.match(ref)
    if emit_match is not None:
        emit = emit_match.group("emit")
        if emit in WORKFLOW_RESERVED_REF_SEGMENTS:
            raise TemplateReferenceError(
                "invalid_template_reference",
                f"'{{{{{ref}}}}}' uses reserved first segment '{emit}'.",
            )
        return EmitReference(emit=emit, field=emit_match.group("field"))
    raise TemplateReferenceError(
        "invalid_template_reference",
        f"'{{{{{ref}}}}}' is not a valid template reference "
        "(expected {{inputs.NAME}} or {{EMIT.FIELD}}).",
    )


def iter_references(value: str) -> list[Reference]:
    """Return every typed reference found in a string, in order."""

    return [parse_reference(match.group("ref")) for match in _PLACEHOLDER_RE.finditer(value)]


def validate_string_references(
    value: str,
    *,
    input_names: frozenset[str],
    prior_emit_names: frozenset[str],
) -> None:
    """Validate every placeholder in one stored (pre-resolution) step string field.

    ``prior_emit_names`` is the set of ``agent.emit`` names that appear strictly
    before this field's step in run order (earlier spine nodes in full, earlier
    steps in the same node) — the visibility rule (data-contract §1.3). An emit
    ref must name one of them; an input ref must name a declared input. Indexed
    step-output refs are illegal in stored definitions (they are the resolver's
    output, not an authored form).
    """

    for reference in iter_references(value):
        if isinstance(reference, InputReference):
            if reference.name not in input_names:
                raise TemplateReferenceError(
                    "unknown_input_reference",
                    f"Template references unknown input '{reference.name}'.",
                )
        elif isinstance(reference, EmitReference):
            if reference.emit not in prior_emit_names:
                raise TemplateReferenceError(
                    "forward_emit_reference",
                    (
                        f"Template references emit '{reference.emit}', which is not "
                        "produced by an earlier step in run order."
                    ),
                )
        else:  # StepOutputReference
            raise TemplateReferenceError(
                "invalid_template_reference",
                "Indexed step-output references are not allowed in a stored definition; "
                "use {{EMIT.FIELD}}.",
            )


# --- Input coercion ------------------------------------------------------------


class ArgumentError(Exception):
    """Raised when provided run inputs do not satisfy the inputs schema."""

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
        raise ArgumentError("invalid_argument", f"Input '{name}' must be a number.")
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            if value.strip().lstrip("+-").isdigit():
                return int(value)
            return float(value)
        except ValueError as exc:
            raise ArgumentError(
                "invalid_argument", f"Input '{name}' must be a number."
            ) from exc
    raise ArgumentError("invalid_argument", f"Input '{name}' must be a number.")


def _coerce_boolean(name: str, value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in {"true", "false"}:
        return value.strip().lower() == "true"
    raise ArgumentError("invalid_argument", f"Input '{name}' must be a boolean.")


def _coerce_one(spec: ArgSpec, value: object) -> object:
    if spec.type == WORKFLOW_INPUT_TYPE_TEXT:
        if isinstance(value, (dict, list)):
            raise ArgumentError("invalid_argument", f"Input '{spec.name}' must be text.")
        return value if isinstance(value, str) else str(value)
    if spec.type == WORKFLOW_INPUT_TYPE_NUMBER:
        return _coerce_number(spec.name, value)
    if spec.type == WORKFLOW_INPUT_TYPE_BOOLEAN:
        return _coerce_boolean(spec.name, value)
    if spec.type == WORKFLOW_INPUT_TYPE_CHOICE:
        text = value if isinstance(value, str) else str(value)
        if text not in spec.enum_values:
            raise ArgumentError(
                "invalid_argument",
                f"Input '{spec.name}' must be one of {list(spec.enum_values)}.",
            )
        return text
    raise ArgumentError("invalid_argument", f"Input '{spec.name}' has an unknown type.")


def coerce_arguments(arg_specs: list[ArgSpec], provided: dict[str, object]) -> dict[str, object]:
    """Coerce and validate provided run inputs against the inputs schema.

    Rejects unknown inputs (strict), fills defaults, enforces required, and
    coerces each value to its declared type.
    """

    known = {spec.name for spec in arg_specs}
    unknown = set(provided) - known
    if unknown:
        raise ArgumentError(
            "unknown_argument",
            f"Unknown workflow input(s): {sorted(unknown)}.",
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
                f"Required workflow input '{spec.name}' was not provided.",
            )
    return resolved


# --- Eager inputs interpolation + emit-ref rewrite -----------------------------


def _escape_braces(rendered: str) -> str:
    return rendered.replace("{", "\\{").replace("}", "\\}")


def _render_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def resolve_string(
    value: str,
    *,
    inputs: dict[str, object],
    emit_index: dict[str, int],
) -> str:
    """Resolve one templated string at flatten time (the resolver's single pass).

    - ``{{inputs.*}}`` is interpolated eagerly (values brace-escaped so they can
      never introduce a new live token).
    - ``{{<emit>.<field>}}`` is rewritten to ``{{steps[<n>].output.<field>}}``
      using ``emit_index`` (emit name -> flattened step index). The runtime
      late-binds the indexed form.

    Segment-based (no re-scanning): replacements are concatenated as literal text.
    """

    out: list[str] = []
    last = 0
    for match in _PLACEHOLDER_RE.finditer(value):
        out.append(value[last : match.start()])
        reference = parse_reference(match.group("ref"))
        if isinstance(reference, InputReference):
            out.append(_escape_braces(_render_scalar(inputs[reference.name])))
        elif isinstance(reference, EmitReference):
            index = emit_index[reference.emit]
            out.append(f"{{{{steps[{index}].output.{reference.field}}}}}")
        else:  # already-indexed StepOutputReference — re-emit canonical
            out.append(f"{{{{steps[{reference.index}].output.{reference.name}}}}}")
        last = match.end()
    out.append(value[last:])
    return "".join(out)


def resolve_value(
    value: object,
    *,
    inputs: dict[str, object],
    emit_index: dict[str, int],
) -> object:
    """Recursively resolve every string within a JSON value (see ``resolve_string``)."""

    if isinstance(value, str):
        return resolve_string(value, inputs=inputs, emit_index=emit_index)
    if isinstance(value, list):
        return [resolve_value(item, inputs=inputs, emit_index=emit_index) for item in value]
    if isinstance(value, dict):
        return {
            key: resolve_value(item, inputs=inputs, emit_index=emit_index)
            for key, item in value.items()
        }
    return value
