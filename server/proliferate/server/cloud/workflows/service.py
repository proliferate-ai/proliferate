"""Cloud workflows service layer.

Owns workflow/version CRUD, the free-plan cap, and ``StartRun`` — the single
resolution point (spec 3.2): load the pinned immutable version, coerce args,
eagerly interpolate ``{{args.*}}`` into a self-contained resolved plan, and record
a ``pending_delivery`` run whose id is the delivery idempotency key.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES,
    SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES,
    SUPPORTED_WORKFLOW_TARGET_MODES,
    SUPPORTED_WORKFLOW_TRIGGER_KINDS,
    SUPPORTED_WORKFLOW_TRIGGER_TYPES,
    WORKFLOW_POLL_MIN_INTERVAL_SECONDS,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_SESSION_BINDING_FRESH,
    WORKFLOW_SESSION_BINDING_HEADLESS,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
    WORKFLOW_STEP_AGENT_EMIT,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_CHAT,
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.cloud_workflow_triggers import WorkflowTriggerRecord
from proliferate.db.store.cloud_workflows import (
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
)
from proliferate.server.automations.domain.schedule import (
    AutomationScheduleError,
    ParsedAutomationSchedule,
    normalize_schedule,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.composition import (
    WorkflowCompositionError,
    resolve_included_agents,
    validate_includes,
)
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    ArgumentError,
    coerce_arguments,
    resolve_value,
)
from proliferate.server.cloud.workflows.domain.policy import (
    free_plan_workflow_limit,
    workflow_create_allowed,
)
from proliferate.server.cloud.workflows.domain.poll_contract import (
    derive_item_schema,
    validate_item_data,
)
from proliferate.server.cloud.workflows.domain.run_status import (
    RunTransitionError,
    check_transition,
    is_terminal,
)
from proliferate.server.cloud.workflows.gateway_grants import (
    assert_declared_providers_ready,
    granted_namespaces,
    mint_run_gateway_token,
    resolve_run_scope,
    visible_provider_namespaces,
)
from proliferate.server.cloud.workflows.models import (
    RunStatusRequest,
    TriggerPollRequest,
    TriggerScheduleRequest,
    WorkflowCreateRequest,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerUpdateRequest,
    WorkflowUpdateRequest,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

_TRIGGER_LOCAL_UNSUPPORTED_MESSAGE = (
    "Scheduled local runs are coming; run this workflow manually, or schedule it "
    "on a cloud workspace."
)
_POLL_LOCAL_UNSUPPORTED_MESSAGE = (
    "Poll triggers run in the cloud; point this trigger at a cloud workspace."
)


def _clean_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise CloudApiError("invalid_workflow", "name is required.", status_code=400)
    if len(cleaned) > WORKFLOW_SHORT_TEXT_MAX_LENGTH:
        raise CloudApiError(
            "invalid_workflow",
            f"name must be at most {WORKFLOW_SHORT_TEXT_MAX_LENGTH} characters.",
            status_code=400,
        )
    return cleaned


def _validated_definition(raw: dict[str, object]) -> dict[str, object]:
    # Saving a workflow permits a zero-step draft (the user builds it in the
    # editor after create); StartRun re-parses with require_steps=True so an
    # empty draft can be saved but not run.
    try:
        canonical, _specs = parse_definition(raw, require_steps=False)
    except WorkflowDefinitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    return canonical


async def _validate_workflow_includes(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    workflow_id: UUID | None,
    definition: dict[str, object],
) -> None:
    """Save-time composition checks (spec 3.5): target ownership, arg coverage, cycles.

    These need the DB (fetching each include target's current version), so they run
    here rather than in the pure ``parse_definition``.
    """

    try:
        await validate_includes(
            db,
            owner_user_id=owner_user_id,
            workflow_id=workflow_id,
            agents=list(definition.get("agents", [])),
        )
    except WorkflowCompositionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


async def _validate_workflow_functions(
    db: AsyncSession, *, owner_user_id: UUID, definition: dict[str, object]
) -> None:
    """Save-time L22 check: every declared ``functions`` provider must be a
    definition visible to the owner (seed + the owner's org customs).

    Structural validation (non-empty strings, no dup providers) already happened in
    ``parse_definition``; this needs owner context + the DB, so it runs here. It
    does NOT require a *ready account* — that is a StartRun-time (fail-the-run)
    concern, since accounts connect/disconnect independently of the definition.
    """

    namespaces = granted_namespaces(resolve_run_scope(definition))
    if not namespaces:
        return
    visible = await visible_provider_namespaces(db, owner_user_id=owner_user_id)
    unknown = sorted(set(namespaces) - visible)
    if unknown:
        raise CloudApiError(
            "workflow_function_provider_unknown",
            f"integrations reference provider(s) you cannot use: {unknown}.",
            status_code=400,
        )


async def visible_workflow(
    db: AsyncSession, *, user: ActorIdentity, workflow_id: UUID
) -> WorkflowRecord:
    """Fetch a workflow the actor owns, or raise a 404 (owner-scoped visibility)."""

    workflow = await store.get_workflow(db, workflow_id)
    if workflow is None or workflow.owner_user_id != user.id:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    return workflow


# Back-compat alias for the private call sites in this module.
_visible_workflow = visible_workflow


def workflow_arg_specs(version: WorkflowVersionRecord) -> list[ArgSpec]:
    """Parsed arg schema of a stored (already-validated) version."""

    try:
        _canonical, arg_specs = parse_definition(version.definition_json, require_steps=False)
    except WorkflowDefinitionError as exc:  # pragma: no cover - stored defs are valid
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    return arg_specs


def _split_repo_full_name(repo_full_name: str | None) -> tuple[str, str]:
    """Parse an "owner/name" repo pin. Raises 400 on a malformed value."""

    cleaned = (repo_full_name or "").strip()
    owner, _, name = cleaned.partition("/")
    if not owner or not name or "/" in name:
        raise CloudApiError(
            "invalid_repo",
            "Pin a repository as 'owner/name'.",
            status_code=400,
        )
    return owner, name


async def _ensure_trigger_target_workspace(
    db: AsyncSession, *, user: ActorIdentity, repo_full_name: str | None
) -> UUID:
    """D16: derive the trigger's target workspace from its repo pin.

    The trigger authors a repo; the server owns the workspace. This resolves the
    caller's cloud repo environment for the pin and provisions a dedicated,
    server-owned cloud workspace row for it (one warm workspace per trigger). The
    anyharness worktree is NOT materialized here — that stays a retry-at-fire
    concern (``start_run`` raises ``target_workspace_not_ready`` until the runtime
    workspace is ready), exactly as before the repo pin existed.
    """

    owner, name = _split_repo_full_name(repo_full_name)
    repo_environment = await repositories_store.get_cloud_repo_environment(
        db, user_id=user.id, git_owner=owner, git_repo_name=name
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Configure this repository as a cloud environment before pinning it to a trigger.",
            status_code=404,
        )
    # Reuse the warm workspace this repo already has, if any; otherwise create the
    # dedicated row. Either way the trigger-fire path is unchanged — it stamps this
    # id into start_run, which re-checks materialization (target_workspace_not_ready
    # stays a retry-at-fire concern for a row whose worktree isn't ready yet).
    existing = await cloud_workspace_store.get_active_cloud_workspace_for_repo_environment(
        db, user_id=user.id, repo_environment_id=repo_environment.id
    )
    if existing is not None:
        return existing.id
    branch = f"workflow-trigger/{uuid4().hex[:12]}"
    workspace = await cloud_workspace_store.create_cloud_workspace(
        db,
        user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name=f"{owner}/{name}",
        git_branch=branch,
        git_base_branch=repo_environment.default_branch or "main",
    )
    if workspace is None:  # pragma: no cover - the generated branch is unique
        raise CloudApiError(
            "cloud_workspace_create_failed",
            "Could not provision a workspace for the pinned repository.",
            status_code=409,
        )
    return workspace.id


async def _visible_run(
    db: AsyncSession, *, user: ActorIdentity, run_id: UUID
) -> WorkflowRunRecord:
    run = await store.get_run(db, run_id)
    if run is None or run.executor_user_id != user.id:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    return run


# --- workflow CRUD -------------------------------------------------------------


async def create_workflow(
    db: AsyncSession, user: ActorIdentity, body: WorkflowCreateRequest
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    name = _clean_name(body.name)
    definition = _validated_definition(body.definition)
    # workflow_id is None at create: the workflow has no id yet, so no include
    # cycle can involve it — self-include only becomes possible on update.
    await _validate_workflow_includes(
        db, owner_user_id=user.id, workflow_id=None, definition=definition
    )
    await _validate_workflow_functions(db, owner_user_id=user.id, definition=definition)
    active_count = await store.count_active_workflows(db, owner_user_id=user.id)
    if not workflow_create_allowed(active_count, max_allowed=free_plan_workflow_limit()):
        raise CloudApiError(
            "workflow_limit_reached",
            "Your plan allows one active workflow. Archive an existing workflow first.",
            status_code=403,
        )
    workflow, version = await store.create_workflow_with_version(
        db,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=name,
        description=body.description,
        definition_json=definition,
    )
    return workflow, [version]


async def update_workflow(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    body: WorkflowUpdateRequest,
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot update an archived workflow.", status_code=409
        )
    definition = _validated_definition(body.definition)
    await _validate_workflow_includes(
        db, owner_user_id=user.id, workflow_id=workflow_id, definition=definition
    )
    await _validate_workflow_functions(db, owner_user_id=user.id, definition=definition)
    name = _clean_name(body.name) if body.name is not None else None
    update_description = "description" in body.model_fields_set
    result = await store.append_version(
        db,
        workflow_id=workflow_id,
        definition_json=definition,
        created_by_user_id=user.id,
        name=name,
        description=body.description,
        update_description=update_description,
    )
    if result is None:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    updated, _version = result
    versions = list(await store.list_versions(db, workflow_id=workflow_id))
    return updated, versions


async def list_workflows(
    db: AsyncSession, user: ActorIdentity, *, include_archived: bool = False
) -> list[WorkflowRecord]:
    return list(
        await store.list_workflows(db, owner_user_id=user.id, include_archived=include_archived)
    )


async def get_workflow_detail(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    versions = list(await store.list_versions(db, workflow_id=workflow_id))
    return workflow, versions


async def archive_workflow(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> WorkflowRecord:
    await _visible_workflow(db, user=user, workflow_id=workflow_id)
    archived = await store.archive_workflow(db, workflow_id)
    if archived is None:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    return archived


# --- StartRun ------------------------------------------------------------------


def _default_session_binding(trigger_kind: str) -> str:
    """Per-slot session visibility default (A1): manual/chat = fresh (deep-linked
    in the run view), schedule/poll = headless (no UI focus)."""

    if trigger_kind in (WORKFLOW_TRIGGER_MANUAL, WORKFLOW_TRIGGER_CHAT):
        return WORKFLOW_SESSION_BINDING_FRESH
    return WORKFLOW_SESSION_BINDING_HEADLESS


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
    # E3/§2.6: the workflow-level integrations grant is stamped onto every slot
    # (per-slot narrowing is a later resolver-only change). Actual token mint +
    # all-tools scope expansion is PR E's phase.
    integrations = list(canonical.get("integrations", []))

    # First pass: assign each step its flattened index and build the
    # emit-name -> flat-index map the ref rewrite needs.
    emit_index: dict[str, int] = {}
    flat_position = 0
    for node in agents:
        for step in node["steps"]:
            if step.get("kind") == WORKFLOW_STEP_AGENT_EMIT:
                emit_index[step["name"]] = flat_position
            flat_position += 1

    default_binding = _default_session_binding(trigger_kind)
    sessions: dict[str, object] = {}
    steps: list[dict[str, object]] = []
    for node_index, node in enumerate(agents):
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
            # Lane "-" for the flat (non-parallel) case; the "<node>.<lane>.<step>"
            # shape (§4) is adopted now so lanes never re-key the contract.
            key = f"{node_index}.-.{step_index}"
            resolved = resolve_value(step, inputs=coerced_inputs, emit_index=emit_index)
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
            owner_user_id=workflow.owner_user_id,
            agents=list(version.definition_json.get("agents", [])),
        )
    except WorkflowCompositionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc

    # Per-run gateway scope (PR E, E3 namespace-level): the definition's declared
    # integration namespaces, stamped per slot. L22 fail-fast BEFORE the run row
    # exists — a declared namespace with no ready account fails the run cleanly
    # rather than silently narrowing the grant. No tools/list fetch at mint.
    run_scope = resolve_run_scope(version.definition_json)
    await assert_declared_providers_ready(
        db,
        owner_user_id=workflow.owner_user_id,
        namespaces=granted_namespaces(run_scope),
    )

    # B8 session binding validation. (Harness-match stays at the runtime bind
    # boundary — a hard Malformed-plan error — since the slot->harness fact and the
    # session's harness both live in the runtime.)
    if session_bindings:
        known_slots = {node["slot"] for node in resolved_agents}
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
            holding_run_id = await store.live_run_holding_session(
                db, session_id=bound_session_id
            )
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
    resolved_plan = _resolve_plan(
        run_id=run_id,
        workflow_id=workflow_id,
        version=version,
        trigger_kind=trigger_kind,
        target_mode=target_mode,
        coerced_inputs=coerced_inputs,
        session_bindings=session_bindings or {},
        agents=resolved_agents,
    )
    run = await store.create_run(
        db,
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version_id=version.id,
        trigger_kind=trigger_kind,
        executor_user_id=workflow.owner_user_id,
        args_json=coerced_inputs,
        target_mode=target_mode,
        resolved_plan_json=resolved_plan,
        anyharness_workspace_id=cloud_anyharness_workspace_id,
        trigger_id=trigger_id,
        scheduled_for=scheduled_for,
    )

    # Mint the per-run gateway token for EVERY run (L16), both lanes, empty scope
    # legal. The plaintext lands in the plan's gateway block; the L25 subset
    # intersection with the delivering worker happens later, at cloud delivery,
    # when the worker is known (local lane ships the definition scope unchanged —
    # the runtime errors explicitly if it can't honor it, §5.3). The token FKs the
    # run row, so it is minted after create_run, then folded into the plan.
    _token, gateway_block = await mint_run_gateway_token(
        db, run_id=run_id, owner_user_id=workflow.owner_user_id, scope=run_scope
    )
    resolved_plan["gateway"] = gateway_block
    updated = await store.update_run(db, run_id=run_id, resolved_plan_json=resolved_plan)
    return updated if updated is not None else run


# --- delivery + observed status ------------------------------------------------


async def mark_run_delivered(
    db: AsyncSession, user: ActorIdentity, run_id: UUID
) -> WorkflowRunRecord:
    await _visible_run(db, user=user, run_id=run_id)
    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    # Idempotent: only the first pending_delivery -> delivered transition writes.
    if locked.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
        return locked
    updated = await store.update_run(
        db,
        run_id=run_id,
        status=WORKFLOW_RUN_STATUS_DELIVERED,
        delivered_at=utcnow(),
        # A landed delivery clears any prior delivery_failed marker from a retry.
        clear_error=True,
    )
    assert updated is not None
    return updated


def _parse_cost(value: float | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise CloudApiError(
            "invalid_cost", "cost_usd is not a valid amount.", status_code=400
        ) from exc


async def report_run_status(
    db: AsyncSession, user: ActorIdentity, run_id: UUID, body: RunStatusRequest
) -> WorkflowRunRecord:
    await _visible_run(db, user=user, run_id=run_id)
    if body.status not in WORKFLOW_RUN_OBSERVABLE_STATUSES:
        raise CloudApiError(
            "invalid_run_status",
            f"status must be one of {sorted(WORKFLOW_RUN_OBSERVABLE_STATUSES)}.",
            status_code=400,
        )
    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    try:
        check_transition(locked.status, body.status)
    except RunTransitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=409) from exc

    now = utcnow()
    started_at = (
        now if body.status == WORKFLOW_RUN_STATUS_RUNNING and locked.started_at is None else None
    )
    finished_at = now if is_terminal(body.status) and locked.finished_at is None else None

    updated = await store.update_run(
        db,
        run_id=run_id,
        status=body.status,
        step_cursor=body.step_cursor,
        step_outputs_json=body.step_outputs,
        error_code=body.error_code,
        error_message=body.error_message,
        anyharness_workspace_id=body.anyharness_workspace_id,
        anyharness_session_ids=body.anyharness_session_ids,
        cost_usd=_parse_cost(body.cost_usd),
        cost_tokens=body.cost_tokens,
        started_at=started_at,
        finished_at=finished_at,
    )
    assert updated is not None

    # Terminal status is the choke point that expires the per-run gateway token
    # (idempotent — an already-terminal run has no active token). Do this before
    # apply_step_actions so a crash mid-actions still leaves the token expired.
    if is_terminal(updated.status):
        await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)

    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=updated)
    except Exception:
        logger.exception("apply_step_actions failed run_id=%s", run_id)

    return updated


async def list_runs(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    workflow_id: UUID | None = None,
) -> list[WorkflowRunRecord]:
    if workflow_id is not None:
        await _visible_workflow(db, user=user, workflow_id=workflow_id)
    return list(await store.list_runs(db, executor_user_id=user.id, workflow_id=workflow_id))


async def get_run(db: AsyncSession, user: ActorIdentity, run_id: UUID) -> WorkflowRunRecord:
    return await _visible_run(db, user=user, run_id=run_id)


# --- triggers (spec 3.5) -------------------------------------------------------
#
# A trigger pins target + schedule + concurrency and funnels to the *same*
# StartRun above — it owns no execution. Validation reuses the house pieces:
# schedule RRULE/timezone via ``automations.domain.schedule.normalize_schedule``
# (identical hourly/daily cursor rules), arg coverage via ``coerce_arguments``
# (so required args must be covered), workspace ownership via the helper above.
#
# Local schedule decision (v1): **rejected at create**. The workflow local lane is
# entirely client-initiated (the desktop calls StartRun, hands the plan to its own
# runtime, and relays state); there is no server→desktop claim protocol for
# workflow runs and no repo/workspace binding to tell an executor *where* to run.
# Building that is the automations claim machinery again — out of scope — so
# scheduled runs are cloud-only until it lands.


def _validate_trigger_kind(kind: str) -> None:
    if kind not in SUPPORTED_WORKFLOW_TRIGGER_TYPES:
        raise CloudApiError(
            "invalid_trigger_kind", f"Unsupported trigger kind '{kind}'.", status_code=400
        )


def _validate_concurrency(policy: str) -> None:
    if policy not in SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES:
        allowed = sorted(SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES)
        raise CloudApiError(
            "invalid_concurrency_policy",
            f"concurrency_policy must be one of {allowed}.",
            status_code=400,
        )


def _validate_missed_run_policy(policy: str) -> None:
    if policy not in SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES:
        allowed = sorted(SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES)
        raise CloudApiError(
            "invalid_missed_run_policy",
            f"missed_run_policy must be one of {allowed}.",
            status_code=400,
        )


def _validate_trigger_target_mode(
    mode: str, *, kind: str = WORKFLOW_TRIGGER_KIND_SCHEDULE
) -> None:
    # Locked v1 decision (spec 5.1/5.3): schedule AND poll triggers are cloud-only
    # (no server→desktop claim protocol exists). Reject local cleanly rather than
    # record a run nobody delivers.
    is_poll = kind == WORKFLOW_TRIGGER_KIND_POLL
    if mode == WORKFLOW_TARGET_MODE_LOCAL:
        raise CloudApiError(
            "poll_local_unsupported" if is_poll else "schedule_local_unsupported",
            _POLL_LOCAL_UNSUPPORTED_MESSAGE if is_poll else _TRIGGER_LOCAL_UNSUPPORTED_MESSAGE,
            status_code=400,
        )
    if mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        raise CloudApiError(
            "invalid_target_mode",
            "target_mode must be 'personal_cloud' for "
            + ("poll" if is_poll else "scheduled")
            + " triggers.",
            status_code=400,
        )


def _normalize_trigger_schedule(schedule: TriggerScheduleRequest) -> ParsedAutomationSchedule:
    try:
        return normalize_schedule(
            rrule_text=schedule.rrule, timezone=schedule.timezone, now=utcnow()
        )
    except AutomationScheduleError as exc:
        raise CloudApiError("invalid_schedule", str(exc), status_code=400) from exc


def _coerce_schedule_presets(
    arg_specs: list[ArgSpec], *, presets: dict[str, object]
) -> dict[str, object]:
    """Coerce a schedule trigger's preset input values (D16).

    Partial (only the presets provided are coerced; unknown keys and bad types
    still fail): a schedule with incomplete presets can be SAVED as a draft; the
    enable-gate — not coercion — is what blocks enabling it.
    """

    try:
        return coerce_arguments([spec for spec in arg_specs if spec.name in presets], presets)
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


def _assert_schedule_enable_gate(
    arg_specs: list[ArgSpec], *, presets: dict[str, object], enabled: bool
) -> None:
    """D16 enable-gate: an ENABLED schedule trigger must preset every required
    input (a disabled draft may leave them blank)."""

    if not enabled:
        return
    missing = sorted(spec.name for spec in arg_specs if spec.required and spec.name not in presets)
    if missing:
        raise CloudApiError(
            "schedule_presets_incomplete",
            f"Preset every required input before enabling this schedule: {missing}.",
            status_code=400,
        )


async def _workflow_arg_specs_or_raise(
    db: AsyncSession, *, workflow_current_version_id: UUID | None
) -> list[ArgSpec]:
    if workflow_current_version_id is None:
        raise CloudApiError(
            "workflow_no_version",
            "Add at least one step before adding a trigger to this workflow.",
            status_code=409,
        )
    version = await store.get_version(db, workflow_current_version_id)
    if version is None:
        raise CloudApiError(
            "workflow_version_not_found", "Workflow version not found.", status_code=404
        )
    return workflow_arg_specs(version)


@dataclass(frozen=True)
class _ValidatedPollConfig:
    url: str
    auth_header: str | None
    interval_secs: int
    # None + update_auth False => keep existing; otherwise write this ciphertext.
    auth_ciphertext: str | None
    update_auth: bool
    # The plaintext auth value, kept only in-process for the init-time endpoint
    # probe (never returned to a caller, never stored plaintext). None on an
    # update that keeps the existing secret — the probe decrypts it instead.
    auth_value_plaintext: str | None


def _validate_poll_config(poll: TriggerPollRequest, *, is_update: bool) -> _ValidatedPollConfig:
    """Validate + normalize the poll endpoint config. Encrypts the auth value at
    write (never stored plaintext). ``is_update`` allows omitting the auth value to
    keep the existing stored secret."""

    url = poll.url.strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise CloudApiError(
            "invalid_poll_config", "poll url must be an http(s) URL.", status_code=400
        )
    if poll.interval_secs < WORKFLOW_POLL_MIN_INTERVAL_SECONDS:
        raise CloudApiError(
            "invalid_poll_interval",
            f"poll interval must be at least {WORKFLOW_POLL_MIN_INTERVAL_SECONDS} seconds.",
            status_code=400,
        )

    auth_header = poll.auth_header.strip() if poll.auth_header else None
    if auth_header is None:
        # No auth header: any supplied value is meaningless; clear the secret.
        if poll.auth_value:
            raise CloudApiError(
                "invalid_poll_config",
                "an auth value requires an auth header name.",
                status_code=400,
            )
        return _ValidatedPollConfig(
            url=url,
            auth_header=None,
            interval_secs=poll.interval_secs,
            auth_ciphertext=None,
            update_auth=True,  # explicit "no auth"
            auth_value_plaintext=None,
        )
    if poll.auth_value:
        return _ValidatedPollConfig(
            url=url,
            auth_header=auth_header,
            interval_secs=poll.interval_secs,
            auth_ciphertext=encrypt_text(poll.auth_value),
            update_auth=True,
            auth_value_plaintext=poll.auth_value,
        )
    # Header named but no value supplied. On create this means "no secret"; on
    # update it means "keep the stored secret".
    if not is_update:
        raise CloudApiError(
            "invalid_poll_config",
            "an auth header requires an auth value on create.",
            status_code=400,
        )
    return _ValidatedPollConfig(
        url=url,
        auth_header=auth_header,
        interval_secs=poll.interval_secs,
        auth_ciphertext=None,
        update_auth=False,
        auth_value_plaintext=None,
    )


def _validate_poll_static_inputs(
    arg_specs: list[ArgSpec], *, static_inputs: dict[str, object]
) -> dict[str, object]:
    """Coerce a poll trigger's static input presets against the workflow inputs.

    Only the presets provided are coerced (strict: unknown keys and bad types
    fail at write, not at poll time). Required inputs NOT covered by a preset or a
    default are expected to arrive per-item in ``item.data`` — the derived item
    schema (D17) marks them required so the poller records a missing/mistyped item
    ``invalid``. The merged per-item inputs are re-coerced inside ``start_run``.
    """

    try:
        return coerce_arguments(
            [spec for spec in arg_specs if spec.name in static_inputs], static_inputs
        )
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


async def _probe_poll_signature(
    config: _ValidatedPollConfig,
    *,
    item_schema: dict[str, object],
    existing_ciphertext: str | None = None,
) -> None:
    """Init-time inputs-signature check (contract §2.2, amending L33a).

    GET the endpoint once and validate that returned items' ``data`` carries
    fields named and typed exactly like the workflow's declared inputs (the
    derived ``item_schema``). A shape mismatch fails the trigger create/update so
    a misconfigured endpoint is caught before the poller ever fires. An endpoint
    with no items to sample passes (nothing to contradict the signature).
    """

    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    if config.auth_value_plaintext is not None:
        auth_value: str | None = config.auth_value_plaintext
    elif config.auth_header is not None and existing_ciphertext is not None:
        auth_value = decrypt_text(existing_ciphertext)
    else:
        auth_value = None
    try:
        page = await fetch_poll_page(
            url=config.url,
            auth_header=config.auth_header,
            auth_value=auth_value,
            cursor=None,
        )
    except Exception as exc:
        raise CloudApiError(
            "poll_probe_failed",
            f"Could not reach the poll endpoint to verify its item shape: {exc}",
            status_code=400,
        ) from exc
    for item in page.items:
        error = validate_item_data(item.data, item_schema)
        if error is not None:
            raise CloudApiError(
                "poll_signature_mismatch",
                f"Poll item '{item.id}' does not match the workflow's declared inputs: {error}",
                status_code=400,
            )


async def _visible_trigger(
    db: AsyncSession, *, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> WorkflowTriggerRecord:
    await _visible_workflow(db, user=user, workflow_id=workflow_id)
    trigger = await trigger_store.get_trigger(db, trigger_id)
    if trigger is None or trigger.workflow_id != workflow_id:
        raise CloudApiError("trigger_not_found", "Trigger not found.", status_code=404)
    return trigger


async def create_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    body: WorkflowTriggerCreateRequest,
) -> WorkflowTriggerRecord:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot schedule an archived workflow.", status_code=409
        )
    _validate_trigger_kind(body.kind)
    _validate_concurrency(body.concurrency_policy)
    _validate_missed_run_policy(body.missed_run_policy)
    _validate_trigger_target_mode(body.target_mode, kind=body.kind)
    # D16: the repo pin is the authored "where"; the server derives + owns the
    # workspace it maps to.
    target_workspace_id = await _ensure_trigger_target_workspace(
        db, user=user, repo_full_name=body.repo_full_name
    )

    if body.kind == WORKFLOW_TRIGGER_KIND_POLL:
        return await _create_poll_trigger(
            db, user, workflow, body, target_workspace_id=target_workspace_id
        )

    parsed = _normalize_trigger_schedule(_require_schedule(body.schedule))
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    presets = _coerce_schedule_presets(arg_specs, presets=body.args)
    _assert_schedule_enable_gate(arg_specs, presets=presets, enabled=body.enabled)
    return await trigger_store.create_trigger(
        db,
        workflow_id=workflow_id,
        created_by_user_id=user.id,
        kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
        concurrency_policy=body.concurrency_policy,
        missed_run_policy=body.missed_run_policy,
        target_mode=body.target_mode,
        repo_full_name=body.repo_full_name,
        target_workspace_id=target_workspace_id,
        input_presets_json=presets,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=parsed.next_run_at,
        # For schedule triggers the presets ARE the fire-time args.
        args_json=presets,
        enabled=body.enabled,
    )


def _require_schedule(schedule: TriggerScheduleRequest | None) -> TriggerScheduleRequest:
    if schedule is None:
        raise CloudApiError(
            "invalid_schedule", "A schedule is required for a schedule trigger.", status_code=400
        )
    return schedule


async def _create_poll_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow: WorkflowRecord,
    body: WorkflowTriggerCreateRequest,
    *,
    target_workspace_id: UUID,
) -> WorkflowTriggerRecord:
    if body.poll is None:
        raise CloudApiError(
            "invalid_poll_config", "A poll config is required for a poll trigger.", status_code=400
        )
    config = _validate_poll_config(body.poll, is_update=False)
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    coerced_static = _validate_poll_static_inputs(arg_specs, static_inputs=body.args)
    # The item schema is DERIVED from the inputs (D17): inputs already covered by a
    # static preset need not appear per-item, so they are not required on the item.
    item_schema = derive_item_schema(arg_specs, covered_names=coerced_static.keys())
    await _probe_poll_signature(config, item_schema=item_schema)
    return await trigger_store.create_trigger(
        db,
        workflow_id=workflow.id,
        created_by_user_id=user.id,
        kind=WORKFLOW_TRIGGER_KIND_POLL,
        concurrency_policy=body.concurrency_policy,
        target_mode=body.target_mode,
        repo_full_name=body.repo_full_name,
        target_workspace_id=target_workspace_id,
        poll_url=config.url,
        poll_auth_header=config.auth_header,
        poll_auth_ciphertext=config.auth_ciphertext,
        poll_interval_secs=config.interval_secs,
        poll_item_schema_json=item_schema,
        args_json=coerced_static,
        enabled=body.enabled,
    )


async def list_triggers(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> list[WorkflowTriggerRecord]:
    await _visible_workflow(db, user=user, workflow_id=workflow_id)
    return list(await trigger_store.list_triggers_for_workflow(db, workflow_id=workflow_id))


async def get_trigger(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> WorkflowTriggerRecord:
    return await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)


async def update_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    trigger_id: UUID,
    body: WorkflowTriggerUpdateRequest,
) -> WorkflowTriggerRecord:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    existing = await _visible_trigger(
        db, user=user, workflow_id=workflow_id, trigger_id=trigger_id
    )

    # Merge onto the existing config, then re-validate the whole trigger.
    target_mode = body.target_mode if body.target_mode is not None else existing.target_mode
    concurrency = (
        body.concurrency_policy
        if body.concurrency_policy is not None
        else existing.concurrency_policy
    )
    missed_run_policy = (
        body.missed_run_policy
        if body.missed_run_policy is not None
        else existing.missed_run_policy
    )
    enabled = body.enabled if body.enabled is not None else existing.enabled
    _validate_concurrency(concurrency)
    _validate_missed_run_policy(missed_run_policy)
    _validate_trigger_target_mode(target_mode, kind=existing.kind)

    # D16: re-pinning the repo re-derives a fresh server-owned workspace; leaving
    # it alone keeps the existing derived workspace.
    repo_changed = (
        body.repo_full_name is not None
        and body.repo_full_name.strip() != (existing.repo_full_name or "")
    )
    repo_full_name = body.repo_full_name if repo_changed else existing.repo_full_name
    if repo_changed:
        target_workspace_id: UUID | None = await _ensure_trigger_target_workspace(
            db, user=user, repo_full_name=body.repo_full_name
        )
    else:
        target_workspace_id = existing.target_workspace_id

    if existing.kind == WORKFLOW_TRIGGER_KIND_POLL:
        return await _update_poll_trigger(
            db,
            workflow=workflow,
            existing=existing,
            body=body,
            enabled=enabled,
            concurrency=concurrency,
            target_mode=target_mode,
            repo_full_name=repo_full_name,
            target_workspace_id=target_workspace_id,
        )
    if body.poll is not None:
        raise CloudApiError(
            "invalid_poll_config", "This trigger is not a poll trigger.", status_code=400
        )

    # Schedule: recompute the cursor only when it would otherwise be stale — the
    # RRULE/timezone changed, or the trigger is (re-)entering the due scan. An
    # args-/concurrency-only edit on a running trigger must NOT shift next_run_at,
    # and a dormant past slot must not fire the instant it re-enables.
    schedule_changed = body.schedule is not None and (
        body.schedule.rrule.strip() != (existing.schedule_rrule or "")
        or body.schedule.timezone.strip() != (existing.schedule_timezone or "")
    )
    schedule_source = body.schedule or TriggerScheduleRequest(
        rrule=existing.schedule_rrule or "", timezone=existing.schedule_timezone or ""
    )
    parsed = _normalize_trigger_schedule(schedule_source)
    becoming_enabled = enabled and not existing.enabled
    recompute_cursor = schedule_changed or becoming_enabled or existing.next_run_at is None
    next_run_at = parsed.next_run_at if recompute_cursor else None

    presets_source = body.args if body.args is not None else existing.input_presets_json or {}
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    presets = _coerce_schedule_presets(arg_specs, presets=presets_source)
    _assert_schedule_enable_gate(arg_specs, presets=presets, enabled=enabled)

    updated = await trigger_store.update_trigger(
        db,
        trigger_id=trigger_id,
        enabled=enabled,
        concurrency_policy=concurrency,
        missed_run_policy=missed_run_policy,
        target_mode=target_mode,
        repo_full_name=repo_full_name,
        target_workspace_id=target_workspace_id,
        input_presets_json=presets,
        write_input_presets=True,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=next_run_at,
        args_json=presets,
    )
    assert updated is not None
    return updated


async def _update_poll_trigger(
    db: AsyncSession,
    *,
    workflow: WorkflowRecord,
    existing: WorkflowTriggerRecord,
    body: WorkflowTriggerUpdateRequest,
    enabled: bool,
    concurrency: str,
    target_mode: str,
    repo_full_name: str | None,
    target_workspace_id: UUID | None,
) -> WorkflowTriggerRecord:
    if body.schedule is not None:
        raise CloudApiError(
            "invalid_schedule", "A poll trigger has no schedule.", status_code=400
        )

    # Poll config: a supplied ``poll`` block fully replaces the endpoint config
    # (auth value stays write-only — omitting it keeps the stored secret). Absent,
    # the existing config stands and only enabled/concurrency/target/args change.
    config = _validate_poll_config(body.poll, is_update=True) if body.poll is not None else None

    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    static_args = body.args if body.args is not None else existing.args_json
    coerced_static = _validate_poll_static_inputs(arg_specs, static_inputs=static_args)
    # Re-derive the item schema whenever the inputs' static coverage may have moved.
    item_schema = derive_item_schema(arg_specs, covered_names=coerced_static.keys())

    # Re-probe the endpoint on any poll-block edit (config could reshape auth/url).
    # An inputs/preset edit that reshapes the derived schema is still persisted, but
    # the endpoint the poller hits is unchanged so no fresh probe is warranted.
    if config is not None:
        await _probe_poll_signature(
            config, item_schema=item_schema, existing_ciphertext=existing.poll_auth_ciphertext
        )

    # Always rewrite the derived item schema (inputs may have changed); pass the
    # existing endpoint fields through when no poll block was supplied so they are
    # never nulled.
    updated = await trigger_store.update_trigger(
        db,
        trigger_id=existing.id,
        enabled=enabled,
        concurrency_policy=concurrency,
        target_mode=target_mode,
        repo_full_name=repo_full_name,
        target_workspace_id=target_workspace_id,
        args_json=coerced_static,
        write_poll_config=True,
        poll_url=config.url if config is not None else existing.poll_url,
        poll_auth_header=(config.auth_header if config is not None else existing.poll_auth_header),
        poll_interval_secs=(
            config.interval_secs if config is not None else existing.poll_interval_secs
        ),
        poll_item_schema_json=item_schema,
        update_poll_auth=config.update_auth if config is not None else False,
        poll_auth_ciphertext=config.auth_ciphertext if config is not None else None,
    )
    assert updated is not None
    return updated


async def delete_trigger(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> None:
    await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)
    await trigger_store.delete_trigger(db, trigger_id)


async def list_trigger_items(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    trigger_id: UUID,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[trigger_store.WorkflowTriggerItemRecord]:
    """A poll trigger's seen-set items, newest first (the per-item trigger UI)."""

    await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)
    return list(
        await trigger_store.list_trigger_items(
            db, trigger_id=trigger_id, limit=limit, offset=offset
        )
    )
