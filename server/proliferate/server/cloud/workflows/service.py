"""Cloud workflows service layer.

Owns workflow/version CRUD, the free-plan cap, and ``StartRun`` — the single
resolution point (spec 3.2): load the pinned immutable version, coerce args,
eagerly interpolate ``{{args.*}}`` into a self-contained resolved plan, and record
a ``pending_delivery`` run whose id is the delivery idempotency key.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES,
    SUPPORTED_WORKFLOW_TARGET_MODES,
    SUPPORTED_WORKFLOW_TRIGGER_KINDS,
    SUPPORTED_WORKFLOW_TRIGGER_TYPES,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
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
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    ArgumentError,
    coerce_arguments,
    interpolate_args,
)
from proliferate.server.cloud.workflows.domain.policy import (
    free_plan_workflow_limit,
    workflow_create_allowed,
)
from proliferate.server.cloud.workflows.domain.run_status import (
    RunTransitionError,
    check_transition,
    is_terminal,
)
from proliferate.server.cloud.workflows.models import (
    RunStatusRequest,
    TriggerScheduleRequest,
    WorkflowCreateRequest,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerUpdateRequest,
    WorkflowUpdateRequest,
)
from proliferate.utils.time import utcnow

_TRIGGER_LOCAL_UNSUPPORTED_MESSAGE = (
    "Scheduled local runs are coming; run this workflow manually, or schedule it "
    "on a cloud workspace."
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


async def ensure_cloud_workspace_owned(
    db: AsyncSession, *, user: ActorIdentity, target_workspace_id: UUID | None
) -> None:
    """Validate the actor owns a live cloud workspace (ownership only).

    Used at trigger create/update: the workspace must exist and be un-archived,
    but need not be materialized yet — materialization is re-checked at fire time
    by ``start_run`` (a workspace can finish provisioning after the trigger is set).
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


def _resolve_plan(
    *,
    run_id: UUID,
    workflow_id: UUID,
    version: WorkflowVersionRecord,
    trigger_kind: str,
    target_mode: str,
    coerced_args: dict[str, object],
) -> dict[str, object]:
    canonical = version.definition_json
    interpolated_steps = interpolate_args(canonical.get("steps", []), coerced_args)
    return {
        "run_id": str(run_id),
        "workflow_id": str(workflow_id),
        "workflow_version_id": str(version.id),
        "version_n": version.version_n,
        "trigger_kind": trigger_kind,
        "target_mode": target_mode,
        "setup": canonical.get("setup", {}),
        "args": coerced_args,
        "steps": interpolated_steps,
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
    args: dict[str, object],
    target_mode: str,
    trigger_kind: str = WORKFLOW_TRIGGER_MANUAL,
    version_id: UUID | None = None,
    target_workspace_id: UUID | None = None,
    trigger_id: UUID | None = None,
    scheduled_for: datetime | None = None,
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
        coerced_args = coerce_arguments(arg_specs, args)
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc

    run_id = uuid4()
    resolved_plan = _resolve_plan(
        run_id=run_id,
        workflow_id=workflow_id,
        version=version,
        trigger_kind=trigger_kind,
        target_mode=target_mode,
        coerced_args=coerced_args,
    )
    return await store.create_run(
        db,
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version_id=version.id,
        trigger_kind=trigger_kind,
        executor_user_id=workflow.owner_user_id,
        args_json=coerced_args,
        target_mode=target_mode,
        resolved_plan_json=resolved_plan,
        anyharness_workspace_id=cloud_anyharness_workspace_id,
        trigger_id=trigger_id,
        scheduled_for=scheduled_for,
    )


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


def _validate_trigger_target_mode(mode: str) -> None:
    if mode == WORKFLOW_TARGET_MODE_LOCAL:
        # Locked v1 decision — reject cleanly rather than record a run nobody delivers.
        raise CloudApiError(
            "schedule_local_unsupported", _TRIGGER_LOCAL_UNSUPPORTED_MESSAGE, status_code=400
        )
    if mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        raise CloudApiError(
            "invalid_target_mode",
            "target_mode must be 'personal_cloud' for scheduled triggers.",
            status_code=400,
        )


def _normalize_trigger_schedule(schedule: TriggerScheduleRequest) -> ParsedAutomationSchedule:
    try:
        return normalize_schedule(
            rrule_text=schedule.rrule, timezone=schedule.timezone, now=utcnow()
        )
    except AutomationScheduleError as exc:
        raise CloudApiError("invalid_schedule", str(exc), status_code=400) from exc


async def _coerce_trigger_args(
    db: AsyncSession, *, workflow_current_version_id: UUID | None, args: dict[str, object]
) -> dict[str, object]:
    if workflow_current_version_id is None:
        raise CloudApiError(
            "workflow_no_version",
            "Add at least one step before scheduling this workflow.",
            status_code=409,
        )
    version = await store.get_version(db, workflow_current_version_id)
    if version is None:
        raise CloudApiError(
            "workflow_version_not_found", "Workflow version not found.", status_code=404
        )
    try:
        return coerce_arguments(workflow_arg_specs(version), args)
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


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
    _validate_trigger_target_mode(body.target_mode)
    await ensure_cloud_workspace_owned(db, user=user, target_workspace_id=body.target_workspace_id)
    parsed = _normalize_trigger_schedule(body.schedule)
    coerced_args = await _coerce_trigger_args(
        db, workflow_current_version_id=workflow.current_version_id, args=body.args
    )
    return await trigger_store.create_trigger(
        db,
        workflow_id=workflow_id,
        created_by_user_id=user.id,
        kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
        concurrency_policy=body.concurrency_policy,
        target_mode=body.target_mode,
        target_workspace_id=body.target_workspace_id,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=parsed.next_run_at,
        args_json=coerced_args,
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
    enabled = body.enabled if body.enabled is not None else existing.enabled
    _validate_concurrency(concurrency)
    _validate_trigger_target_mode(target_mode)

    # Cloud target needs an owned workspace (new one if supplied, else the pinned one).
    target_workspace_id = (
        body.target_workspace_id
        if body.target_workspace_id is not None
        else existing.target_workspace_id
    )
    await ensure_cloud_workspace_owned(db, user=user, target_workspace_id=target_workspace_id)

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

    args = body.args if body.args is not None else existing.args_json
    coerced_args = await _coerce_trigger_args(
        db, workflow_current_version_id=workflow.current_version_id, args=args
    )

    updated = await trigger_store.update_trigger(
        db,
        trigger_id=trigger_id,
        enabled=enabled,
        concurrency_policy=concurrency,
        target_mode=target_mode,
        target_workspace_id=target_workspace_id,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=next_run_at,
        args_json=coerced_args,
    )
    assert updated is not None
    return updated


async def delete_trigger(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> None:
    await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)
    await trigger_store.delete_trigger(db, trigger_id)
