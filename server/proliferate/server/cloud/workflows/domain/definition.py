"""Workflow-definition schema and strict validation — format v2 (data-contract §1).

Parses a raw definition dict into a normalized, canonical dict. The v2 top-level
shape is ``{version, name?, description?, inputs, integrations, agents}``: an
ordered spine of *agent nodes* (``{slot, harness, model, steps}``), each running
its steps in one session. There is no top-level ``steps`` and no ``setup`` — slot
= session affinity, and ``session_binding`` is a run-context property stamped by
``domain.resolved_plan.resolve_plan``, never authored here.

Validation is **strict**: unknown kinds and unknown fields are rejected. Template
references (``{{inputs.<name>}}`` / ``{{<emit>.<field>}}``) are validated for
existence and *strictly-prior* run-order visibility. The canonical dict is what
gets stored in ``workflow_version.definition_json``.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterator

from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_BRANCH_TARGETS,
    SUPPORTED_WORKFLOW_GOAL_ON_BLOCKED,
    SUPPORTED_WORKFLOW_INPUT_TYPES,
    SUPPORTED_WORKFLOW_NOTIFY_FIELD_TYPES,
    SUPPORTED_WORKFLOW_ON_FAIL_KINDS,
    SUPPORTED_WORKFLOW_STEP_KINDS,
    WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS,
    WORKFLOW_INPUT_TYPE_CHOICE,
    WORKFLOW_MAX_AGENTS,
    WORKFLOW_MAX_ARGS,
    WORKFLOW_MAX_STEPS,
    WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX,
    WORKFLOW_ON_FAIL_RETRY,
    WORKFLOW_ON_FAIL_STOP,
    WORKFLOW_RESERVED_REF_SEGMENTS,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
    WORKFLOW_STEP_AGENT_CONFIG,
    WORKFLOW_STEP_AGENT_EMIT,
    WORKFLOW_STEP_AGENT_PROMPT,
    WORKFLOW_STEP_BRANCH,
    WORKFLOW_STEP_NOTIFY,
    WORKFLOW_STEP_SCM_OPEN_PR,
    WORKFLOW_STEP_SHELL_RUN,
    WORKFLOW_STEP_WORKFLOW_INCLUDE,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    EmitReference,
    TemplateReferenceError,
    iter_references,
    validate_string_references,
)

_SLOT_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class WorkflowDefinitionError(Exception):
    """Raised when a workflow definition is structurally invalid."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _err(code: str, message: str) -> WorkflowDefinitionError:
    return WorkflowDefinitionError(code, message)


def _reject_reserved_ref_name(name: str, *, field: str) -> None:
    """A ref-namespace name (emit / include handle) must avoid reserved segments
    and the resolver-owned notify-fields emit prefix."""

    if name in WORKFLOW_RESERVED_REF_SEGMENTS:
        raise _err(
            "invalid_definition",
            f"'{field}' '{name}' is a reserved reference segment.",
        )
    if name.startswith(WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX):
        raise _err(
            "invalid_definition",
            f"'{field}' '{name}' uses the reserved '{WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX}' prefix.",
        )


# An input-mapping key on a ``workflow.include`` step: an identifier that must
# name a declared child input (coverage checked in ``composition``).
_ARG_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


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


def _optional_label(step: dict[str, object], *, field: str) -> str | None:
    label = _optional_str(step, "label", field=field)
    if label is not None and len(label) > WORKFLOW_SHORT_TEXT_MAX_LENGTH:
        raise _err(
            "invalid_definition",
            f"'{field}.label' must be at most {WORKFLOW_SHORT_TEXT_MAX_LENGTH} characters.",
        )
    return label


# --- inputs schema -------------------------------------------------------------


def _parse_inputs(raw: object) -> tuple[list[dict[str, object]], list[ArgSpec]]:
    if raw is None:
        return [], []
    if not isinstance(raw, list):
        raise _err("invalid_definition", "'inputs' must be a list.")
    if len(raw) > WORKFLOW_MAX_ARGS:
        raise _err("too_many_args", f"A workflow may declare at most {WORKFLOW_MAX_ARGS} inputs.")
    canonical: list[dict[str, object]] = []
    specs: list[ArgSpec] = []
    seen: set[str] = set()
    for item in raw:
        inp = _require_dict(item, field="inputs[]")
        _reject_unknown_keys(
            inp, {"name", "type", "default", "required", "choices"}, field="inputs[]"
        )
        name = _require_str(
            inp, "name", field="inputs[]", max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH
        )
        if not _IDENTIFIER_RE.match(name):
            raise _err("invalid_definition", f"Input name '{name}' must be an identifier.")
        if name in seen:
            raise _err("duplicate_arg", f"Duplicate input name '{name}'.")
        seen.add(name)
        input_type = inp.get("type")
        if input_type not in SUPPORTED_WORKFLOW_INPUT_TYPES:
            raise _err(
                "invalid_definition", f"Input '{name}' has unsupported type '{input_type}'."
            )
        required = inp.get("required", False)
        if not isinstance(required, bool):
            raise _err("invalid_definition", f"Input '{name}' field 'required' must be a boolean.")
        enum_values: tuple[str, ...] = ()
        canonical_input: dict[str, object] = {
            "name": name,
            "type": input_type,
            "required": required,
        }
        if input_type == WORKFLOW_INPUT_TYPE_CHOICE:
            raw_choices = inp.get("choices")
            if not isinstance(raw_choices, list) or not raw_choices:
                raise _err(
                    "invalid_definition",
                    f"Choice input '{name}' requires a non-empty 'choices' list.",
                )
            if not all(isinstance(v, str) and v for v in raw_choices):
                raise _err(
                    "invalid_definition",
                    f"Choice input '{name}' values must be non-empty strings.",
                )
            enum_values = tuple(raw_choices)
            canonical_input["choices"] = list(enum_values)
        elif "choices" in inp:
            raise _err(
                "unknown_field", f"Input '{name}' declares 'choices' but is not a choice type."
            )
        has_default = "default" in inp and inp["default"] is not None
        default = inp.get("default")
        if has_default:
            if input_type == WORKFLOW_INPUT_TYPE_CHOICE and default not in enum_values:
                raise _err(
                    "invalid_definition",
                    f"Default for choice input '{name}' is not an allowed value.",
                )
            canonical_input["default"] = default
        canonical.append(canonical_input)
        specs.append(
            ArgSpec(
                name=name,
                type=str(input_type),
                required=required,
                has_default=has_default,
                default=default,
                enum_values=enum_values,
            )
        )
    return canonical, specs


# --- integrations (namespace-only, E3) -----------------------------------------


def _parse_integrations(raw: object) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise _err("invalid_definition", "'integrations' must be a list of namespace strings.")
    seen: set[str] = set()
    canonical: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise _err(
                "invalid_definition", "Each integration must be a non-empty namespace string."
            )
        if not _IDENTIFIER_RE.match(item):
            raise _err(
                "invalid_definition", f"Integration namespace '{item}' must be an identifier."
            )
        if item in seen:
            raise _err("duplicate_integration", f"Duplicate integration '{item}'.")
        seen.add(item)
        canonical.append(item)
    return canonical


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


# --- required_invocation (agent.prompt gate, §6) -------------------------------


def _parse_required_invocation(raw: object, *, field: str) -> dict[str, object]:
    inv = _require_dict(raw, field=f"{field}.required_invocation")
    _reject_unknown_keys(inv, {"provider", "tool"}, field=f"{field}.required_invocation")
    return {
        "provider": _require_str(inv, "provider", field=f"{field}.required_invocation"),
        "tool": _require_str(inv, "tool", field=f"{field}.required_invocation"),
    }


# --- steps ---------------------------------------------------------------------


def _parse_agent_prompt(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step,
        {"kind", "on_fail", "label", "prompt", "goal", "required_invocation"},
        field=field,
    )
    canonical: dict[str, object] = {"prompt": _require_str(step, "prompt", field=field)}
    if "goal" in step and step["goal"] is not None:
        canonical["goal"] = _parse_goal(step["goal"], field=field)
    if "required_invocation" in step and step["required_invocation"] is not None:
        canonical["required_invocation"] = _parse_required_invocation(
            step["required_invocation"], field=field
        )
    return canonical


def _parse_agent_emit(step: dict[str, object], *, field: str) -> dict[str, object]:
    """Write-output step: prompts, then captures a named, schema-shaped output.

    ``name`` is REQUIRED (it is the output handle refs address); ``max_attempts``
    is the re-ask budget (default 3).
    """

    _reject_unknown_keys(
        step,
        {"kind", "on_fail", "label", "prompt", "name", "output_schema", "max_attempts"},
        field=field,
    )
    name = _require_str(step, "name", field=field)
    if not _IDENTIFIER_RE.match(name):
        raise _err("invalid_definition", f"'{field}.name' must be an identifier.")
    _reject_reserved_ref_name(name, field=f"{field}.name")
    canonical: dict[str, object] = {
        "prompt": _require_str(step, "prompt", field=field),
        "name": name,
        "max_attempts": _positive_int(step, "max_attempts", field=field, required=False)
        or WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS,
    }
    if "output_schema" in step and step["output_schema"] is not None:
        canonical["output_schema"] = _require_dict(
            step["output_schema"], field=f"{field}.output_schema"
        )
    return canonical


def _parse_agent_config(step: dict[str, object], *, field: str) -> dict[str, object]:
    """Switch-model step: narrows to ``{model}`` only (same-harness rule).

    Harness never changes mid-slot — a different harness is a different slot (A4).
    """

    _reject_unknown_keys(step, {"kind", "on_fail", "label", "model"}, field=field)
    model = _require_str(step, "model", field=field)
    return {"model": model}


def _parse_shell_run(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step, {"kind", "on_fail", "label", "command", "timeout_secs", "output_name"}, field=field
    )
    canonical: dict[str, object] = {"command": _require_str(step, "command", field=field)}
    timeout_secs = _positive_int(step, "timeout_secs", field=field, required=False)
    if timeout_secs is not None:
        canonical["timeout_secs"] = timeout_secs
    output_name = _optional_str(step, "output_name", field=field)
    if output_name is not None:
        if not _IDENTIFIER_RE.match(output_name):
            raise _err("invalid_definition", f"'{field}.output_name' must be an identifier.")
        canonical["output_name"] = output_name
    return canonical


def _parse_scm_open_pr(step: dict[str, object], *, field: str) -> dict[str, object]:
    _reject_unknown_keys(
        step, {"kind", "on_fail", "label", "base", "title", "body", "draft"}, field=field
    )
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
    """Slack-only notify (E1b): ``{slack_channel_id, message}``.

    v1 is template-only. The optional ``agent_fields`` block (track 3c) lets an
    agent fill named fields the ``message`` references as ``{{fields.<name>}}``:
    a slot + a flat scalar schema. The resolver expands a notify-with-agent_fields
    into an injected ``agent.emit`` (in that slot) followed by the notify, whose
    ``{{fields.*}}`` late-bind to the injected emit's output.
    """

    _reject_unknown_keys(
        step,
        {"kind", "on_fail", "label", "message", "slack_channel_id", "agent_fields"},
        field=field,
    )
    canonical: dict[str, object] = {
        "slack_channel_id": _require_str(step, "slack_channel_id", field=field),
        "message": _require_str(step, "message", field=field),
    }
    if "agent_fields" in step and step["agent_fields"] is not None:
        canonical["agent_fields"] = _parse_notify_agent_fields(step["agent_fields"], field=field)
    return canonical


def _parse_notify_agent_fields(raw: object, *, field: str) -> dict[str, object]:
    """Parse a notify ``agent_fields`` block: ``{slot, schema}``.

    ``slot`` names the agent that fills the fields (existence is checked in the
    spine walk, which knows every slot). ``schema`` is a **flat** object mapping an
    identifier field name to ``{type, description?}`` where ``type`` is one of the
    scalar notify-field types (string/number/boolean) — nested objects/arrays are
    rejected so the injected emit's ``output_schema`` stays a flat contract.
    """

    agent_fields = _require_dict(raw, field=f"{field}.agent_fields")
    _reject_unknown_keys(agent_fields, {"slot", "schema"}, field=f"{field}.agent_fields")
    slot = _require_str(agent_fields, "slot", field=f"{field}.agent_fields")
    if not _SLOT_RE.match(slot):
        raise _err(
            "invalid_definition",
            f"'{field}.agent_fields.slot' '{slot}' must match ^[a-z][a-z0-9_]*$.",
        )
    raw_schema = agent_fields.get("schema")
    if not isinstance(raw_schema, dict) or not raw_schema:
        raise _err(
            "invalid_definition",
            f"'{field}.agent_fields.schema' must be a non-empty object of named fields.",
        )
    schema: dict[str, object] = {}
    for name, spec in raw_schema.items():
        if not isinstance(name, str) or not _IDENTIFIER_RE.match(name):
            raise _err(
                "invalid_definition",
                f"'{field}.agent_fields.schema' field name '{name}' must be an identifier.",
            )
        spec_field = f"{field}.agent_fields.schema['{name}']"
        spec_dict = _require_dict(spec, field=spec_field)
        _reject_unknown_keys(spec_dict, {"type", "description"}, field=spec_field)
        field_type = spec_dict.get("type")
        if field_type not in SUPPORTED_WORKFLOW_NOTIFY_FIELD_TYPES:
            raise _err(
                "invalid_definition",
                f"'{spec_field}.type' must be one of "
                f"{sorted(SUPPORTED_WORKFLOW_NOTIFY_FIELD_TYPES)}.",
            )
        canonical_spec: dict[str, object] = {"type": field_type}
        description = _optional_str(spec_dict, "description", field=spec_field)
        if description is not None:
            canonical_spec["description"] = description
        schema[name] = canonical_spec
    return {"slot": slot, "schema": schema}


def _parse_branch(step: dict[str, object], *, field: str) -> dict[str, object]:
    """Branch step (C11/D3): switch on a prior emit's field; each case is
    continue|end (narrowed from arbitrary goto)."""

    _reject_unknown_keys(step, {"kind", "on_fail", "label", "on", "cases", "reason"}, field=field)
    on = _require_str(step, "on", field=field)
    raw_cases = step.get("cases")
    if not isinstance(raw_cases, dict) or not raw_cases:
        raise _err("invalid_definition", f"'{field}.cases' must be a non-empty object.")
    cases: dict[str, object] = {}
    for value, target in raw_cases.items():
        target_dict = _require_dict(target, field=f"{field}.cases['{value}']")
        _reject_unknown_keys(target_dict, {"to"}, field=f"{field}.cases['{value}']")
        to = target_dict.get("to")
        if to not in SUPPORTED_WORKFLOW_BRANCH_TARGETS:
            raise _err(
                "invalid_definition",
                f"'{field}.cases['{value}'].to' must be one of "
                f"{sorted(SUPPORTED_WORKFLOW_BRANCH_TARGETS)}.",
            )
        cases[value] = {"to": to}
    canonical: dict[str, object] = {"on": on, "cases": cases}
    reason = _optional_str(step, "reason", field=field)
    if reason is not None:
        canonical["reason"] = reason
    return canonical


def _parse_workflow_include(step: dict[str, object], *, field: str) -> dict[str, object]:
    """Composition step (spec 3.5 / L20): inline another workflow's steps.

    Definition-only: the target workflow's CURRENT version's (single agent node's)
    steps are spliced into THIS agent node by the server's resolver at
    ``StartRun``, before delivery — the runtime never sees a ``workflow.include``
    step. ``args`` maps the child's declared input names to templated strings
    written in THIS workflow's context (so they may reference the parent's
    ``{{inputs.*}}`` / ``{{<emit>.<field>}}``); the resolver binds them into the
    child's ``{{inputs.*}}`` tokens (§3.5 obl. a).

    Structural validation only here: the target's existence / ownership / archive
    state and the arg-coverage + cycle checks need the DB and live in the service
    layer (``composition.validate_includes``).
    """

    _reject_unknown_keys(step, {"kind", "on_fail", "name", "workflow_id", "args"}, field=field)
    workflow_id = _require_str(step, "workflow_id", field=field)
    try:
        uuid.UUID(workflow_id)
    except ValueError as exc:
        raise _err("invalid_definition", f"'{field}.workflow_id' must be a UUID.") from exc
    raw_args = step.get("args", {})
    if raw_args is None:
        raw_args = {}
    if not isinstance(raw_args, dict):
        raise _err("invalid_definition", f"'{field}.args' must be an object.")
    args: dict[str, object] = {}
    for key, value in raw_args.items():
        if not isinstance(key, str) or not _ARG_NAME_RE.match(key):
            raise _err("invalid_definition", f"'{field}.args' keys must be argument identifiers.")
        if not isinstance(value, str):
            raise _err(
                "invalid_definition",
                f"'{field}.args.{key}' must be a template string.",
            )
        args[key] = value
    canonical: dict[str, object] = {"workflow_id": workflow_id, "args": args}
    # ``name`` is the include handle: it prefixes the child's emit names at
    # resolution (composition) and reserves a slot in the emit namespace so a
    # parent ref that targets it is rejected (include_step_reference).
    name = _optional_str(step, "name", field=field)
    if name is not None:
        if not _IDENTIFIER_RE.match(name):
            raise _err("invalid_definition", f"'{field}.name' must be an identifier.")
        _reject_reserved_ref_name(name, field=f"{field}.name")
        canonical["name"] = name
    return canonical


_STEP_PARSERS = {
    WORKFLOW_STEP_AGENT_CONFIG: _parse_agent_config,
    WORKFLOW_STEP_AGENT_PROMPT: _parse_agent_prompt,
    WORKFLOW_STEP_AGENT_EMIT: _parse_agent_emit,
    WORKFLOW_STEP_SHELL_RUN: _parse_shell_run,
    WORKFLOW_STEP_SCM_OPEN_PR: _parse_scm_open_pr,
    WORKFLOW_STEP_NOTIFY: _parse_notify,
    WORKFLOW_STEP_BRANCH: _parse_branch,
    WORKFLOW_STEP_WORKFLOW_INCLUDE: _parse_workflow_include,
}


def _parse_step(item: object, *, field: str) -> dict[str, object]:
    step = _require_dict(item, field=field)
    kind = step.get("kind")
    if kind not in SUPPORTED_WORKFLOW_STEP_KINDS:
        raise _err("unknown_step_kind", f"'{field}.kind' is not a supported step kind: {kind!r}.")
    parser = _STEP_PARSERS[kind]
    canonical: dict[str, object] = {
        "kind": kind,
        "on_fail": _parse_on_fail(step.get("on_fail"), field=field),
    }
    label = _optional_label(step, field=field)
    if label is not None:
        canonical["label"] = label
    canonical.update(parser(step, field=field))
    return canonical


# --- agents spine (A4 + L30 parallel groups) -----------------------------------
#
# D-031a grammar: the ``agents`` spine is an ordered list whose entries are EITHER
# a single agent node ``{slot, harness, model, steps}`` (unchanged) OR a parallel
# group ``{"parallel": [<agentNode>, <agentNode>, ...]}`` (2+ plain agent nodes).
# Flat definitions are byte-identical valid (backward compatible, no version bump).
# Lane name = the node's slot; slot uniqueness is global, so lane names are
# collision-free by construction (the "lane collisions" check is exactly the
# existing global ``duplicate_slot`` assertion). v1 bounds: groups do not nest, and
# ``workflow.include`` is not supported inside a parallel lane.


def _parse_agent_node(
    node: dict[str, object],
    *,
    field: str,
    require_steps: bool,
    seen_slots: set[str],
    reject_include: bool,
    workflow_integrations: list[str],
) -> tuple[dict[str, object], int]:
    """Parse one plain agent node. Returns ``(canonical_node, step_count)``.

    ``reject_include`` is set for nodes inside a parallel group: ``workflow.include``
    is a v1 bound there (composition inside a lane is a Part II concern).

    A node (standalone or lane) may declare its own ``integrations`` list — a
    validated subset of the workflow-level list (track 3c phase 2). Absent keeps
    the workflow-level default.
    """

    _reject_unknown_keys(node, {"slot", "harness", "model", "steps", "integrations"}, field=field)
    slot = _require_str(node, "slot", field=field)
    if not _SLOT_RE.match(slot):
        raise _err(
            "invalid_definition",
            f"{field}.slot '{slot}' must match ^[a-z][a-z0-9_]*$.",
        )
    # Global slot uniqueness IS the lane-collision guarantee (lane name = slot).
    if slot in seen_slots:
        raise _err("duplicate_slot", f"Duplicate agent slot '{slot}'.")
    seen_slots.add(slot)
    harness = _require_str(node, "harness", field=field, max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH)
    model = _require_str(node, "model", field=field, max_length=WORKFLOW_SHORT_TEXT_MAX_LENGTH)
    raw_steps = node.get("steps")
    if not isinstance(raw_steps, list) or (require_steps and not raw_steps):
        raise _err("invalid_definition", f"{field}.steps must be a non-empty list.")
    steps: list[dict[str, object]] = []
    for step_index, step_item in enumerate(raw_steps):
        step = _parse_step(step_item, field=f"{field}.steps[{step_index}]")
        if reject_include and step["kind"] == WORKFLOW_STEP_WORKFLOW_INCLUDE:
            raise _err(
                "include_in_parallel",
                f"{field}.steps[{step_index}]: workflow.include is not supported inside a "
                "parallel group (v1).",
            )
        steps.append(step)
    canonical: dict[str, object] = {
        "slot": slot,
        "harness": harness,
        "model": model,
        "steps": steps,
    }
    if "integrations" in node:
        canonical["integrations"] = _parse_agent_integrations(
            node.get("integrations"),
            workflow_integrations=workflow_integrations,
            field=field,
        )
    return canonical, len(steps)


def _parse_agent_integrations(
    raw: object, *, workflow_integrations: list[str], field: str
) -> list[str]:
    """Per-slot integration narrowing (track 3c phase 2).

    Optional on an agent node: a subset of the workflow-level ``integrations``
    list. Absent = the slot keeps the workflow-level list (default, unchanged
    behavior); an explicit (possibly empty) list narrows the slot's runtime
    grant to exactly those namespaces — the resolver-only change described in
    the data contract §3/§2.6.
    """

    if not isinstance(raw, list):
        raise _err(
            "invalid_definition", f"'{field}.integrations' must be a list of namespace strings."
        )
    allowed = set(workflow_integrations)
    seen: set[str] = set()
    canonical: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise _err(
                "invalid_definition",
                f"Each '{field}.integrations' entry must be a non-empty namespace string.",
            )
        if item not in allowed:
            raise _err(
                "agent_integrations_not_subset",
                f"'{field}.integrations' entry '{item}' is not one of the workflow's "
                "declared integrations.",
            )
        if item in seen:
            raise _err("duplicate_integration", f"Duplicate integration '{item}' in '{field}'.")
        seen.add(item)
        canonical.append(item)
    return canonical


def _parse_agents(
    raw: object, *, require_steps: bool, workflow_integrations: list[str]
) -> list[dict[str, object]]:
    if raw is None and not require_steps:
        return []
    if not isinstance(raw, list):
        raise _err("invalid_definition", "'agents' must be a list.")
    if not raw and require_steps:
        raise _err("invalid_definition", "A workflow requires at least one agent node.")
    total_steps = 0
    node_count = 0
    seen_slots: set[str] = set()
    canonical_agents: list[dict[str, object]] = []
    for entry_index, item in enumerate(raw):
        entry = _require_dict(item, field=f"agents[{entry_index}]")
        if "parallel" in entry:
            # Parallel group (D-031a).
            _reject_unknown_keys(entry, {"parallel"}, field=f"agents[{entry_index}]")
            raw_lanes = entry.get("parallel")
            if not isinstance(raw_lanes, list):
                raise _err(
                    "invalid_definition",
                    f"agents[{entry_index}].parallel must be a list of agent nodes.",
                )
            if len(raw_lanes) < 2:
                raise _err(
                    "parallel_too_few",
                    f"agents[{entry_index}].parallel requires at least 2 agent nodes "
                    f"(got {len(raw_lanes)}).",
                )
            lanes: list[dict[str, object]] = []
            for lane_index, lane_item in enumerate(raw_lanes):
                lane_field = f"agents[{entry_index}].parallel[{lane_index}]"
                lane = _require_dict(lane_item, field=lane_field)
                if "parallel" in lane:
                    raise _err(
                        "nested_parallel",
                        f"{lane_field}: parallel groups do not nest (v1).",
                    )
                canonical_lane, lane_step_count = _parse_agent_node(
                    lane,
                    field=lane_field,
                    require_steps=require_steps,
                    seen_slots=seen_slots,
                    reject_include=True,
                    workflow_integrations=workflow_integrations,
                )
                lanes.append(canonical_lane)
                total_steps += lane_step_count
                node_count += 1
            canonical_agents.append({"parallel": lanes})
        else:
            canonical_node, step_count = _parse_agent_node(
                entry,
                field=f"agents[{entry_index}]",
                require_steps=require_steps,
                seen_slots=seen_slots,
                reject_include=False,
                workflow_integrations=workflow_integrations,
            )
            canonical_agents.append(canonical_node)
            total_steps += step_count
            node_count += 1
        if node_count > WORKFLOW_MAX_AGENTS:
            raise _err(
                "too_many_agents",
                f"A workflow may declare at most {WORKFLOW_MAX_AGENTS} agent nodes.",
            )
        if total_steps > WORKFLOW_MAX_STEPS:
            raise _err(
                "too_many_steps",
                f"A workflow may declare at most {WORKFLOW_MAX_STEPS} steps.",
            )
    return canonical_agents


# --- spine iteration (flatten parallel groups) ---------------------------------


def iter_agent_nodes(agents: object) -> Iterator[dict[str, object]]:
    """Yield every agent node across the spine, flattening parallel groups.

    Defensive (tolerates malformed entries) so grant/scope helpers can walk a
    stored definition without re-parsing. Single nodes yield as-is; a parallel
    group yields each of its lane nodes in lane order.
    """

    if not isinstance(agents, list):
        return
    for entry in agents:
        if not isinstance(entry, dict):
            continue
        lanes = entry.get("parallel")
        if isinstance(lanes, list):
            for lane in lanes:
                if isinstance(lane, dict):
                    yield lane
        else:
            yield entry


def iter_plan_nodes(
    agents: list[dict[str, object]],
) -> Iterator[tuple[int, str, dict[str, object]]]:
    """Yield ``(spine_index, lane, node)`` for every agent node in flatten order.

    ``lane`` is ``"-"`` for a standalone node and the node's slot for a
    parallel-group lane — the middle segment of the ``"<node>.<lane>.<step>"``
    resolved step key (data-contract §4). A parallel group occupies ONE spine
    index; its lanes emit lane-grouped in lane order (deterministic — the runtime
    schedules by key). Consumes the canonical (already-parsed) agents spine.
    """

    for spine_index, entry in enumerate(agents):
        lanes = entry.get("parallel") if isinstance(entry, dict) else None
        if isinstance(lanes, list):
            for lane in lanes:
                yield spine_index, str(lane["slot"]), lane
        else:
            yield spine_index, "-", entry


def has_parallel_groups(agents: object) -> bool:
    """True when the agents spine contains at least one parallel group (L30).

    Defensive (tolerates a raw stored/unparsed spine): a group entry is a dict
    carrying a ``parallel`` list. Used to gate v1 parallel bounds (M1): parallel
    forces worktree isolation, and rejects both session_bindings and local
    targets."""

    if not isinstance(agents, list):
        return False
    return any(
        isinstance(entry, dict) and isinstance(entry.get("parallel"), list) for entry in agents
    )


# --- template reference + emit validation --------------------------------------


def _iter_step_strings(step: dict[str, object]) -> Iterator[tuple[str, str]]:
    """Yield ``(field_name, value)`` for every templated string within a canonical
    step. ``field_name`` is the step's top-level key (nested dict strings inherit
    their parent key) — enough to scope the notify ``message`` for ``{{fields.*}}``.

    ``agent_fields`` is skipped: it is configuration (slot + schema), not a
    template holder, and is validated structurally in ``_parse_notify``."""

    for key, value in step.items():
        if key in {
            "kind",
            "on_fail",
            "label",
            "name",
            "output_schema",
            "required_invocation",
            "agent_fields",
        }:
            continue
        if isinstance(value, str):
            yield key, value
        elif isinstance(value, dict):
            for sub in value.values():
                if isinstance(sub, str):
                    yield key, sub


def _validate_step_refs(
    step: dict[str, object],
    *,
    input_names: frozenset[str],
    visible_emits: frozenset[str],
    all_slots: frozenset[str],
    include_names: set[str],
    lane_slot: str | None,
) -> None:
    """Validate every templated string in one step against the emits visible at
    its run-order position (§1.3). Raises on the first bad reference.

    ``all_slots`` is every slot in the definition; ``lane_slot`` is the slot of
    the parallel lane this step lives in (``None`` for a standalone node). A
    notify's ``agent_fields`` block is scoped here (track 3c): its ``{{fields.*}}``
    are legal only in the notify ``message``, and its ``slot`` must name a real
    agent — and, inside a parallel lane, MUST be the lane's own slot (a lane's
    notify-fields emit runs in that lane's session/worktree, so it can't be filled
    by a sibling lane's agent)."""

    agent_fields = step.get("agent_fields") if step["kind"] == WORKFLOW_STEP_NOTIFY else None
    allowed_fields: frozenset[str] | None = None
    if isinstance(agent_fields, dict):
        schema = agent_fields.get("schema", {})
        allowed_fields = frozenset(schema.keys() if isinstance(schema, dict) else ())
        slot = agent_fields.get("slot")
        if lane_slot is not None:
            # Inside a parallel lane: the fields emit runs in this lane, so it must
            # be filled by this lane's own agent — never a sibling lane's slot.
            if slot != lane_slot:
                raise _err(
                    "agent_fields_slot_outside_lane",
                    f"notify agent_fields.slot '{slot}' must be the lane's own slot "
                    f"'{lane_slot}' when the notify is inside a parallel group.",
                )
        elif slot not in all_slots:
            raise _err(
                "unknown_slot",
                f"notify agent_fields.slot '{slot}' is not an agent slot in this workflow.",
            )

    for field_name, value in _iter_step_strings(step):
        # {{fields.*}} is scoped to the notify `message` that declared
        # agent_fields; anywhere else it is a validation error (None scope).
        fields_scope = allowed_fields if field_name == "message" else None
        for reference in iter_references(value):
            if isinstance(reference, EmitReference) and reference.emit in include_names:
                raise _err(
                    "include_step_reference",
                    f"Template references workflow.include step "
                    f"'{reference.emit}', which has no output.",
                )
        try:
            validate_string_references(
                value,
                input_names=input_names,
                prior_emit_names=visible_emits,
                allowed_fields=fields_scope,
            )
        except TemplateReferenceError as exc:
            raise _err(exc.code, exc.message) from exc


def _validate_node_steps(
    node: dict[str, object],
    *,
    input_names: frozenset[str],
    base_visible: frozenset[str],
    all_emits: set[str],
    all_slots: frozenset[str],
    include_names: set[str],
    lane_slot: str | None,
) -> set[str]:
    """Validate one agent node's steps against ``base_visible`` (emits visible at
    the node's start) plus the node's own earlier emits. Returns the emit names
    this node produced. ``all_emits`` is the whole-definition uniqueness ledger.

    ``lane_slot`` is this node's lane slot when it is a parallel-group lane, else
    ``None`` (a standalone node); it gates the notify ``agent_fields.slot`` rule."""

    local_visible: set[str] = set(base_visible)
    produced: set[str] = set()
    for step in node["steps"]:  # type: ignore[index]
        _validate_step_refs(
            step,
            input_names=input_names,
            visible_emits=frozenset(local_visible),
            all_slots=all_slots,
            include_names=include_names,
            lane_slot=lane_slot,
        )
        if step["kind"] == WORKFLOW_STEP_BRANCH:
            _validate_branch_on(step, local_visible)
        # Register this step's emit AFTER validating its own refs (a step can
        # never reference its own output).
        if step["kind"] == WORKFLOW_STEP_AGENT_EMIT:
            name = step["name"]
            if name in all_emits:
                raise _err("duplicate_emit", f"Duplicate emit name '{name}'.")
            all_emits.add(name)  # type: ignore[arg-type]
            produced.add(name)  # type: ignore[arg-type]
            local_visible.add(name)  # type: ignore[arg-type]
        elif step["kind"] == WORKFLOW_STEP_WORKFLOW_INCLUDE:
            include_name = step.get("name")
            if isinstance(include_name, str):
                include_names.add(include_name)
    return produced


def _validate_spine_references(
    agents: list[dict[str, object]], input_names: frozenset[str]
) -> None:
    """Walk the flattened run order enforcing emit-name uniqueness (whole
    definition) and strictly-prior ref visibility, plus branch semantics.

    Visibility extended to lanes (data-contract §1.3, D-031): a ref inside a lane
    of a parallel group may name emits from earlier SPINE entries in full and
    earlier steps in the SAME lane — never a parallel sibling's emits. Emits from
    every lane become visible to steps AFTER the group (they are "earlier spine
    nodes in full"). Emit-name uniqueness still spans the WHOLE definition, so two
    lanes can never publish the same emit name.

    ``workflow.include`` steps are validated too (their input-mapping values are
    parent-context templates), but they produce no emit of their own — a parent
    ref that names an include handle is rejected (``include_step_reference``); the
    child's emits are namespaced away at resolution and are never visible here
    (cross-spine refs are a Part II concern)."""

    all_slots = frozenset(str(node["slot"]) for node in iter_agent_nodes(agents))
    visible_emits: set[str] = set()  # emits visible at the current spine position
    all_emits: set[str] = set()  # every emit seen (whole-definition uniqueness)
    include_names: set[str] = set()
    for entry in agents:
        lanes = entry.get("parallel") if isinstance(entry, dict) else None
        if isinstance(lanes, list):
            # Each lane sees only the emits visible BEFORE the group (snapshot) +
            # its own earlier steps; sibling lanes are invisible to each other.
            group_snapshot = frozenset(visible_emits)
            group_produced: set[str] = set()
            for lane in lanes:
                group_produced |= _validate_node_steps(
                    lane,
                    input_names=input_names,
                    base_visible=group_snapshot,
                    all_emits=all_emits,
                    all_slots=all_slots,
                    include_names=include_names,
                    # A lane's notify agent_fields.slot must be the lane's own slot.
                    lane_slot=str(lane["slot"]),
                )
            # Join: every lane's emits are visible to later spine entries.
            visible_emits |= group_produced
        else:
            visible_emits |= _validate_node_steps(
                entry,
                input_names=input_names,
                base_visible=frozenset(visible_emits),
                all_emits=all_emits,
                all_slots=all_slots,
                include_names=include_names,
                lane_slot=None,
            )


def _validate_branch_on(step: dict[str, object], prior_emits: set[str]) -> None:
    refs = iter_references(step["on"])  # type: ignore[arg-type]
    emit_refs = [r for r in refs if isinstance(r, EmitReference)]
    if len(refs) != 1 or len(emit_refs) != 1:
        raise _err(
            "invalid_definition",
            "'branch.on' must be exactly one {{EMIT.FIELD}} reference.",
        )
    if emit_refs[0].emit not in prior_emits:
        raise _err(
            "forward_emit_reference",
            f"branch references emit '{emit_refs[0].emit}', not produced by an earlier step.",
        )


# --- public entrypoint ---------------------------------------------------------


def parse_definition(
    raw: object, *, require_steps: bool = True
) -> tuple[dict[str, object], list[ArgSpec]]:
    """Validate a raw v2 definition and return its canonical dict + parsed input specs.

    Raises :class:`WorkflowDefinitionError` on any structural or reference problem.

    ``require_steps=False`` permits a zero-agent *draft* — used when saving a
    workflow that the user will still build in the editor. Running a workflow
    (StartRun) always parses with ``require_steps=True``, so an empty draft can
    be saved but not run.
    """

    definition = _require_dict(raw, field="definition")
    _reject_unknown_keys(
        definition,
        {"version", "name", "description", "inputs", "integrations", "agents"},
        field="definition",
    )
    version = definition.get("version")
    if version != 1:
        raise _err("invalid_definition", "'version' must be 1.")

    canonical_inputs, arg_specs = _parse_inputs(definition.get("inputs"))
    integrations = _parse_integrations(definition.get("integrations"))
    agents = _parse_agents(
        definition.get("agents"), require_steps=require_steps, workflow_integrations=integrations
    )
    _validate_spine_references(agents, frozenset(spec.name for spec in arg_specs))

    canonical: dict[str, object] = {
        "version": 1,
        "inputs": canonical_inputs,
        "integrations": integrations,
        "agents": agents,
    }
    name = _optional_str(definition, "name", field="definition")
    if name is not None:
        canonical["name"] = name
    description = _optional_str(definition, "description", field="definition")
    if description is not None:
        canonical["description"] = description
    return canonical, arg_specs
