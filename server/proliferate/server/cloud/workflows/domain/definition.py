"""Pure workflow-definition schema and strict validation (spec 3.3).

Parses a raw definition dict into a normalized, canonical dict. Validation is
**strict**: unknown kinds and unknown fields are rejected. Template references are
validated to resolve (args must exist; a step-output reference must point at an
earlier step). The canonical dict is what gets stored in ``workflow_version``.
"""

from __future__ import annotations

from collections.abc import Iterator

from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_APPROVAL_ON_TIMEOUT,
    SUPPORTED_WORKFLOW_ARG_TYPES,
    SUPPORTED_WORKFLOW_GOAL_ON_BLOCKED,
    SUPPORTED_WORKFLOW_NOTIFY_CHANNELS,
    SUPPORTED_WORKFLOW_ON_FAIL_KINDS,
    SUPPORTED_WORKFLOW_SESSION_BINDINGS,
    SUPPORTED_WORKFLOW_STEP_KINDS,
    WORKFLOW_ARG_TYPE_ENUM,
    WORKFLOW_MAX_ARGS,
    WORKFLOW_MAX_STEPS,
    WORKFLOW_ON_FAIL_RETRY,
    WORKFLOW_ON_FAIL_STOP,
    WORKFLOW_SESSION_BINDING_FRESH,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
    WORKFLOW_STEP_AGENT_PROMPT,
    WORKFLOW_STEP_HUMAN_APPROVAL,
    WORKFLOW_STEP_NOTIFY,
    WORKFLOW_STEP_SCM_OPEN_PR,
    WORKFLOW_STEP_SHELL_RUN,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    TemplateReferenceError,
    validate_string_references,
)


class WorkflowDefinitionError(Exception):
    """Raised when a workflow definition is structurally invalid."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _err(code: str, message: str) -> WorkflowDefinitionError:
    return WorkflowDefinitionError(code, message)


def _require_dict(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _err("invalid_definition", f"'{field}' must be an object.")
    return value


def _reject_unknown_keys(obj: dict[str, object], allowed: set[str], *, field: str) -> None:
    unknown = set(obj) - allowed
    if unknown:
        raise _err("unknown_field", f"'{field}' has unknown field(s): {sorted(unknown)}.")


def _require_str(
    obj: dict[str, object], key: str, *, field: str, max_length: int | None = None
) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise _err(
            "invalid_definition", f"'{field}.{key}' is required and must be a non-empty string."
        )
    if max_length is not None and len(value) > max_length:
        raise _err(
            "invalid_definition", f"'{field}.{key}' must be at most {max_length} characters."
        )
    return value


def _optional_str(obj: dict[str, object], key: str, *, field: str) -> str | None:
    if key not in obj or obj[key] is None:
        return None
    value = obj[key]
    if not isinstance(value, str):
        raise _err("invalid_definition", f"'{field}.{key}' must be a string.")
    return value


def _optional_bool(obj: dict[str, object], key: str, *, field: str) -> bool | None:
    if key not in obj or obj[key] is None:
        return None
    value = obj[key]
    if not isinstance(value, bool):
        raise _err("invalid_definition", f"'{field}.{key}' must be a boolean.")
    return value


def _positive_int(obj: dict[str, object], key: str, *, field: str, required: bool) -> int | None:
    if key not in obj or obj[key] is None:
        if required:
            raise _err("invalid_definition", f"'{field}.{key}' is required.")
        return None
    value = obj[key]
    # bool is an int subclass; reject it explicitly.
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _err("invalid_definition", f"'{field}.{key}' must be a positive integer.")
    return value


def _int_field(obj: dict[str, object], key: str, *, field: str) -> int:
    value = obj.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise _err("invalid_definition", f"'{field}.{key}' is required and must be an integer.")
    return value


# --- args schema ---------------------------------------------------------------


def _parse_args(raw: object) -> tuple[list[dict[str, object]], list[ArgSpec]]:
    if raw is None:
        return [], []
    if not isinstance(raw, list):
        raise _err("invalid_definition", "'args' must be a list.")
    if len(raw) > WORKFLOW_MAX_ARGS:
        raise _err(
            "too_many_args", f"A workflow may declare at most {WORKFLOW_MAX_ARGS} arguments."
        )
    canonical: list[dict[str, object]] = []
    specs: list[ArgSpec] = []
    seen: set[str] = set()
    for item in raw:
        arg = _require_dict(item, field="args[]")
        _reject_unknown_keys(arg, {"name", "type", "default", "required", "enum"}, field="args[]")
        name = _require_str(arg, "name", field="args[]", max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH)
        if not name.replace("_", "").isalnum() or not (name[0].isalpha() or name[0] == "_"):
            raise _err("invalid_definition", f"Argument name '{name}' must be an identifier.")
        if name in seen:
            raise _err("duplicate_arg", f"Duplicate argument name '{name}'.")
        seen.add(name)
        arg_type = arg.get("type")
        if arg_type not in SUPPORTED_WORKFLOW_ARG_TYPES:
            raise _err(
                "invalid_definition", f"Argument '{name}' has unsupported type '{arg_type}'."
            )
        required = arg.get("required", False)
        if not isinstance(required, bool):
            raise _err(
                "invalid_definition", f"Argument '{name}' field 'required' must be a boolean."
            )
        enum_values: tuple[str, ...] = ()
        canonical_arg: dict[str, object] = {"name": name, "type": arg_type, "required": required}
        if arg_type == WORKFLOW_ARG_TYPE_ENUM:
            raw_enum = arg.get("enum")
            if not isinstance(raw_enum, list) or not raw_enum:
                raise _err(
                    "invalid_definition",
                    f"Enum argument '{name}' requires a non-empty 'enum' list.",
                )
            if not all(isinstance(v, str) and v for v in raw_enum):
                raise _err(
                    "invalid_definition",
                    f"Enum argument '{name}' values must be non-empty strings.",
                )
            enum_values = tuple(raw_enum)
            canonical_arg["enum"] = list(enum_values)
        elif "enum" in arg:
            raise _err(
                "unknown_field", f"Argument '{name}' declares 'enum' but is not an enum type."
            )
        has_default = "default" in arg and arg["default"] is not None
        default = arg.get("default")
        if has_default:
            if arg_type == WORKFLOW_ARG_TYPE_ENUM and default not in enum_values:
                raise _err(
                    "invalid_definition",
                    f"Default for enum argument '{name}' is not an allowed value.",
                )
            canonical_arg["default"] = default
        canonical.append(canonical_arg)
        specs.append(
            ArgSpec(
                name=name,
                type=str(arg_type),
                required=required,
                has_default=has_default,
                default=default,
                enum_values=enum_values,
            )
        )
    return canonical, specs


# --- setup ---------------------------------------------------------------------


def _parse_setup(raw: object) -> dict[str, object]:
    setup = _require_dict(raw, field="setup")
    _reject_unknown_keys(setup, {"harness", "model", "session_binding"}, field="setup")
    harness = _require_str(
        setup, "harness", field="setup", max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH
    )
    model = _require_str(setup, "model", field="setup", max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH)
    session_binding = setup.get("session_binding", WORKFLOW_SESSION_BINDING_FRESH)
    if session_binding not in SUPPORTED_WORKFLOW_SESSION_BINDINGS:
        allowed = sorted(SUPPORTED_WORKFLOW_SESSION_BINDINGS)
        raise _err(
            "invalid_definition",
            f"'setup.session_binding' must be one of {allowed}.",
        )
    return {"harness": harness, "model": model, "session_binding": session_binding}


# --- on_fail -------------------------------------------------------------------


def _parse_on_fail(raw: object, *, field: str) -> dict[str, object]:
    if raw is None:
        return {"kind": WORKFLOW_ON_FAIL_STOP}
    on_fail = _require_dict(raw, field=f"{field}.on_fail")
    _reject_unknown_keys(on_fail, {"kind", "n"}, field=f"{field}.on_fail")
    kind = on_fail.get("kind")
    if kind not in SUPPORTED_WORKFLOW_ON_FAIL_KINDS:
        raise _err(
            "invalid_definition",
            f"'{field}.on_fail.kind' must be one of {sorted(SUPPORTED_WORKFLOW_ON_FAIL_KINDS)}.",
        )
    if kind == WORKFLOW_ON_FAIL_RETRY:
        n = _positive_int(on_fail, "n", field=f"{field}.on_fail", required=True)
        return {"kind": kind, "n": n}
    if "n" in on_fail:
        raise _err("unknown_field", f"'{field}.on_fail.n' is only valid for retry.")
    return {"kind": kind}


# --- goal (agent.prompt) -------------------------------------------------------


def _parse_goal(raw: object, *, field: str) -> dict[str, object]:
    goal = _require_dict(raw, field=f"{field}.goal")
    _reject_unknown_keys(
        goal,
        {"objective", "max_turns", "max_wall_secs", "token_budget", "on_blocked", "verify"},
        field=f"{field}.goal",
    )
    objective = _require_str(goal, "objective", field=f"{field}.goal")
    max_turns = _positive_int(goal, "max_turns", field=f"{field}.goal", required=True)
    max_wall_secs = _positive_int(goal, "max_wall_secs", field=f"{field}.goal", required=True)
    token_budget = _positive_int(goal, "token_budget", field=f"{field}.goal", required=False)
    on_blocked = goal.get("on_blocked")
    if on_blocked not in SUPPORTED_WORKFLOW_GOAL_ON_BLOCKED:
        allowed = sorted(SUPPORTED_WORKFLOW_GOAL_ON_BLOCKED)
        raise _err(
            "invalid_definition",
            f"'{field}.goal.on_blocked' must be one of {allowed}.",
        )
    canonical: dict[str, object] = {
        "objective": objective,
        "max_turns": max_turns,
        "max_wall_secs": max_wall_secs,
        "on_blocked": on_blocked,
    }
    if token_budget is not None:
        canonical["token_budget"] = token_budget
    if "verify" in goal and goal["verify"] is not None:
        verify = _require_dict(goal["verify"], field=f"{field}.goal.verify")
        _reject_unknown_keys(verify, {"shell", "expect_exit"}, field=f"{field}.goal.verify")
        canonical["verify"] = {
            "shell": _require_str(verify, "shell", field=f"{field}.goal.verify"),
            "expect_exit": _int_field(verify, "expect_exit", field=f"{field}.goal.verify"),
        }
    return canonical


# --- steps ---------------------------------------------------------------------


def _parse_agent_prompt(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step,
        {"kind", "on_fail", "prompt", "model_override", "harness_override", "goal"},
        field=field,
    )
    canonical: dict[str, object] = {"prompt": _require_str(step, "prompt", field=field)}
    model_override = _optional_str(step, "model_override", field=field)
    if model_override is not None:
        canonical["model_override"] = model_override
    harness_override = _optional_str(step, "harness_override", field=field)
    if harness_override is not None:
        canonical["harness_override"] = harness_override
    if "goal" in step and step["goal"] is not None:
        canonical["goal"] = _parse_goal(step["goal"], field=field)
    return canonical


def _parse_shell_run(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step, {"kind", "on_fail", "command", "timeout_secs", "output_name"}, field=field
    )
    canonical: dict[str, object] = {"command": _require_str(step, "command", field=field)}
    timeout_secs = _positive_int(step, "timeout_secs", field=field, required=False)
    if timeout_secs is not None:
        canonical["timeout_secs"] = timeout_secs
    output_name = _optional_str(step, "output_name", field=field)
    if output_name is not None:
        if not output_name.replace("_", "").isalnum() or not (
            output_name[0].isalpha() or output_name[0] == "_"
        ):
            raise _err("invalid_definition", f"'{field}.output_name' must be an identifier.")
        canonical["output_name"] = output_name
    return canonical


def _parse_scm_open_pr(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(step, {"kind", "on_fail", "base", "title", "body", "draft"}, field=field)
    canonical: dict[str, object] = {"title": _require_str(step, "title", field=field)}
    base = _optional_str(step, "base", field=field)
    if base is not None:
        canonical["base"] = base
    body = _optional_str(step, "body", field=field)
    if body is not None:
        canonical["body"] = body
    draft = _optional_bool(step, "draft", field=field)
    if draft is not None:
        canonical["draft"] = draft
    return canonical


def _parse_notify(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(step, {"kind", "on_fail", "channel", "message"}, field=field)
    channel = step.get("channel")
    if channel not in SUPPORTED_WORKFLOW_NOTIFY_CHANNELS:
        raise _err(
            "invalid_definition",
            f"'{field}.channel' must be one of {sorted(SUPPORTED_WORKFLOW_NOTIFY_CHANNELS)}.",
        )
    return {"channel": channel, "message": _require_str(step, "message", field=field)}


def _parse_human_approval(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step, {"kind", "on_fail", "message", "on_timeout", "timeout_secs"}, field=field
    )
    on_timeout = step.get("on_timeout")
    if on_timeout not in SUPPORTED_WORKFLOW_APPROVAL_ON_TIMEOUT:
        allowed = sorted(SUPPORTED_WORKFLOW_APPROVAL_ON_TIMEOUT)
        raise _err(
            "invalid_definition",
            f"'{field}.on_timeout' must be one of {allowed}.",
        )
    canonical: dict[str, object] = {
        "message": _require_str(step, "message", field=field),
        "on_timeout": on_timeout,
    }
    timeout_secs = _positive_int(step, "timeout_secs", field=field, required=False)
    if timeout_secs is not None:
        canonical["timeout_secs"] = timeout_secs
    return canonical


_STEP_PARSERS = {
    WORKFLOW_STEP_AGENT_PROMPT: _parse_agent_prompt,
    WORKFLOW_STEP_SHELL_RUN: _parse_shell_run,
    WORKFLOW_STEP_SCM_OPEN_PR: _parse_scm_open_pr,
    WORKFLOW_STEP_NOTIFY: _parse_notify,
    WORKFLOW_STEP_HUMAN_APPROVAL: _parse_human_approval,
}


def _parse_steps(raw: object) -> list[dict[str, object]]:
    if not isinstance(raw, list) or not raw:
        raise _err("invalid_definition", "'steps' must be a non-empty list.")
    if len(raw) > WORKFLOW_MAX_STEPS:
        raise _err("too_many_steps", f"A workflow may declare at most {WORKFLOW_MAX_STEPS} steps.")
    canonical_steps: list[dict[str, object]] = []
    for index, item in enumerate(raw):
        field = f"steps[{index}]"
        step = _require_dict(item, field=field)
        kind = step.get("kind")
        if kind not in SUPPORTED_WORKFLOW_STEP_KINDS:
            raise _err(
                "unknown_step_kind", f"'{field}.kind' is not a supported step kind: {kind!r}."
            )
        parser = _STEP_PARSERS[kind]
        canonical: dict[str, object] = {
            "kind": kind,
            "on_fail": _parse_on_fail(step.get("on_fail"), field=field),
        }
        canonical.update(parser(step, field=field))
        canonical_steps.append(canonical)
    return canonical_steps


# --- template reference validation --------------------------------------------


def _iter_step_strings(step: dict[str, object]) -> Iterator[str]:
    """Yield every templated string field within a canonical step."""

    for key, value in step.items():
        if key in {"kind", "on_fail"}:
            continue
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for sub in value.values():
                if isinstance(sub, str):
                    yield sub


def _validate_references(steps: list[dict[str, object]], arg_names: frozenset[str]) -> None:
    for index, step in enumerate(steps):
        for value in _iter_step_strings(step):
            try:
                validate_string_references(value, arg_names=arg_names, step_index=index)
            except TemplateReferenceError as exc:
                raise _err(exc.code, exc.message) from exc


# --- public entrypoint ---------------------------------------------------------


def parse_definition(raw: object) -> tuple[dict[str, object], list[ArgSpec]]:
    """Validate a raw definition and return its canonical dict + parsed arg specs.

    Raises :class:`WorkflowDefinitionError` on any structural or reference problem.
    """

    definition = _require_dict(raw, field="definition")
    _reject_unknown_keys(definition, {"args", "setup", "steps"}, field="definition")
    canonical_args, arg_specs = _parse_args(definition.get("args"))
    setup = _parse_setup(definition.get("setup"))
    steps = _parse_steps(definition.get("steps"))
    _validate_references(steps, frozenset(spec.name for spec in arg_specs))
    canonical: dict[str, object] = {"args": canonical_args, "setup": setup, "steps": steps}
    return canonical, arg_specs
