"""Automation service layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.db.store.automation_run_claims import (
    sweep_expired_dispatching_runs,
)
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AutomationScheduleAdvance,
    AutomationScheduleFields,
    AutomationValue,
    create_automation_for_user,
    create_due_scheduled_runs_batch,
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
from proliferate.server.automations.schedule import (
    AutomationScheduleError,
    due_and_next_occurrences,
    next_future_occurrence,
    normalize_schedule,
)
from proliferate.server.billing.service import (
    get_billing_snapshot,
    repo_limit_for_billing_snapshot,
)
from proliferate.utils.time import utcnow

MAX_RUN_LIST_LIMIT = 100
DEFAULT_RUN_LIST_LIMIT = 50
_REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}


class AutomationServiceError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class SchedulerTickResult:
    created_runs: int
    swept_dispatching_runs: int = 0


def _normalize_required_text(value: str, *, field_name: str, max_length: int | None = None) -> str:
    normalized = value.strip()
    if not normalized:
        raise AutomationServiceError(
            "automation_invalid_field",
            f"{field_name} is required.",
            status_code=400,
        )
    if max_length is not None and len(normalized) > max_length:
        raise AutomationServiceError(
            "automation_invalid_field",
            f"{field_name} must be at most {max_length} characters.",
            status_code=400,
        )
    return normalized


def _normalize_repo_part(value: str, *, field_name: str) -> str:
    return _normalize_required_text(value, field_name=field_name, max_length=255)


def _normalize_optional_text(value: str | None, *, field_name: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 255:
        raise AutomationServiceError(
            "automation_invalid_field",
            f"{field_name} must be at most 255 characters.",
            status_code=400,
        )
    return normalized


def _normalize_execution_target(value: str) -> str:
    if value not in {AUTOMATION_EXECUTION_TARGET_CLOUD, AUTOMATION_EXECUTION_TARGET_LOCAL}:
        raise AutomationServiceError(
            "automation_invalid_execution_target",
            "Execution target must be 'cloud' or 'local'.",
            status_code=400,
        )
    return value


def _normalize_agent_kind(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value, field_name="agentKind")
    if normalized is None:
        return None
    if normalized not in SUPPORTED_CLOUD_AGENTS:
        raise AutomationServiceError(
            "automation_invalid_agent_kind",
            "Agent kind must be one of: claude, codex, gemini.",
            status_code=400,
        )
    return normalized


def _normalize_reasoning_effort(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value, field_name="reasoningEffort")
    if normalized is None:
        return None
    if normalized not in _REASONING_EFFORTS:
        raise AutomationServiceError(
            "automation_invalid_reasoning_effort",
            "Reasoning effort is not supported.",
            status_code=400,
        )
    return normalized


def _require_agent_kind(execution_target: str, agent_kind: str | None) -> None:
    if (
        execution_target in {AUTOMATION_EXECUTION_TARGET_CLOUD, AUTOMATION_EXECUTION_TARGET_LOCAL}
        and agent_kind is None
    ):
        raise AutomationServiceError(
            "automation_agent_required",
            "Choose an agent before scheduling this automation.",
            status_code=400,
        )


def _normalize_schedule_or_raise(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> tuple[str, str, str, datetime]:
    try:
        parsed = normalize_schedule(rrule_text=rrule_text, timezone=timezone, now=now)
    except AutomationScheduleError as exc:
        raise AutomationServiceError(
            "automation_invalid_schedule",
            str(exc),
            status_code=400,
        ) from exc
    return parsed.rrule_text, parsed.timezone, parsed.summary, parsed.next_run_at


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
        raise AutomationServiceError(
            "repo_limit_exceeded",
            (
                f"Cloud repo limit reached. Upgrade or disable another cloud repo "
                f"before scheduling this one ({error.active_repo_count}/"
                f"{error.cloud_repo_limit})."
            ),
            status_code=409,
        ) from error
    return repo_config.id


async def list_automations(user_id: UUID) -> AutomationListResponse:
    values = await list_automations_for_user(user_id)
    return AutomationListResponse(automations=[automation_payload(value) for value in values])


async def get_automation(user_id: UUID, automation_id: UUID) -> AutomationResponse:
    value = await load_automation_for_user(user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return automation_payload(value)


async def create_automation(user_id: UUID, body: CreateAutomationRequest) -> AutomationResponse:
    now = utcnow()
    git_owner = _normalize_repo_part(body.git_owner, field_name="gitOwner")
    git_repo_name = _normalize_repo_part(body.git_repo_name, field_name="gitRepoName")
    repo_config_id = await _ensure_repo_config_id(
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    schedule_rrule, schedule_timezone, schedule_summary, next_run_at = (
        _normalize_schedule_or_raise(
            rrule_text=body.schedule.rrule,
            timezone=body.schedule.timezone,
            now=now,
        )
    )
    execution_target = _normalize_execution_target(body.execution_target)
    agent_kind = _normalize_agent_kind(body.agent_kind)
    _require_agent_kind(execution_target, agent_kind)
    value = await create_automation_for_user(
        user_id=user_id,
        cloud_repo_config_id=repo_config_id,
        title=_normalize_required_text(body.title, field_name="title", max_length=255),
        prompt=_normalize_required_text(body.prompt, field_name="prompt"),
        schedule_rrule=schedule_rrule,
        schedule_timezone=schedule_timezone,
        schedule_summary=schedule_summary,
        execution_target=execution_target,
        agent_kind=agent_kind,
        model_id=_normalize_optional_text(body.model_id, field_name="modelId"),
        mode_id=_normalize_optional_text(body.mode_id, field_name="modeId"),
        reasoning_effort=_normalize_reasoning_effort(body.reasoning_effort),
        next_run_at=next_run_at,
    )
    return automation_payload(value)


async def update_automation(
    user_id: UUID,
    automation_id: UUID,
    body: UpdateAutomationRequest,
) -> AutomationResponse:
    existing = await load_automation_for_user(user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    if "git_owner" in body.model_fields_set or "git_repo_name" in body.model_fields_set:
        raise AutomationServiceError(
            "automation_repo_immutable",
            "Automation repository cannot be changed after creation.",
            status_code=400,
        )

    updates: dict[str, object] = {}
    if "title" in body.model_fields_set:
        if body.title is None:
            raise AutomationServiceError(
                "automation_invalid_field",
                "title cannot be null.",
                status_code=400,
            )
        updates["title"] = _normalize_required_text(
            body.title,
            field_name="title",
            max_length=255,
        )
    if "prompt" in body.model_fields_set:
        if body.prompt is None:
            raise AutomationServiceError(
                "automation_invalid_field",
                "prompt cannot be null.",
                status_code=400,
            )
        updates["prompt"] = _normalize_required_text(body.prompt, field_name="prompt")
    resolved_execution_target = existing.execution_target
    resolved_agent_kind = existing.agent_kind
    if "execution_target" in body.model_fields_set:
        if body.execution_target is None:
            raise AutomationServiceError(
                "automation_invalid_field",
                "executionTarget cannot be null.",
                status_code=400,
            )
        resolved_execution_target = _normalize_execution_target(body.execution_target)
        updates["execution_target"] = resolved_execution_target
    if "agent_kind" in body.model_fields_set:
        resolved_agent_kind = _normalize_agent_kind(body.agent_kind)
        updates["agent_kind"] = resolved_agent_kind
    if "model_id" in body.model_fields_set:
        updates["model_id"] = _normalize_optional_text(body.model_id, field_name="modelId")
    if "mode_id" in body.model_fields_set:
        updates["mode_id"] = _normalize_optional_text(body.mode_id, field_name="modeId")
    if "reasoning_effort" in body.model_fields_set:
        updates["reasoning_effort"] = _normalize_reasoning_effort(body.reasoning_effort)
    if "schedule" in body.model_fields_set:
        if body.schedule is None:
            raise AutomationServiceError(
                "automation_invalid_field",
                "schedule cannot be null.",
                status_code=400,
            )
        schedule_rrule, schedule_timezone, schedule_summary, next_run_at = (
            _normalize_schedule_or_raise(
                rrule_text=body.schedule.rrule,
                timezone=body.schedule.timezone,
                now=utcnow(),
            )
        )
        updates["schedule_rrule"] = schedule_rrule
        updates["schedule_timezone"] = schedule_timezone
        updates["schedule_summary"] = schedule_summary
        # Queued runs keep the schedule slot they were already committed to.
        # Executor-state PRs can add explicit cancellation/rescheduling semantics.
        updates["next_run_at"] = next_run_at if existing.enabled else None

    _require_agent_kind(resolved_execution_target, resolved_agent_kind)

    value = await update_automation_for_user(
        user_id=user_id,
        automation_id=automation_id,
        **updates,
    )
    if value is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return automation_payload(value)


async def pause_automation(user_id: UUID, automation_id: UUID) -> AutomationResponse:
    value = await update_automation_for_user(
        user_id=user_id,
        automation_id=automation_id,
        enabled=False,
        paused_at=utcnow(),
        next_run_at=None,
    )
    if value is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return automation_payload(value)


async def resume_automation(user_id: UUID, automation_id: UUID) -> AutomationResponse:
    existing = await load_automation_for_user(user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    _require_agent_kind(existing.execution_target, existing.agent_kind)
    next_run_at = next_future_occurrence(
        rrule_text=existing.schedule_rrule,
        timezone=existing.schedule_timezone,
        now=utcnow(),
    )
    value = await update_automation_for_user(
        user_id=user_id,
        automation_id=automation_id,
        enabled=True,
        paused_at=None,
        next_run_at=next_run_at,
    )
    if value is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return automation_payload(value)


async def run_automation_now(user_id: UUID, automation_id: UUID) -> AutomationRunResponse:
    existing = await load_automation_for_user(user_id=user_id, automation_id=automation_id)
    if existing is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    if not existing.enabled:
        raise AutomationServiceError(
            "automation_paused",
            "Resume this automation before queueing a manual run.",
            status_code=400,
        )
    _require_agent_kind(existing.execution_target, existing.agent_kind)
    await _ensure_repo_config_id(
        user_id=user_id,
        git_owner=existing.git_owner,
        git_repo_name=existing.git_repo_name,
    )
    value = await create_manual_run_for_user(user_id=user_id, automation_id=automation_id)
    if value is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return automation_run_payload(value)


async def list_automation_runs(
    user_id: UUID,
    automation_id: UUID,
    *,
    limit: int = DEFAULT_RUN_LIST_LIMIT,
) -> AutomationRunListResponse:
    bounded_limit = max(1, min(limit, MAX_RUN_LIST_LIMIT))
    values = await list_runs_for_automation_for_user(
        user_id=user_id,
        automation_id=automation_id,
        limit=bounded_limit,
    )
    if values is None:
        raise AutomationServiceError(
            "automation_not_found",
            "Automation not found.",
            status_code=404,
        )
    return AutomationRunListResponse(runs=[automation_run_payload(value) for value in values])


def _resolve_due_schedule(
    fields: AutomationScheduleFields,
    now: datetime,
) -> AutomationScheduleAdvance:
    """Create the latest due slot at or before now, then advance to the first future slot."""
    scheduled_for, next_run_at = due_and_next_occurrences(
        rrule_text=fields.schedule_rrule,
        timezone=fields.schedule_timezone,
        now=now,
    )
    return AutomationScheduleAdvance(scheduled_for=scheduled_for, next_run_at=next_run_at)


async def run_scheduler_tick(*, batch_size: int = 100) -> SchedulerTickResult:
    swept_dispatching_runs = await sweep_expired_dispatching_runs(now=utcnow())
    created_runs = await create_due_scheduled_runs_batch(
        now=utcnow(),
        limit=max(1, batch_size),
        schedule_advance_resolver=_resolve_due_schedule,
    )
    return SchedulerTickResult(
        created_runs=created_runs,
        swept_dispatching_runs=swept_dispatching_runs,
    )


def automation_for_tests(value: AutomationValue) -> AutomationResponse:
    return automation_payload(value)
