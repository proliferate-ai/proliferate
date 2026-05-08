"""Pure validation and normalization rules for automation API requests."""

from __future__ import annotations

from datetime import datetime

from proliferate.constants.automations import (
    AUTOMATION_OPTIONAL_TEXT_MAX_LENGTH,
    AUTOMATION_REPO_PART_MAX_LENGTH,
    AUTOMATION_RUN_LIST_MAX_LIMIT,
    AUTOMATION_TITLE_MAX_LENGTH,
    SUPPORTED_AUTOMATION_EXECUTION_TARGETS,
    SUPPORTED_AUTOMATION_REASONING_EFFORTS,
)
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.server.automations.domain.schedule import (
    AutomationScheduleError,
    ParsedAutomationSchedule,
    normalize_schedule,
)
from proliferate.server.automations.errors import (
    AutomationAgentRequired,
    AutomationInvalidAgentKind,
    AutomationInvalidExecutionTarget,
    AutomationInvalidField,
    AutomationInvalidReasoningEffort,
    AutomationInvalidSchedule,
)


def normalize_required_text(
    value: str,
    *,
    field_name: str,
    max_length: int | None = None,
) -> str:
    normalized = value.strip()
    if not normalized:
        raise AutomationInvalidField(f"{field_name} is required.")
    if max_length is not None and len(normalized) > max_length:
        raise AutomationInvalidField(f"{field_name} must be at most {max_length} characters.")
    return normalized


def normalize_title(value: str) -> str:
    return normalize_required_text(
        value,
        field_name="title",
        max_length=AUTOMATION_TITLE_MAX_LENGTH,
    )


def normalize_repo_part(value: str, *, field_name: str) -> str:
    return normalize_required_text(
        value,
        field_name=field_name,
        max_length=AUTOMATION_REPO_PART_MAX_LENGTH,
    )


def normalize_optional_text(value: str | None, *, field_name: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > AUTOMATION_OPTIONAL_TEXT_MAX_LENGTH:
        raise AutomationInvalidField(
            f"{field_name} must be at most {AUTOMATION_OPTIONAL_TEXT_MAX_LENGTH} characters."
        )
    return normalized


def normalize_execution_target(value: str) -> str:
    if value not in SUPPORTED_AUTOMATION_EXECUTION_TARGETS:
        raise AutomationInvalidExecutionTarget()
    return value


def normalize_agent_kind(value: str | None) -> str | None:
    normalized = normalize_optional_text(value, field_name="agentKind")
    if normalized is None:
        return None
    if normalized not in SUPPORTED_CLOUD_AGENTS:
        raise AutomationInvalidAgentKind()
    return normalized


def normalize_reasoning_effort(value: str | None) -> str | None:
    normalized = normalize_optional_text(value, field_name="reasoningEffort")
    if normalized is None:
        return None
    if normalized not in SUPPORTED_AUTOMATION_REASONING_EFFORTS:
        raise AutomationInvalidReasoningEffort()
    return normalized


def require_agent_kind(execution_target: str, agent_kind: str | None) -> None:
    if execution_target in SUPPORTED_AUTOMATION_EXECUTION_TARGETS and agent_kind is None:
        raise AutomationAgentRequired()


def normalize_automation_schedule(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> ParsedAutomationSchedule:
    try:
        return normalize_schedule(rrule_text=rrule_text, timezone=timezone, now=now)
    except AutomationScheduleError as exc:
        raise AutomationInvalidSchedule(str(exc)) from exc


def bounded_run_list_limit(limit: int) -> int:
    return max(1, min(limit, AUTOMATION_RUN_LIST_MAX_LIMIT))
