"""Pure workflow composition transforms (spec 3.5 / L20), format v2.

Using workflow B inside workflow A means B's steps are **inlined into A's single
resolved plan at StartRun, server-side, before delivery** — one run, one plan,
one cursor, one sandbox. There is no child run, no parent linkage, no spawn: the
``workflow.include`` step (definition-only) is eliminated by resolution-time
splicing, so the runtime never sees it (that is the L20 property, asserted in
the sibling service module below).

**Where includes live (v2 agents spine, A3/PROPOSED):** an ``workflow.include``
step lives *inside an agent node's step list* and inlines the child definition's
STEPS into that node. A child definition with more than one agent node is
REJECTED as an include target for now — cross-spine inlining is the Part II
composition pass's problem (``include_multi_agent``). The child's single node's
harness/model are ignored: the included steps run in the *parent* node's slot.

Two resolver obligations (§3.5), both operating purely on the v2 named-ref grammar
(``{{inputs.<name>}}`` / ``{{<emit>.<field>}}``) — NOT on indices. The parent's
flatten pass (``domain.resolved_plan.resolve_plan``) later assigns structured step keys and
rewrites every ``{{<emit>.<field>}}`` to the runtime's indexed
``{{steps[n].output.<field>}}`` form, so composition never touches indices:

* **(a) Arg binding.** The include step's ``args`` mapping becomes the child's
  input context: each child ``{{inputs.<name>}}`` token is replaced by the
  mapping's value string. The substitution is **textual — no brace-escaping** —
  because both the child field and the mapping value are author-written
  definition text (unlike a user-supplied StartRun input, which is brace-escaped
  by the eager pass). Mapping values may themselves carry the PARENT's
  ``{{inputs.*}}`` (eager-resolved later by the flatten pass — inline FIRST, then
  eager) and the parent's ``{{<emit>.<field>}}`` refs (which stay late-bound and
  are rewritten to indexed form by the flatten pass).

* **(b) Emit-ref namespacing.** A child's internal emit names are the ref
  namespace, so each child ``agent.emit`` ``name`` is prefixed ``<includeName>_``
  and every child ``{{<emit>.<field>}}`` reference to one of them is rewritten to
  ``{{<includeName>_<emit>.<field>}}``. Prefixing happens BEFORE arg binding so a
  parent emit ref injected via the mapping (which names a PARENT emit) is never
  itself prefixed. The flatten pass then resolves the prefixed names to indices.

This module owns only the PURE half of composition: prefixing, arg binding,
emit-ref rewriting, and the include-mapping coverage check — no DB, no async.
The async resolution/validation orchestration (loading include targets off the
DB, recursively splicing them, walking the include graph for cycles) lives in
the sibling service module
``server/proliferate/server/cloud/workflows/composition.py``, which imports the
helpers here. That module's :func:`~...composition.validate_includes` additionally
proves an include target exists / is same-owner / not archived / has exactly one
agent node, is not self-included, that the mapping covers the child's required
inputs and references only declared child inputs, and that the include graph has
no cycle (A→B→A) — all before a version is stored.
"""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy

from proliferate.constants.workflows import (
    WORKFLOW_STEP_AGENT_EMIT,
    WORKFLOW_STEP_WORKFLOW_INCLUDE,
)
from proliferate.server.cloud.workflows.domain.definition import parse_definition
from proliferate.server.cloud.workflows.domain.interpolation import (
    _PLACEHOLDER_RE,
    ArgSpec,
    EmitReference,
    InputReference,
    _render_scalar,
    parse_reference,
)


class WorkflowCompositionError(Exception):
    """Raised when a ``workflow.include`` cannot be validated or resolved."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _is_include(step: dict[str, object]) -> bool:
    return step.get("kind") == WORKFLOW_STEP_WORKFLOW_INCLUDE


def _single_agent_steps(
    child_definition: dict[str, object], *, target_id: object
) -> list[dict[str, object]]:
    """Return the child's ONE agent node's steps, or reject a multi-node target.

    Cross-spine inlining (a child with several agent nodes / slots) is a Part II
    concept (A3/PROPOSED) — for now a multi-node include target fails cleanly.
    """

    agents = list(child_definition.get("agents", []))
    if len(agents) != 1:
        raise WorkflowCompositionError(
            "include_multi_agent",
            f"workflow.include target {target_id} must have exactly one agent node "
            f"(it has {len(agents)}); including a multi-agent workflow is not "
            "supported yet.",
        )
    return list(agents[0].get("steps", []))


# --- pure string rewriting -----------------------------------------------------


def _prefix_child_emit_refs(value: str, *, child_emit_names: frozenset[str], prefix: str) -> str:
    """Namespace a child string's OWN emit refs for splicing (§3.5 obl. b).

    ``{{<emit>.<field>}}`` where ``emit`` is one of the child's emit names is
    rewritten to ``{{<prefix>_<emit>.<field>}}``. Everything else (input refs,
    which the arg-binding pass handles next) is left verbatim.
    """

    out: list[str] = []
    last = 0
    for match in _PLACEHOLDER_RE.finditer(value):
        out.append(value[last : match.start()])
        reference = parse_reference(match.group("ref"))
        if isinstance(reference, EmitReference) and reference.emit in child_emit_names:
            out.append(f"{{{{{prefix}_{reference.emit}.{reference.field}}}}}")
        else:  # InputReference (bound below) / a parent emit ref — verbatim.
            out.append(match.group(0))
        last = match.end()
    out.append(value[last:])
    return "".join(out)


def _bind_child_inputs(value: str, arg_context: dict[str, str]) -> str:
    """Replace child ``{{inputs.<name>}}`` tokens with the include's mapping value.

    Textual substitution, no brace-escaping (§3.5 obl. a): both sides are
    author-written definition text. Already-namespaced emit refs are left verbatim.
    """

    out: list[str] = []
    last = 0
    for match in _PLACEHOLDER_RE.finditer(value):
        out.append(value[last : match.start()])
        reference = parse_reference(match.group("ref"))
        if isinstance(reference, InputReference):
            out.append(arg_context.get(reference.name, ""))
        else:
            out.append(match.group(0))
        last = match.end()
    out.append(value[last:])
    return "".join(out)


# ``label`` is skimmed English, ``name`` an identifier, ``output_schema`` a JSON
# Schema, ``required_invocation`` a {provider, tool} literal — none are templated.
_SKIP_KEYS = frozenset(
    {"kind", "on_fail", "label", "name", "output_schema", "required_invocation"}
)


def _transform_step_strings(
    step: dict[str, object], fn: Callable[[str], str]
) -> dict[str, object]:
    """Return a copy of ``step`` with ``fn`` applied to every templated string.

    Recurses fully into nested dicts/lists (mirroring ``resolve_value``), so a
    goal's ``verify.shell`` and a branch's ``on`` are rewritten too. The identifier
    / schema fields in ``_SKIP_KEYS`` are left untouched.
    """

    def _walk(value: object) -> object:
        if isinstance(value, str):
            return fn(value)
        if isinstance(value, list):
            return [_walk(item) for item in value]
        if isinstance(value, dict):
            return {key: _walk(item) for key, item in value.items()}
        return value

    result: dict[str, object] = {}
    for key, value in step.items():
        result[key] = value if key in _SKIP_KEYS else _walk(value)
    return result


def _splice_child(
    child_steps: list[dict[str, object]],
    *,
    arg_context: dict[str, str],
    name_prefix: str,
) -> list[dict[str, object]]:
    """Namespace emit refs + arg-bind a child's (already-flattened) steps.

    The child's steps are returned unchanged in order; the parent flatten pass
    positions them and rewrites their now-namespaced emit names to indices.
    """

    child_emit_names = frozenset(
        step["name"]
        for step in child_steps
        if step.get("kind") == WORKFLOW_STEP_AGENT_EMIT and isinstance(step.get("name"), str)
    )

    def _rewrite(value: str) -> str:
        # Namespace emit refs FIRST so a parent emit ref injected via arg binding
        # (which names a PARENT emit) is not itself prefixed.
        namespaced = _prefix_child_emit_refs(
            value, child_emit_names=child_emit_names, prefix=name_prefix
        )
        return _bind_child_inputs(namespaced, arg_context)

    spliced: list[dict[str, object]] = []
    for step in child_steps:
        transformed = _transform_step_strings(deepcopy(step), _rewrite)
        # Only emit names live in the ref namespace, so only they are prefixed.
        if transformed.get("kind") == WORKFLOW_STEP_AGENT_EMIT and isinstance(
            transformed.get("name"), str
        ):
            transformed["name"] = f"{name_prefix}_{transformed['name']}"
        spliced.append(transformed)
    return spliced


# --- arg-context (coverage) ----------------------------------------------------


def _build_arg_context(
    mapping: dict[str, object], child_specs: list[ArgSpec], *, error_code: str
) -> dict[str, str]:
    """Verify the include mapping against the child's input schema, return the context.

    Coverage rule (save AND resolution): the mapping must reference only declared
    child inputs and cover every REQUIRED child input. Uncovered optional inputs
    fall back to their default (or the empty string when they have none) so no
    dangling ``{{inputs.*}}`` survives into the flattened plan.
    """

    declared = {spec.name for spec in child_specs}
    unknown = sorted(set(mapping) - declared)
    if unknown:
        raise WorkflowCompositionError(
            error_code,
            f"workflow.include args reference undeclared child input(s): {unknown}.",
        )
    missing = sorted(
        spec.name for spec in child_specs if spec.required and spec.name not in mapping
    )
    if missing:
        raise WorkflowCompositionError(
            error_code,
            f"workflow.include is missing required child input(s): {missing}.",
        )
    context: dict[str, str] = {}
    for spec in child_specs:
        if spec.name in mapping:
            context[spec.name] = str(mapping[spec.name])
        elif spec.has_default:
            context[spec.name] = _render_scalar(spec.default)
    return context


def _child_arg_specs(version_definition: dict[str, object]) -> list[ArgSpec]:
    _canonical, specs = parse_definition(version_definition, require_steps=False)
    return specs


def _include_steps_of_definition(definition: dict[str, object]) -> list[dict[str, object]]:
    """Every ``workflow.include`` step across a v2 definition's agent nodes."""

    includes: list[dict[str, object]] = []
    for node in definition.get("agents", []):
        for step in node.get("steps", []):
            if step.get("kind") == WORKFLOW_STEP_WORKFLOW_INCLUDE:
                includes.append(step)
    return includes
