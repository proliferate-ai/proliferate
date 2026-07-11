"""StartRun compiler (spec 3.2): the single resolution point for a run.

Load the pinned immutable version, coerce args, expand ``workflow.include``
composition, resolve run isolation, eagerly interpolate ``{{args.*}}`` into a
self-contained resolved plan, and record a cloud ``pending_delivery`` or local
``claimable`` run whose id is the delivery
idempotency key.

Split out of ``service.py`` (ownership-only, WS0B-S): ``service.py`` keeps
API-facing CRUD/visibility, worker-facing delivery/observed-status handling
lives in ``worker/service.py``, and trigger CRUD/poll validation lives in
``triggers.py``. This module owns only StartRun compilation.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_TARGET_MODES,
    SUPPORTED_WORKFLOW_TRIGGER_KINDS,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_workflows import (
    WorkflowRunRecord,
    WorkflowVersionRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import source_resolution, trigger_activation
from proliferate.server.cloud.workflows.capability_resolution import freeze_capability_leases
from proliferate.server.cloud.workflows.composition import resolve_included_agents
from proliferate.server.cloud.workflows.contracts.canonical import CanonicalizationError
from proliferate.server.cloud.workflows.contracts.models import (
    LegacyResolvedPlanV1,
)
from proliferate.server.cloud.workflows.contracts.models import (
    plan_hash as compute_plan_hash,
)
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
    resolve_run_scope,
)
from proliferate.server.cloud.workflows.service import visible_workflow

# Cross-module call into service.py, the API-facing owner of workflow
# visibility (one-directional: service.py does not import this module).
_visible_workflow = visible_workflow


# Honest version of the currently executable legacy flattened plan. WF-PLAN-V2
# owns the later atomic producer + runtime-adapter cutover to strict plan v2.
_RESOLVED_PLAN_VERSION = 1


@dataclass(frozen=True)
class _WorkflowSnapshot:
    owner_user_id: UUID | None
    is_seed: bool


@dataclass(frozen=True)
class _VersionSnapshot:
    id: UUID
    workflow_id: UUID
    version_n: int
    definition_json: dict[str, object]
    created_by_user_id: UUID | None
    created_at: datetime


def _snapshot_version(version: WorkflowVersionRecord) -> _VersionSnapshot:
    return _VersionSnapshot(
        id=version.id,
        workflow_id=version.workflow_id,
        version_n=version.version_n,
        definition_json=deepcopy(version.definition_json),
        created_by_user_id=version.created_by_user_id,
        created_at=version.created_at,
    )


def _version_matches(
    snapshot: _VersionSnapshot, current: WorkflowVersionRecord | None
) -> bool:
    return (
        current is not None
        and current.id == snapshot.id
        and current.workflow_id == snapshot.workflow_id
        and current.version_n == snapshot.version_n
        and current.definition_json == snapshot.definition_json
        and current.created_by_user_id == snapshot.created_by_user_id
        and current.created_at == snapshot.created_at
    )


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
    release_source_snapshot: Callable[[], Awaitable[None]] | None = None,
) -> WorkflowRunRecord:
    user_id = user.id
    if target_mode not in SUPPORTED_WORKFLOW_TARGET_MODES:
        raise CloudApiError(
            "invalid_target_mode",
            f"target_mode must be one of {sorted(SUPPORTED_WORKFLOW_TARGET_MODES)}.",
            status_code=400,
        )
    if trigger_kind not in SUPPORTED_WORKFLOW_TRIGGER_KINDS:
        raise CloudApiError("invalid_trigger_kind", "Unsupported trigger kind.", status_code=400)
    if trigger_kind != WORKFLOW_TRIGGER_MANUAL:
        trigger_activation.reject_unattended_activation()

    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot run an archived workflow.", status_code=409
        )

    # A seed (track 1f) has no owner — the runner is its effective owner for this
    # run: the run row, provider-readiness check, and include resolution are all
    # scoped to the user launching it.
    workflow_snapshot = _WorkflowSnapshot(
        owner_user_id=workflow.owner_user_id,
        is_seed=workflow.is_seed,
    )
    effective_owner = workflow_snapshot.owner_user_id or user_id

    # Capture the immutable workflow version before any source-provider I/O.
    # Source resolution invokes the caller-owned read-transaction
    # release before GitHub is called; this frozen value is the version the
    # run compiles even if the workflow's current-version pointer changes while
    # that provider request is in flight.
    if version_id is not None:
        version_record = await store.get_version(db, version_id)
        if version_record is None or version_record.workflow_id != workflow_id:
            raise CloudApiError(
                "workflow_version_not_found", "Workflow version not found.", status_code=404
            )
    else:
        if workflow.current_version_id is None:
            raise CloudApiError(
                "workflow_no_version", "Workflow has no current version.", status_code=409
            )
        version_record = await store.get_version(db, workflow.current_version_id)
        if version_record is None:
            raise CloudApiError(
                "workflow_version_not_found", "Workflow version not found.", status_code=404
            )
    version = _snapshot_version(version_record)

    # Cloud runs must name an owned, materialized workspace up front — resolve its
    # sandbox workspace id before creating the run so a bad target never records a
    # dangling pending_delivery row.
    cloud_anyharness_workspace_id: str | None = None
    source_intent: dict[str, object] = {"kind": "workspace_checkpoint"}
    if target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        if release_source_snapshot is None:
            raise CloudApiError(
                "workflow_source_transaction_boundary_required",
                "Manual cloud source resolution requires a caller-owned transaction boundary.",
                status_code=409,
            )
        cloud_target = await source_resolution.resolve_cloud_target(
            db,
            user=user,
            target_workspace_id=target_workspace_id,
            release_source_snapshot=release_source_snapshot,
        )
        cloud_anyharness_workspace_id = cloud_target.anyharness_workspace_id
        source_intent = cloud_target.source_intent
        # The full source-fence lock order is workspace -> repository -> GitHub
        # auth -> installation -> repository coverage -> workflow -> version.
        # Provider I/O completed before the first lock; none follows a re-lock.
        current_workflow = await store.get_workflow(db, workflow_id, lock_row=True)
        current_version = await store.get_version(db, version.id, lock_row=True)
        if (
            current_workflow is None
            or current_workflow.archived_at is not None
            or current_workflow.owner_user_id != workflow_snapshot.owner_user_id
            or current_workflow.is_seed != workflow_snapshot.is_seed
            or (current_workflow.owner_user_id != user_id and not current_workflow.is_seed)
            or not _version_matches(version, current_version)
        ):
            raise CloudApiError(
                "workflow_source_fence_changed",
                "Workflow authorization or pinned version changed during source resolution.",
                status_code=409,
            )
    elif target_workspace_id is None:
        raise CloudApiError(
            "local_target_workspace_required",
            "A local run must pin its intended AnyHarness workspace before claiming.",
            status_code=400,
        )
    else:
        cloud_anyharness_workspace_id = str(target_workspace_id)

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
        source_intent=source_intent,
    )
    # SHA-256 over RFC 8785 canonical JSON of the complete logical plan excluding
    # only ``planHash``. Persist the same self-describing legacy-v1 object that is hashed;
    # delivery must never append a second version/hash spelling later.
    try:
        plan_hash = compute_plan_hash(resolved_plan)
    except CanonicalizationError as exc:
        raise CloudApiError(
            "workflow_plan_canonicalization_invalid",
            "Run inputs or stored workflow content contain non-canonical JSON.",
            status_code=409,
        ) from exc
    resolved_plan["planHash"] = plan_hash
    try:
        LegacyResolvedPlanV1.model_validate(resolved_plan)
    except ValidationError as exc:
        raise CloudApiError(
            "workflow_plan_contract_invalid",
            "Resolved workflow content is outside the executable plan contract.",
            status_code=409,
        ) from exc
    # Every local run, including manual/chat, is born ``claimable``. Claim is the
    # sole authority transition into materialization; no caller-side alternate
    # delivery path exists. Unattended trigger activation itself remains parked.
    initial_status = (
        WORKFLOW_RUN_STATUS_CLAIMABLE
        if target_mode == WORKFLOW_TARGET_MODE_LOCAL
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
        preaccept_cancel_state="none",
    )

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
    # WF-ID stops here. No gateway/report/control/integration credential is
    # minted and no runtime receives the plan. Materialization offer + binding
    # acceptance happen next; WF-CRED later owns the final execution envelope.
    return run
