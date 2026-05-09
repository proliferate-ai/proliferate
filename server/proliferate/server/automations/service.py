"""Automation service layer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
)
from proliferate.db.store.automations import (
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
    bootstrap_cloud_repo_config_for_user,
)
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
)
from proliferate.server.automations.models import (
    AutomationListResponse,
    AutomationResponse,
    AutomationRunListResponse,
    AutomationRunResponse,
    CreateAutomationRequest,
    UpdateAutomationRequest,
    automation_payload,
    automation_run_payload,
)
from proliferate.server.billing.service import (
    get_billing_snapshot,
    repo_limit_for_billing_snapshot,
)
from proliferate.utils.time import utcnow


async def _ensure_repo_config_id(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> UUID:
    # Automations point at a repo identity. Runtime-input config for that repo can still
    # be empty; the executor PR will decide when to apply env/files/setup.
    billing_snapshot = await get_billing_snapshot(user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        repo_config = await bootstrap_cloud_repo_config_for_user(
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


async def list_automations(db: AsyncSession, user_id: UUID) -> AutomationListResponse:
    values = await list_automations_for_user(db, user_id)
    return AutomationListResponse(automations=[automation_payload(value) for value in values])


async def get_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationResponse:
    value = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationNotFound()
    return automation_payload(value)


async def create_automation(
    db: AsyncSession,
    user_id: UUID,
    body: CreateAutomationRequest,
) -> AutomationResponse:
    now = utcnow()
    git_owner = normalize_repo_part(body.git_owner, field_name="gitOwner")
    git_repo_name = normalize_repo_part(body.git_repo_name, field_name="gitRepoName")
    repo_config_id = await _ensure_repo_config_id(
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
        agent_kind=agent_kind,
        model_id=normalize_optional_text(body.model_id, field_name="modelId"),
        mode_id=normalize_optional_text(body.mode_id, field_name="modeId"),
        reasoning_effort=normalize_reasoning_effort(body.reasoning_effort),
        next_run_at=schedule.next_run_at,
    )
    return automation_payload(value)


async def update_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    body: UpdateAutomationRequest,
) -> AutomationResponse:
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
    if "execution_target" in body.model_fields_set:
        if body.execution_target is None:
            raise AutomationInvalidField("executionTarget cannot be null.")
        resolved_execution_target = normalize_execution_target(body.execution_target)
        updates["execution_target"] = resolved_execution_target
    if "agent_kind" in body.model_fields_set:
        resolved_agent_kind = normalize_agent_kind(body.agent_kind)
        updates["agent_kind"] = resolved_agent_kind
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
    return automation_payload(value)


async def pause_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationResponse:
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
    return automation_payload(value)


async def resume_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationResponse:
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
    return automation_payload(value)


async def run_automation_now(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationRunResponse:
    existing = await load_automation_for_user(db, user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationNotFound()
    if not existing.enabled:
        raise AutomationPaused()
    require_agent_kind(existing.execution_target, existing.agent_kind)
    await _ensure_repo_config_id(
        user_id=user_id,
        git_owner=existing.git_owner,
        git_repo_name=existing.git_repo_name,
    )
    value = await create_manual_run_for_user(db, user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationNotFound()
    return automation_run_payload(value)


async def list_automation_runs(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    *,
    limit: int = AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
) -> AutomationRunListResponse:
    bounded_limit = bounded_run_list_limit(limit)
    values = await list_runs_for_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        limit=bounded_limit,
    )
    if values is None:
        raise AutomationNotFound()
    return AutomationRunListResponse(runs=[automation_run_payload(value) for value in values])


def automation_for_tests(value: AutomationValue) -> AutomationResponse:
    return automation_payload(value)
