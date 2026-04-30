"""Persistence helpers for automations."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db import engine as db_engine
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud import CloudRepoConfig
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

AUTOMATION_EXECUTION_TARGET_CLOUD: Final = "cloud"
AUTOMATION_EXECUTION_TARGET_LOCAL: Final = "local"
AUTOMATION_RUN_TRIGGER_MANUAL: Final = "manual"
AUTOMATION_RUN_TRIGGER_SCHEDULED: Final = "scheduled"
AUTOMATION_RUN_STATUS_QUEUED: Final = "queued"
AUTOMATION_RUN_STATUS_CLAIMED: Final = "claimed"
AUTOMATION_RUN_STATUS_CREATING_WORKSPACE: Final = "creating_workspace"
AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE: Final = "provisioning_workspace"
AUTOMATION_RUN_STATUS_CREATING_SESSION: Final = "creating_session"
AUTOMATION_RUN_STATUS_DISPATCHING: Final = "dispatching"
AUTOMATION_RUN_STATUS_DISPATCHED: Final = "dispatched"
AUTOMATION_RUN_STATUS_FAILED: Final = "failed"
AUTOMATION_RUN_STATUS_CANCELLED: Final = "cancelled"
AUTOMATION_EXECUTOR_KIND_CLOUD: Final = "cloud"
AUTOMATION_EXECUTOR_KIND_DESKTOP: Final = "desktop"

_UNSET: Final = object()


@dataclass(frozen=True)
class AutomationValue:
    id: UUID
    user_id: UUID
    cloud_repo_config_id: UUID
    git_owner: str
    git_repo_name: str
    title: str
    prompt: str
    schedule_rrule: str
    schedule_timezone: str
    schedule_summary: str
    execution_target: str
    agent_kind: str | None
    model_id: str | None
    mode_id: str | None
    reasoning_effort: str | None
    enabled: bool
    paused_at: datetime | None
    next_run_at: datetime | None
    last_scheduled_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AutomationRunValue:
    id: UUID
    automation_id: UUID
    user_id: UUID
    trigger_kind: str
    scheduled_for: datetime | None
    execution_target: str
    status: str
    title_snapshot: str
    prompt_snapshot: str
    git_provider_snapshot: str
    git_owner_snapshot: str
    git_repo_name_snapshot: str
    cloud_repo_config_id_snapshot: UUID
    agent_kind_snapshot: str | None
    model_id_snapshot: str | None
    mode_id_snapshot: str | None
    reasoning_effort_snapshot: str | None
    executor_kind: str | None
    claimed_at: datetime | None
    claim_expires_at: datetime | None
    last_heartbeat_at: datetime | None
    dispatch_started_at: datetime | None
    dispatched_at: datetime | None
    failed_at: datetime | None
    cloud_workspace_id: UUID | None
    anyharness_workspace_id: str | None
    anyharness_session_id: str | None
    cancelled_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AutomationScheduleFields:
    schedule_rrule: str
    schedule_timezone: str
    next_run_at: datetime | None


@dataclass(frozen=True)
class AutomationScheduleAdvance:
    scheduled_for: datetime | None
    next_run_at: datetime | None


ScheduleAdvanceResolver = Callable[
    [AutomationScheduleFields, datetime],
    AutomationScheduleAdvance,
]


def _automation_value(record: Automation, repo_config: CloudRepoConfig) -> AutomationValue:
    return AutomationValue(
        id=record.id,
        user_id=record.user_id,
        cloud_repo_config_id=record.cloud_repo_config_id,
        git_owner=repo_config.git_owner,
        git_repo_name=repo_config.git_repo_name,
        title=record.title,
        prompt=record.prompt,
        schedule_rrule=record.schedule_rrule,
        schedule_timezone=record.schedule_timezone,
        schedule_summary=record.schedule_summary,
        execution_target=record.execution_target,
        agent_kind=record.agent_kind,
        model_id=record.model_id,
        mode_id=record.mode_id,
        reasoning_effort=record.reasoning_effort,
        enabled=record.enabled,
        paused_at=record.paused_at,
        next_run_at=record.next_run_at,
        last_scheduled_at=record.last_scheduled_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _run_value(record: AutomationRun) -> AutomationRunValue:
    return AutomationRunValue(
        id=record.id,
        automation_id=record.automation_id,
        user_id=record.user_id,
        trigger_kind=record.trigger_kind,
        scheduled_for=record.scheduled_for,
        execution_target=record.execution_target,
        status=record.status,
        title_snapshot=record.title_snapshot,
        prompt_snapshot=record.prompt_snapshot,
        git_provider_snapshot=record.git_provider_snapshot,
        git_owner_snapshot=record.git_owner_snapshot,
        git_repo_name_snapshot=record.git_repo_name_snapshot,
        cloud_repo_config_id_snapshot=record.cloud_repo_config_id_snapshot,
        agent_kind_snapshot=record.agent_kind_snapshot,
        model_id_snapshot=record.model_id_snapshot,
        mode_id_snapshot=record.mode_id_snapshot,
        reasoning_effort_snapshot=record.reasoning_effort_snapshot,
        executor_kind=record.executor_kind,
        claimed_at=record.claimed_at,
        claim_expires_at=record.claim_expires_at,
        last_heartbeat_at=record.last_heartbeat_at,
        dispatch_started_at=record.dispatch_started_at,
        dispatched_at=record.dispatched_at,
        failed_at=record.failed_at,
        cloud_workspace_id=record.cloud_workspace_id,
        anyharness_workspace_id=record.anyharness_workspace_id,
        anyharness_session_id=record.anyharness_session_id,
        cancelled_at=record.cancelled_at,
        last_error_code=record.last_error_code,
        last_error_message=record.last_error_message,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def _load_automation_value(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue | None:
    row = (
        await db.execute(
            select(Automation, CloudRepoConfig)
            .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
            .where(Automation.id == automation_id, Automation.user_id == user_id)
        )
    ).one_or_none()
    if row is None:
        return None
    record, repo_config = row
    return _automation_value(record, repo_config)


async def create_automation_for_user(
    *,
    user_id: UUID,
    cloud_repo_config_id: UUID,
    title: str,
    prompt: str,
    schedule_rrule: str,
    schedule_timezone: str,
    schedule_summary: str,
    execution_target: str,
    agent_kind: str | None,
    model_id: str | None,
    mode_id: str | None,
    reasoning_effort: str | None,
    next_run_at: datetime | None,
) -> AutomationValue:
    async with db_engine.async_session_factory() as db:
        now = utcnow()
        record = Automation(
            user_id=user_id,
            cloud_repo_config_id=cloud_repo_config_id,
            title=title,
            prompt=prompt,
            schedule_rrule=schedule_rrule,
            schedule_timezone=schedule_timezone,
            schedule_summary=schedule_summary,
            execution_target=execution_target,
            agent_kind=agent_kind,
            model_id=model_id,
            mode_id=mode_id,
            reasoning_effort=reasoning_effort,
            enabled=True,
            paused_at=None,
            next_run_at=next_run_at,
            last_scheduled_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        await db.commit()
        value = await _load_automation_value(db, user_id=user_id, automation_id=record.id)
        if value is None:
            raise RuntimeError("Created automation could not be loaded.")
        return value


async def list_automations_for_user(user_id: UUID) -> list[AutomationValue]:
    async with db_engine.async_session_factory() as db:
        rows = list(
            (
                await db.execute(
                    select(Automation, CloudRepoConfig)
                    .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                    .where(Automation.user_id == user_id)
                    .order_by(Automation.created_at.desc())
                )
            ).all()
        )
        return [_automation_value(record, repo_config) for record, repo_config in rows]


async def load_automation_for_user(
    *,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue | None:
    async with db_engine.async_session_factory() as db:
        return await _load_automation_value(db, user_id=user_id, automation_id=automation_id)


async def update_automation_for_user(
    *,
    user_id: UUID,
    automation_id: UUID,
    title: object = _UNSET,
    prompt: object = _UNSET,
    schedule_rrule: object = _UNSET,
    schedule_timezone: object = _UNSET,
    schedule_summary: object = _UNSET,
    execution_target: object = _UNSET,
    agent_kind: object = _UNSET,
    model_id: object = _UNSET,
    mode_id: object = _UNSET,
    reasoning_effort: object = _UNSET,
    enabled: object = _UNSET,
    paused_at: object = _UNSET,
    next_run_at: object = _UNSET,
) -> AutomationValue | None:
    async with db_engine.async_session_factory() as db:
        record = (
            await db.execute(
                select(Automation).where(
                    Automation.id == automation_id,
                    Automation.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if record is None:
            return None
        if title is not _UNSET:
            record.title = title  # type: ignore[assignment]
        if prompt is not _UNSET:
            record.prompt = prompt  # type: ignore[assignment]
        if schedule_rrule is not _UNSET:
            record.schedule_rrule = schedule_rrule  # type: ignore[assignment]
        if schedule_timezone is not _UNSET:
            record.schedule_timezone = schedule_timezone  # type: ignore[assignment]
        if schedule_summary is not _UNSET:
            record.schedule_summary = schedule_summary  # type: ignore[assignment]
        if execution_target is not _UNSET:
            record.execution_target = execution_target  # type: ignore[assignment]
        if agent_kind is not _UNSET:
            record.agent_kind = agent_kind  # type: ignore[assignment]
        if model_id is not _UNSET:
            record.model_id = model_id  # type: ignore[assignment]
        if mode_id is not _UNSET:
            record.mode_id = mode_id  # type: ignore[assignment]
        if reasoning_effort is not _UNSET:
            record.reasoning_effort = reasoning_effort  # type: ignore[assignment]
        if enabled is not _UNSET:
            record.enabled = enabled  # type: ignore[assignment]
        if paused_at is not _UNSET:
            record.paused_at = paused_at  # type: ignore[assignment]
        if next_run_at is not _UNSET:
            record.next_run_at = next_run_at  # type: ignore[assignment]
        record.updated_at = utcnow()
        await db.commit()
        return await _load_automation_value(db, user_id=user_id, automation_id=automation_id)


async def create_manual_run_for_user(
    *,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationRunValue | None:
    async with db_engine.async_session_factory() as db:
        row = (
            await db.execute(
                select(Automation, CloudRepoConfig)
                .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                .where(
                    Automation.id == automation_id,
                    Automation.user_id == user_id,
                )
            )
        ).one_or_none()
        if row is None:
            return None
        automation, repo_config = row
        now = utcnow()
        run = AutomationRun(
            automation_id=automation.id,
            user_id=user_id,
            trigger_kind=AUTOMATION_RUN_TRIGGER_MANUAL,
            scheduled_for=None,
            execution_target=automation.execution_target,
            status=AUTOMATION_RUN_STATUS_QUEUED,
            title_snapshot=automation.title,
            prompt_snapshot=automation.prompt,
            git_provider_snapshot=SUPPORTED_GIT_PROVIDER,
            git_owner_snapshot=repo_config.git_owner,
            git_repo_name_snapshot=repo_config.git_repo_name,
            cloud_repo_config_id_snapshot=automation.cloud_repo_config_id,
            agent_kind_snapshot=automation.agent_kind,
            model_id_snapshot=automation.model_id,
            mode_id_snapshot=automation.mode_id,
            reasoning_effort_snapshot=automation.reasoning_effort,
            executor_kind=None,
            executor_id=None,
            claim_id=None,
            claimed_at=None,
            claim_expires_at=None,
            last_heartbeat_at=None,
            dispatch_started_at=None,
            dispatched_at=None,
            failed_at=None,
            cloud_workspace_id=None,
            anyharness_workspace_id=None,
            anyharness_session_id=None,
            cancelled_at=None,
            last_error_code=None,
            last_error_message=None,
            created_at=now,
            updated_at=now,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return _run_value(run)


async def list_runs_for_automation_for_user(
    *,
    user_id: UUID,
    automation_id: UUID,
    limit: int,
) -> list[AutomationRunValue] | None:
    async with db_engine.async_session_factory() as db:
        exists = (
            await db.execute(
                select(Automation.id).where(
                    Automation.id == automation_id,
                    Automation.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            return None
        records = list(
            (
                await db.execute(
                    select(AutomationRun)
                    .where(
                        AutomationRun.automation_id == automation_id,
                        AutomationRun.user_id == user_id,
                    )
                    .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return [_run_value(record) for record in records]


async def create_due_scheduled_runs_batch(
    *,
    now: datetime,
    limit: int,
    schedule_advance_resolver: ScheduleAdvanceResolver,
) -> int:
    async with db_engine.async_session_factory() as db:
        rows = list(
            (
                await db.execute(
                    select(Automation, CloudRepoConfig)
                    .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                    .where(
                        Automation.enabled.is_(True),
                        Automation.next_run_at.is_not(None),
                        Automation.next_run_at <= now,
                        CloudRepoConfig.configured.is_(True),
                    )
                    .order_by(Automation.next_run_at.asc())
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            .all()
        )
        inserted_count = 0
        for record, repo_config in rows:
            try:
                advance = schedule_advance_resolver(
                    AutomationScheduleFields(
                        schedule_rrule=record.schedule_rrule,
                        schedule_timezone=record.schedule_timezone,
                        next_run_at=record.next_run_at,
                    ),
                    now,
                )
            except Exception:
                logger.exception(
                    "automation schedule advance failed; disabling automation automation_id=%s",
                    record.id,
                )
                record.enabled = False
                record.paused_at = now
                record.next_run_at = None
                record.updated_at = now
                continue
            if advance.scheduled_for is not None:
                result = await db.execute(
                    pg_insert(AutomationRun)
                    .values(
                        automation_id=record.id,
                        user_id=record.user_id,
                        trigger_kind=AUTOMATION_RUN_TRIGGER_SCHEDULED,
                        scheduled_for=advance.scheduled_for,
                        execution_target=record.execution_target,
                        status=AUTOMATION_RUN_STATUS_QUEUED,
                        title_snapshot=record.title,
                        prompt_snapshot=record.prompt,
                        git_provider_snapshot=SUPPORTED_GIT_PROVIDER,
                        git_owner_snapshot=repo_config.git_owner,
                        git_repo_name_snapshot=repo_config.git_repo_name,
                        cloud_repo_config_id_snapshot=record.cloud_repo_config_id,
                        agent_kind_snapshot=record.agent_kind,
                        model_id_snapshot=record.model_id,
                        mode_id_snapshot=record.mode_id,
                        reasoning_effort_snapshot=record.reasoning_effort,
                        executor_kind=None,
                        executor_id=None,
                        claim_id=None,
                        claimed_at=None,
                        claim_expires_at=None,
                        last_heartbeat_at=None,
                        dispatch_started_at=None,
                        dispatched_at=None,
                        failed_at=None,
                        cloud_workspace_id=None,
                        anyharness_workspace_id=None,
                        anyharness_session_id=None,
                        cancelled_at=None,
                        last_error_code=None,
                        last_error_message=None,
                        created_at=now,
                        updated_at=now,
                    )
                    .on_conflict_do_nothing(
                        index_elements=[
                            AutomationRun.automation_id,
                            AutomationRun.scheduled_for,
                        ],
                        index_where=AutomationRun.trigger_kind == AUTOMATION_RUN_TRIGGER_SCHEDULED,
                    )
                    .returning(AutomationRun.id)
                )
                if result.scalar_one_or_none() is not None:
                    inserted_count += 1
                    record.last_scheduled_at = advance.scheduled_for
                else:
                    logger.debug(
                        "automation scheduled slot already existed "
                        "automation_id=%s scheduled_for=%s",
                        record.id,
                        advance.scheduled_for,
                    )
                    # Another scheduler already created this slot; still advance next_run_at so
                    # the automation does not keep retrying an idempotent duplicate forever.
            record.next_run_at = advance.next_run_at
            record.updated_at = now
        await db.commit()
        return inserted_count
