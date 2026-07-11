"""StartRun compiler (spec 3.2): the single resolution point for a run.

Load the pinned immutable version, coerce args, expand ``workflow.include``
composition, resolve run isolation, eagerly interpolate ``{{args.*}}`` into a
self-contained resolved plan, and record a ``pending_delivery`` (or, for a
server-delivered local run, ``claimable``) run whose id is the delivery
idempotency key.

Split out of ``service.py`` (ownership-only, WS0B-S): ``service.py`` keeps
API-facing CRUD/visibility, worker-facing delivery/observed-status handling
lives in ``worker/service.py``, and trigger CRUD/poll validation lives in
``triggers.py``. This module owns only StartRun compilation.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_TARGET_MODES,
    SUPPORTED_WORKFLOW_TRIGGER_KINDS,
    WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS,
    WORKFLOW_ISOLATION_DEFAULT,
    WORKFLOW_ISOLATION_WORKTREE,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
    WORKFLOW_SESSION_BINDING_FRESH,
    WORKFLOW_SESSION_BINDING_HEADLESS,
    WORKFLOW_STEP_AGENT_EMIT,
    WORKFLOW_STEP_NOTIFY,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_CHAT,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord, WorkflowVersionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.composition import resolve_included_agents
from proliferate.server.cloud.workflows.domain.composition import WorkflowCompositionError
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    has_parallel_groups,
    iter_agent_nodes,
    iter_plan_nodes,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgumentError,
    coerce_arguments,
    resolve_value,
)
from proliferate.server.cloud.workflows.gateway_grants import (
    assert_declared_providers_ready,
    granted_namespaces,
    mint_run_gateway_token,
    resolve_run_scope,
)
from proliferate.server.cloud.workflows.service import visible_workflow

# Cross-module call into service.py, the API-facing owner of workflow
# visibility (one-directional: service.py does not import this module).
_visible_workflow = visible_workflow


def _default_session_binding(trigger_kind: str) -> str:
    """Per-slot session visibility default (A1): manual/chat = fresh (deep-linked
    in the run view), schedule/poll = headless (no UI focus)."""

    if trigger_kind in (WORKFLOW_TRIGGER_MANUAL, WORKFLOW_TRIGGER_CHAT):
        return WORKFLOW_SESSION_BINDING_FRESH
    return WORKFLOW_SESSION_BINDING_HEADLESS


def _resolve_run_isolation(
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


def _resolve_plan(
    *,
    run_id: UUID,
    workflow_id: UUID,
    version: WorkflowVersionRecord,
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

    canonical = version.definition_json
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
            resolved["slot"] = slot
            resolved.setdefault("label", step.get("label", ""))
            steps.append(resolved)

    return {
        "run_id": str(run_id),
        "plan_version": 1,
        "workflow_id": str(workflow_id),
        "workflow_version_id": str(version.id),
        "version_n": version.version_n,
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


async def _resolve_cloud_target_workspace_id(
    db: AsyncSession, *, user: ActorIdentity, target_workspace_id: UUID | None
) -> str:
    """Validate ownership of the cloud workspace a ``personal_cloud`` run targets.

    Returns its sandbox (anyharness) workspace id — the delivery destination.
    """

    if target_workspace_id is None:
        raise CloudApiError(
            "target_workspace_required",
            "A cloud workspace is required to run this workflow in the cloud.",
            status_code=400,
        )
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db, user.id, target_workspace_id
    )
    if workspace is None or workspace.archived_at is not None:
        raise CloudApiError(
            "target_workspace_not_found", "Cloud workspace not found.", status_code=404
        )
    if not workspace.anyharness_workspace_id:
        raise CloudApiError(
            "target_workspace_not_ready",
            "This cloud workspace is still materializing; try again shortly.",
            status_code=409,
        )
    return workspace.anyharness_workspace_id


async def start_run(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    *,
    inputs: dict[str, object],
    target_mode: str,
    trigger_kind: str = WORKFLOW_TRIGGER_MANUAL,
    version_id: UUID | None = None,
    target_workspace_id: UUID | None = None,
    trigger_id: UUID | None = None,
    scheduled_for: datetime | None = None,
    session_bindings: dict[str, str] | None = None,
) -> WorkflowRunRecord:
    if target_mode not in SUPPORTED_WORKFLOW_TARGET_MODES:
        raise CloudApiError(
            "invalid_target_mode",
            f"target_mode must be one of {sorted(SUPPORTED_WORKFLOW_TARGET_MODES)}.",
            status_code=400,
        )
    if trigger_kind not in SUPPORTED_WORKFLOW_TRIGGER_KINDS:
        raise CloudApiError("invalid_trigger_kind", "Unsupported trigger kind.", status_code=400)

    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot run an archived workflow.", status_code=409
        )

    # A seed (track 1f) has no owner — the runner is its effective owner for this
    # run: the run row, gateway token, provider-readiness check, and include
    # resolution are all scoped to the user launching it.
    effective_owner = workflow.owner_user_id or user.id

    # Cloud runs must name an owned, materialized workspace up front — resolve its
    # sandbox workspace id before creating the run so a bad target never records a
    # dangling pending_delivery row.
    cloud_anyharness_workspace_id: str | None = None
    if target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        cloud_anyharness_workspace_id = await _resolve_cloud_target_workspace_id(
            db, user=user, target_workspace_id=target_workspace_id
        )

    if version_id is not None:
        version = await store.get_version(db, version_id)
        if version is None or version.workflow_id != workflow_id:
            raise CloudApiError(
                "workflow_version_not_found", "Workflow version not found.", status_code=404
            )
    else:
        if workflow.current_version_id is None:
            raise CloudApiError(
                "workflow_no_version", "Workflow has no current version.", status_code=409
            )
        version = await store.get_version(db, workflow.current_version_id)
        if version is None:
            raise CloudApiError(
                "workflow_version_not_found", "Workflow version not found.", status_code=404
            )

    # Re-parse the pinned definition to obtain arg specs; it was validated on write.
    try:
        _canonical, arg_specs = parse_definition(version.definition_json)
    except WorkflowDefinitionError as exc:  # pragma: no cover - stored defs are valid
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc

    try:
        coerced_inputs = coerce_arguments(arg_specs, inputs)
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc

    # Composition (L20): inline any workflow.include steps into the agents spine,
    # server-side, before the flatten pass. This fails the run cleanly (no
    # pending_delivery row) if an include target changed since save, exceeds the
    # depth cap, is now multi-agent, or its arg mapping no longer covers the
    # child's required inputs.
    try:
        resolved_agents = await resolve_included_agents(
            db,
            owner_user_id=effective_owner,
            agents=list(version.definition_json.get("agents", [])),
        )
    except WorkflowCompositionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc

    # M1 (L30) v1 parallel bounds. A definition with parallel groups mandates
    # per-lane worktree isolation (sibling lanes can't share the pinned checkout).
    definition_has_parallel = has_parallel_groups(resolved_agents)
    if definition_has_parallel:
        # (b) Local (desktop) target can't run lanes: the desktop mints one
        # worktree per run and its executor doesn't understand lanes (a follow-up).
        if target_mode == WORKFLOW_TARGET_MODE_LOCAL:
            raise CloudApiError(
                "parallel_local_unsupported",
                "Workflows with parallel groups are cloud-only in v1; this run "
                "targets a local (desktop) worktree.",
                status_code=400,
            )
        # (a) A bound session lives in the pinned checkout and can't be isolated
        # into a lane worktree — so you can't bind into a laned run in v1.
        if session_bindings:
            raise CloudApiError(
                "parallel_bindings_unsupported",
                "session_bindings are not supported on a workflow whose definition "
                "has parallel groups (v1) — a laned run resolves to per-lane "
                "worktrees, which a bound session cannot join.",
                status_code=400,
            )

    # Per-run gateway scope (PR E, E3 namespace-level): the definition's declared
    # integration namespaces, stamped per slot. L22 fail-fast BEFORE the run row
    # exists — a declared namespace with no ready account fails the run cleanly
    # rather than silently narrowing the grant. No tools/list fetch at mint.
    run_scope = resolve_run_scope(version.definition_json)
    await assert_declared_providers_ready(
        db,
        owner_user_id=effective_owner,
        namespaces=granted_namespaces(run_scope),
    )

    # B8 session binding validation. (Harness-match stays at the runtime bind
    # boundary — a hard Malformed-plan error — since the slot->harness fact and the
    # session's harness both live in the runtime.)
    if session_bindings:
        known_slots = {node["slot"] for node in iter_agent_nodes(resolved_agents)}
        unknown = sorted(set(session_bindings) - known_slots)
        if unknown:
            raise CloudApiError(
                "unknown_session_binding_slot",
                f"session_bindings names slots not in this workflow: {unknown}.",
                status_code=400,
            )
        for slot, bound_session_id in session_bindings.items():
            # (ii) Not already held by a live run: the run row is the durable lock
            # (C13/E8). Silently re-owning a session another live run holds would
            # transfer ownership and leak the lockout — reject up front.
            holding_run_id = await store.live_run_holding_session(db, session_id=bound_session_id)
            if holding_run_id is not None:
                raise CloudApiError(
                    "session_binding_held",
                    f"session bound to slot '{slot}' is already held by live "
                    f"workflow run {holding_run_id}.",
                    status_code=409,
                )
            # (i) Belongs to the target workspace: if run history places the
            # session in a different workspace, reject (the runtime bind boundary
            # is the authoritative backstop for sessions with no history).
            if cloud_anyharness_workspace_id is not None:
                foreign_workspace = await store.session_foreign_workspace(
                    db,
                    session_id=bound_session_id,
                    target_workspace_id=cloud_anyharness_workspace_id,
                )
                if foreign_workspace is not None:
                    raise CloudApiError(
                        "session_binding_wrong_workspace",
                        f"session bound to slot '{slot}' belongs to a different "
                        "workspace than this run's target.",
                        status_code=409,
                    )

    run_id = uuid4()
    isolation = _resolve_run_isolation(
        target_mode=target_mode,
        session_bindings=session_bindings,
        definition_has_parallel=definition_has_parallel,
    )
    resolved_plan = _resolve_plan(
        run_id=run_id,
        workflow_id=workflow_id,
        version=version,
        trigger_kind=trigger_kind,
        target_mode=target_mode,
        coerced_inputs=coerced_inputs,
        session_bindings=session_bindings or {},
        agents=resolved_agents,
        isolation=isolation,
    )
    # Desktop-executor lane (2a, lifts L15): a server-created LOCAL run (a schedule
    # trigger firing on a local target) is born ``claimable`` — nothing on the
    # server delivers it; it waits for a desktop executor to claim it. A local
    # manual/chat run stays ``pending_delivery``: the desktop that called StartRun
    # already holds the plan and delivers it to its own runtime + calls /delivered.
    is_server_delivered = trigger_kind in WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS
    initial_status = (
        WORKFLOW_RUN_STATUS_CLAIMABLE
        if target_mode == WORKFLOW_TARGET_MODE_LOCAL and is_server_delivered
        else WORKFLOW_RUN_STATUS_PENDING_DELIVERY
    )
    run = await store.create_run(
        db,
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version_id=version.id,
        trigger_kind=trigger_kind,
        executor_user_id=effective_owner,
        args_json=coerced_inputs,
        target_mode=target_mode,
        resolved_plan_json=resolved_plan,
        anyharness_workspace_id=cloud_anyharness_workspace_id,
        trigger_id=trigger_id,
        scheduled_for=scheduled_for,
        status=initial_status,
    )

    # Mint the per-run gateway token for EVERY run (L16), both lanes, empty scope
    # legal. The plaintext lands in the plan's gateway block; the L25 subset
    # intersection with the delivering worker happens later, at cloud delivery,
    # when the worker is known (local lane ships the definition scope unchanged —
    # the runtime errors explicitly if it can't honor it, §5.3). The token FKs the
    # run row, so it is minted after create_run, then folded into the plan.
    _token, gateway_block = await mint_run_gateway_token(
        db, run_id=run_id, owner_user_id=effective_owner, scope=run_scope
    )
    resolved_plan["gateway"] = gateway_block
    updated = await store.update_run(db, run_id=run_id, resolved_plan_json=resolved_plan)
    return updated if updated is not None else run
