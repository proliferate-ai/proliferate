"""Pure construction of an immutable workflow resolved plan."""

from __future__ import annotations

from uuid import UUID

from proliferate.constants.workflows import (
    WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS,
    WORKFLOW_ISOLATION_DEFAULT,
    WORKFLOW_ISOLATION_WORKTREE,
    WORKFLOW_SESSION_BINDING_FRESH,
    WORKFLOW_SESSION_BINDING_HEADLESS,
    WORKFLOW_STEP_AGENT_EMIT,
    WORKFLOW_STEP_NOTIFY,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_CHAT,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.server.cloud.workflows.contracts import derive_legacy_id
from proliferate.server.cloud.workflows.domain.definition import iter_plan_nodes
from proliferate.server.cloud.workflows.domain.interpolation import resolve_value


def _default_session_binding(trigger_kind: str) -> str:
    """Per-slot session visibility default (A1): manual/chat = fresh (deep-linked
    in the run view), schedule/poll = headless (no UI focus)."""

    if trigger_kind in (WORKFLOW_TRIGGER_MANUAL, WORKFLOW_TRIGGER_CHAT):
        return WORKFLOW_SESSION_BINDING_FRESH
    return WORKFLOW_SESSION_BINDING_HEADLESS


def resolve_run_isolation(
    *,
    target_mode: str,
    session_bindings: dict[str, str] | None,
    definition_has_parallel: bool,
) -> str:
    """Wave 2b (§9 RULED default): cloud runs get a fresh per-run worktree
    unless the run binds into an existing session.

    Presence of ``session_bindings`` (the 1a bind-existing path) is the ONLY
    exception in v1 — you can't bind into a session that lives in the shared
    checkout and simultaneously isolate away from it, so a bound run keeps
    workspace isolation. No other knob exists yet: if the definition/trigger
    later grows an explicit isolation field, that's a new call site, not a
    change here.

    M1 override (L30): a definition with parallel groups ALWAYS resolves to
    worktree isolation — sibling lanes cannot share one checkout without a torn
    git index, so per-lane worktrees are mandatory. Parallel wins over the
    bindings-force-workspace rule; a parallel definition rejects session_bindings
    (and local targets) upstream at StartRun, so this only ever fires for a cloud
    run with no bindings — but the rule is stated first so the invariant is
    explicit and never accidentally narrowed.

    Local (desktop) target_mode is left at the legacy default (workspace):
    local delivery doesn't run through the cloud sandbox worktree mint (wave
    2a — the desktop executor — is a separate, not-yet-built track), so
    forcing worktree isolation there would be inventing behavior for an
    unspecced path. (Parallel + local is rejected at StartRun.)
    """

    if definition_has_parallel:
        return WORKFLOW_ISOLATION_WORKTREE
    if session_bindings:
        return WORKFLOW_ISOLATION_DEFAULT
    if target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        return WORKFLOW_ISOLATION_WORKTREE
    return WORKFLOW_ISOLATION_DEFAULT


def _escape_braces(rendered: str) -> str:
    """Brace-escape server-composed text so it can never form a live runtime
    ``{{steps[n].output.*}}`` token (mirrors interpolation's input-value guard)."""

    return rendered.replace("{", "\\{").replace("}", "\\}")


def _notify_agent_fields(step: dict[str, object]) -> dict[str, object] | None:
    """Return a notify step's ``agent_fields`` block, or ``None`` if it is not a
    notify step or is template-only."""

    if step.get("kind") != WORKFLOW_STEP_NOTIFY:
        return None
    agent_fields = step.get("agent_fields")
    return agent_fields if isinstance(agent_fields, dict) else None


def _build_notify_fields_emit(
    step: dict[str, object], agent_fields: dict[str, object]
) -> dict[str, object]:
    """Build the injected ``agent.emit`` that fills a notify's ``{{fields.*}}``.

    Reuses the emit machinery (schema-validated output + max_attempts re-ask) — no
    new step kind, no new runtime verb ("gate-shaped"). The derived prompt is
    generated from the flat ``agent_fields.schema``; the emit's ``output_schema``
    wraps that schema into a strict object contract the runtime validates. The
    emit carries no ``name`` (names are resolved away in the plan); its output is
    addressed purely by flat index. Its ``on_fail`` inherits the notify's, so a
    field the agent cannot produce stops the run rather than sending a blank
    notification.

    The emit is fully server-generated (no ``{{inputs.*}}`` / ``{{<emit>.*}}``
    refs), so it is delivered WITHOUT going through the ref resolver. Any
    author-supplied ``description`` text is brace-escaped so it can never form a
    live ``{{steps[n].output.*}}`` token in the runtime — the same injection guard
    the resolver applies to interpolated input values.
    """

    schema = agent_fields["schema"]
    assert isinstance(schema, dict)
    lines: list[str] = []
    properties: dict[str, object] = {}
    for name, spec in schema.items():
        assert isinstance(spec, dict)
        field_type = spec["type"]
        description = spec.get("description")
        line = f"- {name} ({field_type})"
        if description:
            line += f": {_escape_braces(str(description))}"
        lines.append(line)
        properties[name] = {"type": field_type}
    prompt = (
        "A notification will be sent using values you provide here. Respond with a "
        "JSON object containing exactly these fields:\n" + "\n".join(lines)
    )
    return {
        "kind": WORKFLOW_STEP_AGENT_EMIT,
        "on_fail": step["on_fail"],
        "label": "Prepare notification fields",
        "prompt": prompt,
        "max_attempts": WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS,
        "output_schema": {
            "type": "object",
            "properties": properties,
            "required": list(schema.keys()),
            "additionalProperties": False,
        },
    }


# Stable v2 step identities are derived from the pinned workflow version.
def _v2_step_keys(
    agents: list[dict[str, object]], *, workflow_version_id: str
) -> dict[tuple[int, str, int], str]:
    """Derive stable v2 step keys for every plan step (spec §5.1).

    Grammar: ``<include-path or root>::<node-id>::<lane-id or ->::<step-id>``.
    The server-side canonical definition carries no persisted UUID identities
    (the v2 definition schema rejects an ``id`` field; WS9a derives ids in the
    product domain), so the server derives them deterministically for these
    legacy definitions via the WS1 UUIDv5 upgrade — the SAME derivation, so the
    keys agree cross-language. The ``identity`` is the RFC 6901 JSON Pointer into
    the (composed) agents spine. v1 has no include nesting server-side, so the
    include path is always ``root``.

    Keyed by ``(spine_index, lane, step_index)`` to match the legacy
    ``"<node>.<lane>.<step>"`` key the runtime still consumes; the v2 key rides
    alongside as an additive ``step["key_v2"]`` for WS2c observation mapping.
    """

    keys: dict[tuple[int, str, int], str] = {}
    for spine_index, entry in enumerate(agents):
        lanes = entry.get("parallel") if isinstance(entry, dict) else None
        if isinstance(lanes, list):
            group_id = derive_legacy_id(
                workflow_version_id, "group", f"/agents/{spine_index}/parallel"
            )
            for lane_index, lane in enumerate(lanes):
                if not isinstance(lane, dict):
                    continue
                lane_steps = lane.get("steps")
                if not isinstance(lane_steps, list):
                    continue
                lane_ptr = f"/agents/{spine_index}/parallel/{lane_index}"
                lane_id = derive_legacy_id(workflow_version_id, "lane", lane_ptr)
                for step_index in range(len(lane_steps)):
                    step_id = derive_legacy_id(
                        workflow_version_id, "step", f"{lane_ptr}/steps/{step_index}"
                    )
                    keys[(spine_index, str(lane["slot"]), step_index)] = (
                        f"root::{group_id}::{lane_id}::{step_id}"
                    )
        elif isinstance(entry, dict):
            node_steps = entry.get("steps")
            if not isinstance(node_steps, list):
                continue
            node_ptr = f"/agents/{spine_index}"
            node_id = derive_legacy_id(workflow_version_id, "node", node_ptr)
            for step_index in range(len(node_steps)):
                step_id = derive_legacy_id(
                    workflow_version_id, "step", f"{node_ptr}/steps/{step_index}"
                )
                keys[(spine_index, "-", step_index)] = f"root::{node_id}::-::{step_id}"
    return keys


def resolve_plan(
    *,
    run_id: UUID,
    workflow_id: UUID,
    definition_json: dict[str, object],
    workflow_version_id: UUID,
    version_n: int,
    trigger_kind: str,
    target_mode: str,
    coerced_inputs: dict[str, object],
    session_bindings: dict[str, str],
    agents: list[dict[str, object]],
    isolation: str = WORKFLOW_ISOLATION_DEFAULT,
) -> dict[str, object]:
    """The single resolution pass (data-contract §4): flatten the agents spine
    into one ordered step list, stamp each step with its structured key + slot +
    label, build the per-slot sessions map, and resolve template refs (eager
    ``{{inputs.*}}`` + rewrite ``{{emit.field}}`` -> ``{{steps[n].output.field}}``).
    """

    canonical = definition_json
    # ``agents`` arrives with every workflow.include already inlined into the
    # owning node's step list (L20, composition.resolve_included_agents) and in the
    # v2 named-ref grammar — this pass flattens it, assigns keys, and rewrites
    # emit names to indices in one place (composition never touches indices).
    # L30: a parallel-group entry contributes one lane node per lane, keyed
    # "<spine_index>.<slot>.<step>"; a standalone node keeps "<spine_index>.-.<step>".
    # Lanes are emitted lane-grouped in lane order (deterministic); the runtime
    # schedules by key. E3/§2.6: the workflow-level integrations grant is stamped
    # onto every slot (per-slot narrowing is a later resolver-only change).
    integrations = list(canonical.get("integrations", []))
    plan_nodes = list(iter_plan_nodes(agents))

    # First pass: assign each step its flattened index and build the
    # emit-name -> flat-index map the ref rewrite needs. Same flatten order the
    # steps[] array below uses, so an emit's index matches its position. A notify
    # step that declares `agent_fields` (track 3c) expands into TWO plan steps — an
    # injected `agent.emit` in the named slot, then the notify itself — so the
    # injected emit occupies its own flat position AHEAD of the notify.
    # `notify_fields_index` records that position so the notify's `{{fields.*}}`
    # refs rewrite to indexed refs against it (exactly like `{{<emit>.<field>}}`).
    # Keyed by (spine_index, lane, step_index): under L30 a parallel group is ONE
    # spine_index across N lanes, so a (node_index, step_index) key would collide
    # across sibling lanes.
    emit_index: dict[str, int] = {}
    notify_fields_index: dict[tuple[int, str, int], int] = {}
    flat_position = 0
    for spine_index, lane, node in plan_nodes:
        for step_index, step in enumerate(node["steps"]):
            if _notify_agent_fields(step) is not None:
                notify_fields_index[(spine_index, lane, step_index)] = flat_position
                flat_position += 1  # the injected notify-fields emit
            if step.get("kind") == WORKFLOW_STEP_AGENT_EMIT:
                emit_index[step["name"]] = flat_position
            flat_position += 1

    # Stable v2 step keys (spec §5.1), derived once for the whole spine. Additive:
    # the runtime keeps using the legacy ``key`` field (WS5a); ``key_v2`` rides
    # along for WS2c observation mapping.
    v2_keys = _v2_step_keys(agents, workflow_version_id=str(workflow_version_id))

    default_binding = _default_session_binding(trigger_kind)
    sessions: dict[str, object] = {}
    steps: list[dict[str, object]] = []
    for spine_index, lane, node in plan_nodes:
        slot = node["slot"]
        session_entry: dict[str, object] = {
            "harness": node["harness"],
            "model": node["model"],
            "session_binding": default_binding,
            "integrations": list(integrations),
        }
        bound = session_bindings.get(slot)
        if bound is not None:
            session_entry["bind_session_id"] = bound
        sessions[slot] = session_entry

        for step_index, step in enumerate(node["steps"]):
            agent_fields = _notify_agent_fields(step)
            fields_index: int | None = None
            if agent_fields is not None:
                # Emit the injected notify-fields agent.emit (runs in agent_fields.slot)
                # ahead of the notify; its output backs the notify's {{fields.*}}.
                fields_index = notify_fields_index[(spine_index, lane, step_index)]
                # Server-generated (no template refs to resolve); delivered as-is.
                # Lane-qualified key so the injected emit lands in the same lane/
                # worktree scope as the notify (the runtime's parse_lane_key strips
                # the trailing ".notify_fields" suffix — see plan.rs). Inside a lane,
                # agent_fields.slot is the lane's own slot (validator-enforced), so
                # the emit is coherent with its `{spine}.{lane}` scope.
                injected = _build_notify_fields_emit(step, agent_fields)
                injected["key"] = f"{spine_index}.{lane}.{step_index}.notify_fields"
                injected["slot"] = agent_fields["slot"]
                step_key_v2 = v2_keys.get((spine_index, lane, step_index))
                if step_key_v2 is not None:
                    injected["key_v2"] = f"{step_key_v2}::notify_fields"
                steps.append(injected)

            # Lane "-" for the flat (non-parallel) case; the slot name for a
            # parallel-group lane — the "<node>.<lane>.<step>" shape (§4).
            key = f"{spine_index}.{lane}.{step_index}"
            # Strip agent_fields from the notify before delivery — the runtime never
            # sees it (the injected emit + indexed {{fields.*}} refs carry it all).
            source = (
                step
                if agent_fields is None
                else {k: v for k, v in step.items() if k != "agent_fields"}
            )
            resolved = resolve_value(
                source,
                inputs=coerced_inputs,
                emit_index=emit_index,
                fields_index=fields_index,
            )
            assert isinstance(resolved, dict)
            resolved["key"] = key
            step_key_v2 = v2_keys.get((spine_index, lane, step_index))
            if step_key_v2 is not None:
                resolved["key_v2"] = step_key_v2
            resolved["slot"] = slot
            resolved.setdefault("label", step.get("label", ""))
            steps.append(resolved)

    return {
        "run_id": str(run_id),
        "plan_version": 1,
        "workflow_id": str(workflow_id),
        "workflow_version_id": str(workflow_version_id),
        "version_n": version_n,
        "trigger_kind": trigger_kind,
        "target_mode": target_mode,
        # Wave 2b: plan-level run isolation. Emitted explicitly so the plan is
        # self-describing; the runtime treats an absent field as "workspace"
        # (back-compat). The source that pins "worktree" (plan setup / trigger)
        # is phase 2 — for now every run resolves to the default.
        "isolation": isolation,
        "sessions": sessions,
        "inputs": coerced_inputs,
        "steps": steps,
    }
