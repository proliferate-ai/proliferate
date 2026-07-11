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
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.capability_resolution import freeze_capability_leases
from proliferate.server.cloud.workflows.composition import resolve_included_agents
from proliferate.server.cloud.workflows.contracts import content_hash
from proliferate.server.cloud.workflows.domain.composition import WorkflowCompositionError
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    has_parallel_groups,
    iter_agent_nodes,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgumentError,
    coerce_arguments,
)
from proliferate.server.cloud.workflows.domain.resolved_plan import (
    resolve_plan as _resolve_plan,
)
from proliferate.server.cloud.workflows.domain.resolved_plan import (
    resolve_run_isolation as _resolve_run_isolation,
)
from proliferate.server.cloud.workflows.gateway_grants import (
    assert_declared_providers_ready,
    granted_namespaces,
    mint_private_envelope,
    resolve_run_scope,
)
from proliferate.server.cloud.workflows.service import visible_workflow

# Cross-module call into service.py, the API-facing owner of workflow
# visibility (one-directional: service.py does not import this module).
_visible_workflow = visible_workflow


# Delivery-identity resolved-plan schema version (spec §5.2/§5.3).
_RESOLVED_PLAN_VERSION = 2


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
        definition_json=version.definition_json,
        workflow_version_id=version.id,
        version_n=version.version_n,
        trigger_kind=trigger_kind,
        target_mode=target_mode,
        coerced_inputs=coerced_inputs,
        session_bindings=session_bindings or {},
        agents=resolved_agents,
        isolation=isolation,
    )
    # SHA-256 over RFC 8785 canonical JSON of the complete logical (secret-free)
    # plan (spec §5.2 duty 9). The plan carries no ``planHash`` field, so the
    # content hash over the whole plan is exactly "excluding planHash". Immutable
    # once persisted alongside the plan.
    plan_hash = content_hash(resolved_plan)
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
        # Immutable delivery identity (§5.2/§5.3) + the desired/delivery state
        # axes (§8.1) begin here. ``status`` still drives all current code;
        # public presentation derives — no consumer cutover yet.
        plan_hash=plan_hash,
        plan_version=_RESOLVED_PLAN_VERSION,
        desired_state="running",
        delivery_state="ready",
    )

    # Build the PRIVATE execution envelope (spec §5.3): the legacy all-purpose
    # gateway token (L16) PLUS the WS3b audience-separated control credentials +
    # per-slot one-use integration-credential issuance handles. All plaintext lives
    # ONLY here — never the logical plan — so ordinary run APIs stay secret-free.
    envelope = await mint_private_envelope(
        db, run_id=run_id, owner_user_id=effective_owner, scope=run_scope, plan_hash=plan_hash
    )
    updated = await store.update_run(db, run_id=run_id, private_envelope_json=envelope)

    # WS3a: freeze the run's EXACT per-slot capability leases — the new frozen
    # truth alongside the namespace token above. This runs in parallel with the
    # namespace grant (the runtime still consumes namespaces until WS3b/WS5c);
    # enforcement cutover is WS3b/WS3c. A resolution failure must not create a
    # dangling run, so it happens in the same transaction as the run row.
    membership = await organizations_store.get_current_membership_for_user(db, effective_owner)
    await freeze_capability_leases(
        db,
        run_id=run_id,
        owner_user_id=effective_owner,
        organization_id=membership.organization.id if membership is not None else None,
        run_scope=run_scope,
        plan_hash=plan_hash,
    )
    return updated if updated is not None else run
