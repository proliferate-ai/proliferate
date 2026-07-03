"""Cloud workflows service layer.

Owns workflow/version CRUD, the free-plan cap, and ``StartRun`` — the single
resolution point (spec 3.2): load the pinned immutable version, coerce args,
eagerly interpolate ``{{args.*}}`` into a self-contained resolved plan, and record
a ``pending_delivery`` run whose id is the delivery idempotency key.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_TARGET_MODES,
    SUPPORTED_WORKFLOW_TRIGGER_KINDS,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_SHORT_TEXT_MAX_LENGTH,
    WORKFLOW_TRIGGER_MANUAL,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import (
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
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
    WorkflowCreateRequest,
    WorkflowUpdateRequest,
)
from proliferate.utils.time import utcnow


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
    try:
        canonical, _specs = parse_definition(raw)
    except WorkflowDefinitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    return canonical


async def _visible_workflow(
    db: AsyncSession, *, user: ActorIdentity, workflow_id: UUID
) -> WorkflowRecord:
    workflow = await store.get_workflow(db, workflow_id)
    if workflow is None or workflow.owner_user_id != user.id:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    return workflow


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


async def start_run(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    *,
    args: dict[str, object],
    target_mode: str,
    trigger_kind: str = WORKFLOW_TRIGGER_MANUAL,
    version_id: UUID | None = None,
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
