"""Automation service layer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db.store.automations import (
    AutomationRunValue,
    AutomationValue,
    create_automation_for_user,
    create_manual_run_for_user,
    list_automations_for_user,
    list_runs_for_automation_for_user,
    load_automation_for_user,
    update_automation_for_user,
)
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigLimitExceededError,
    bootstrap_cloud_repo_config,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.automations.domain.schedule import (
    next_future_occurrence,
)
from proliferate.server.automations.domain.validation import (
    bounded_run_list_limit,
    normalize_agent_kind,
    normalize_automation_schedule,
    normalize_execution_target,
    normalize_optional_text,
    normalize_reasoning_effort,
    normalize_repo_part,
    normalize_required_text,
    normalize_title,
    require_agent_kind,
)
from proliferate.server.automations.errors import (
    AutomationInvalidField,
    AutomationNotFound,
    AutomationPaused,
    AutomationRepoImmutable,
    AutomationRepoLimitExceeded,
    AutomationServiceError,
)
from proliferate.server.automations.models import (
    CreateAutomationRequest,
    UpdateAutomationRequest,
)
from proliferate.server.billing.service import (
    get_billing_snapshot_for_request,
    repo_limit_for_billing_snapshot,
)
from proliferate.utils.time import utcnow

AUTOMATION_TARGET_KINDS: frozenset[str] = frozenset(
    {
        CloudTargetKind.managed_cloud.value,
        CloudTargetKind.ssh.value,
    }
)


def _target_invalid(
    message: str,
    *,
    code: str = "target_invalid",
    status_code: int = 400,
) -> AutomationServiceError:
    return AutomationServiceError(code, message, status_code=status_code)


async def _default_managed_cloud_target(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> targets_store.CloudTargetSnapshot | None:
    targets = await targets_store.list_visible_targets(db, user_id=user_id)
    candidates = [
        target
        for target in targets
        if target.kind == CloudTargetKind.managed_cloud.value
        and target.status == CloudTargetStatus.online.value
        and target.archived_at is None
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda target: (target.created_at, target.id))[0]


def _validate_automation_target(
    target: targets_store.CloudTargetSnapshot,
) -> tuple[UUID, str]:
    if target.archived_at is not None or target.status == CloudTargetStatus.archived.value:
        raise _target_invalid("Target is archived.", code="target_archived")
    if target.kind not in AUTOMATION_TARGET_KINDS:
        raise _target_invalid("Target cannot run automations.", code="target_kind_unsupported")
    if target.status != CloudTargetStatus.online.value:
        raise _target_invalid("Target is not online.", code="target_offline")
    return target.id, target.kind


async def _resolve_target_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    execution_target: str,
    target_id: UUID | None,
) -> tuple[UUID | None, str | None]:
    if execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL:
        if target_id is not None:
            raise _target_invalid("targetId must be omitted for local automations.")
        return None, None
    if execution_target != AUTOMATION_EXECUTION_TARGET_CLOUD:
        return None, None
    if target_id is None:
        default_target = await _default_managed_cloud_target(db, user_id=user_id)
        if default_target is None:
            raise _target_invalid(
                "Choose a cloud compute target before scheduling this automation.",
                code="target_required",
            )
        return _validate_automation_target(default_target)
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None:
        raise _target_invalid("Target not found.", code="target_not_found", status_code=404)
    return _validate_automation_target(target)


async def _ensure_repo_config_id(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> UUID:
    # Automations point at a repo identity. Runtime-input config for that repo can still
    # be empty; the executor PR will decide when to apply env/files/setup.
    billing_snapshot = await get_billing_snapshot_for_request(db, user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        repo_config = await bootstrap_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            cloud_repo_limit=cloud_repo_limit,
        )
    except CloudRepoConfigLimitExceededError as error:
        raise AutomationRepoLimitExceeded(
            active_repo_count=error.active_repo_count,
            cloud_repo_limit=error.cloud_repo_limit,
        ) from error
    return repo_config.id


async def list_automations(db: AsyncSession, user_id: UUID) -> list[AutomationValue]:
    return await list_automations_for_user(db, user_id)


async def get_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    value = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationNotFound()
    return value


async def create_automation(
    db: AsyncSession,
    user_id: UUID,
    body: CreateAutomationRequest,
) -> AutomationValue:
    now = utcnow()
    git_owner = normalize_repo_part(body.git_owner, field_name="gitOwner")
    git_repo_name = normalize_repo_part(body.git_repo_name, field_name="gitRepoName")
    repo_config_id = await _ensure_repo_config_id(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    schedule = normalize_automation_schedule(
        rrule_text=body.schedule.rrule,
        timezone=body.schedule.timezone,
        now=now,
    )
    execution_target = normalize_execution_target(body.execution_target)
    target_id, target_kind = await _resolve_target_selection(
        db,
        user_id=user_id,
        execution_target=execution_target,
        target_id=body.target_id,
    )
    agent_kind = normalize_agent_kind(body.agent_kind)
    require_agent_kind(execution_target, agent_kind)
    value = await create_automation_for_user(
        db,
        user_id=user_id,
        cloud_repo_config_id=repo_config_id,
        title=normalize_title(body.title),
        prompt=normalize_required_text(body.prompt, field_name="prompt"),
        schedule_rrule=schedule.rrule_text,
        schedule_timezone=schedule.timezone,
        schedule_summary=schedule.summary,
        execution_target=execution_target,
        cloud_target_id=target_id,
        cloud_target_kind=target_kind,
        agent_kind=agent_kind,
        model_id=normalize_optional_text(body.model_id, field_name="modelId"),
        mode_id=normalize_optional_text(body.mode_id, field_name="modeId"),
        reasoning_effort=normalize_reasoning_effort(body.reasoning_effort),
        next_run_at=schedule.next_run_at,
    )
    return value


async def update_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    body: UpdateAutomationRequest,
) -> AutomationValue:
    existing = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationNotFound()
    if "git_owner" in body.model_fields_set or "git_repo_name" in body.model_fields_set:
        raise AutomationRepoImmutable()

    updates: dict[str, object] = {}
    if "title" in body.model_fields_set:
        if body.title is None:
            raise AutomationInvalidField("title cannot be null.")
        updates["title"] = normalize_title(body.title)
    if "prompt" in body.model_fields_set:
        if body.prompt is None:
            raise AutomationInvalidField("prompt cannot be null.")
        updates["prompt"] = normalize_required_text(body.prompt, field_name="prompt")
    resolved_execution_target = existing.execution_target
    resolved_agent_kind = existing.agent_kind
    resolved_target_id = existing.cloud_target_id
    resolved_target_kind = existing.cloud_target_kind
    if "execution_target" in body.model_fields_set:
        if body.execution_target is None:
            raise AutomationInvalidField("executionTarget cannot be null.")
        resolved_execution_target = normalize_execution_target(body.execution_target)
        updates["execution_target"] = resolved_execution_target
        if resolved_execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL:
            resolved_target_id = None
            resolved_target_kind = None
    if "agent_kind" in body.model_fields_set:
        resolved_agent_kind = normalize_agent_kind(body.agent_kind)
        updates["agent_kind"] = resolved_agent_kind
    if "target_id" in body.model_fields_set:
        resolved_target_id, resolved_target_kind = await _resolve_target_selection(
            db,
            user_id=user_id,
            execution_target=resolved_execution_target,
            target_id=body.target_id,
        )
    elif "execution_target" in body.model_fields_set:
        resolved_target_id, resolved_target_kind = await _resolve_target_selection(
            db,
            user_id=user_id,
            execution_target=resolved_execution_target,
            target_id=resolved_target_id,
        )
    if "target_id" in body.model_fields_set or "execution_target" in body.model_fields_set:
        updates["cloud_target_id"] = resolved_target_id
        updates["cloud_target_kind"] = resolved_target_kind
    if "model_id" in body.model_fields_set:
        updates["model_id"] = normalize_optional_text(body.model_id, field_name="modelId")
    if "mode_id" in body.model_fields_set:
        updates["mode_id"] = normalize_optional_text(body.mode_id, field_name="modeId")
    if "reasoning_effort" in body.model_fields_set:
        updates["reasoning_effort"] = normalize_reasoning_effort(body.reasoning_effort)
    if "schedule" in body.model_fields_set:
        if body.schedule is None:
            raise AutomationInvalidField("schedule cannot be null.")
        schedule = normalize_automation_schedule(
            rrule_text=body.schedule.rrule,
            timezone=body.schedule.timezone,
            now=utcnow(),
        )
        updates["schedule_rrule"] = schedule.rrule_text
        updates["schedule_timezone"] = schedule.timezone
        updates["schedule_summary"] = schedule.summary
        # Queued runs keep the schedule slot they were already committed to.
        # Executor-state PRs can add explicit cancellation/rescheduling semantics.
        updates["next_run_at"] = schedule.next_run_at if existing.enabled else None

    require_agent_kind(resolved_execution_target, resolved_agent_kind)

    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        **updates,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def pause_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        enabled=False,
        paused_at=utcnow(),
        next_run_at=None,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def resume_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    existing = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationNotFound()
    require_agent_kind(existing.execution_target, existing.agent_kind)
    next_run_at = next_future_occurrence(
        rrule_text=existing.schedule_rrule,
        timezone=existing.schedule_timezone,
        now=utcnow(),
    )
    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        enabled=True,
        paused_at=None,
        next_run_at=next_run_at,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def run_automation_now(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationRunValue:
    existing = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationNotFound()
    if not existing.enabled:
        raise AutomationPaused()
    require_agent_kind(existing.execution_target, existing.agent_kind)
    if (
        existing.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD
        and existing.cloud_target_id is None
    ):
        target_id, target_kind = await _resolve_target_selection(
            db,
            user_id=user_id,
            execution_target=existing.execution_target,
            target_id=None,
        )
        existing = await update_automation_for_user(
            db,
            user_id=user_id,
            automation_id=automation_id,
            cloud_target_id=target_id,
            cloud_target_kind=target_kind,
        )
        if existing is None:
            raise AutomationNotFound()
    await _ensure_repo_config_id(
        db,
        user_id=user_id,
        git_owner=existing.git_owner,
        git_repo_name=existing.git_repo_name,
    )
    value = await create_manual_run_for_user(db, user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationNotFound()
    return value


async def list_automation_runs(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    *,
    limit: int = AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
) -> list[AutomationRunValue]:
    bounded_limit = bounded_run_list_limit(limit)
    values = await list_runs_for_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        limit=bounded_limit,
    )
    if values is None:
        raise AutomationNotFound()
    return values
