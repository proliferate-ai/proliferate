"""Persistence helpers for automations."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_OWNER_SCOPE_ORGANIZATION,
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_STATUS_QUEUED,
    AUTOMATION_RUN_TRIGGER_MANUAL,
    AUTOMATION_RUN_TRIGGER_SCHEDULED,
    AUTOMATION_TARGET_MODE_LOCAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db import engine as db_engine
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

_UNSET: Final = object()


def _execution_target_for_target_mode(target_mode: str) -> str:
    return (
        AUTOMATION_EXECUTION_TARGET_LOCAL
        if target_mode == AUTOMATION_TARGET_MODE_LOCAL
        else AUTOMATION_EXECUTION_TARGET_CLOUD
    )


def _agent_snapshot(config: CloudAgentRunConfig) -> dict[str, object]:
    return {
        "config_id": str(config.id),
        "config_name": config.name,
        "agent_kind": config.agent_kind,
        "model_id": config.model_id,
        "control_values": dict(config.control_values_json or {}),
        "owner_scope_at_snapshot": config.owner_scope,
    }


def _snapshot_value(
    snapshot: dict[str, object] | None,
    key: str,
) -> str | None:
    if not snapshot:
        return None
    value = snapshot.get(key)
    return value if isinstance(value, str) and value else None


def _snapshot_control_value(
    snapshot: dict[str, object] | None,
    key: str,
) -> str | None:
    if not snapshot:
        return None
    controls = snapshot.get("control_values")
    if not isinstance(controls, dict):
        return None
    value = controls.get(key)
    return value if isinstance(value, str) and value else None


@dataclass(frozen=True)
class AutomationValue:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID
    cloud_repo_config_id: UUID
    git_owner: str
    git_repo_name: str
    title: str
    prompt: str
    schedule_rrule: str
    schedule_timezone: str
    schedule_summary: str
    target_mode: str
    cloud_agent_run_config_id: UUID
    enabled: bool
    paused_at: datetime | None
    next_run_at: datetime | None
    last_scheduled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def user_id(self) -> UUID:
        return self.owner_user_id or self.created_by_user_id

    @property
    def execution_target(self) -> str:
        return _execution_target_for_target_mode(self.target_mode)


@dataclass(frozen=True)
class AutomationRunValue:
    id: UUID
    automation_id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID
    trigger_kind: str
    scheduled_for: datetime | None
    target_mode: str
    status: str
    title_snapshot: str
    prompt_snapshot: str
    git_provider_snapshot: str
    git_owner_snapshot: str
    git_repo_name_snapshot: str
    cloud_repo_config_id_snapshot: UUID
    cloud_target_id_snapshot: UUID | None
    cloud_target_kind_snapshot: str | None
    sandbox_profile_id: UUID | None
    cloud_workspace_exposure_id: UUID | None
    agent_run_config_snapshot_json: dict[str, object] | None
    cascade_attempt: int
    last_cascade_command_id: UUID | None
    last_cascade_reason: str | None
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

    @property
    def user_id(self) -> UUID:
        return self.owner_user_id or self.created_by_user_id

    @property
    def execution_target(self) -> str:
        return _execution_target_for_target_mode(self.target_mode)

    @property
    def agent_kind(self) -> str | None:
        return _snapshot_value(self.agent_run_config_snapshot_json, "agent_kind")

    @property
    def model_id(self) -> str | None:
        return _snapshot_value(self.agent_run_config_snapshot_json, "model_id")

    @property
    def mode_id(self) -> str | None:
        return _snapshot_control_value(self.agent_run_config_snapshot_json, "mode")

    @property
    def reasoning_effort(self) -> str | None:
        return _snapshot_control_value(self.agent_run_config_snapshot_json, "reasoning") or (
            _snapshot_control_value(self.agent_run_config_snapshot_json, "effort")
        )

    @property
    def agent_kind_snapshot(self) -> str | None:
        return self.agent_kind

    @property
    def model_id_snapshot(self) -> str | None:
        return self.model_id

    @property
    def mode_id_snapshot(self) -> str | None:
        return self.mode_id

    @property
    def reasoning_effort_snapshot(self) -> str | None:
        return self.reasoning_effort


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
        owner_scope=record.owner_scope,
        owner_user_id=record.owner_user_id,
        organization_id=record.organization_id,
        created_by_user_id=record.created_by_user_id,
        cloud_repo_config_id=record.cloud_repo_config_id,
        git_owner=repo_config.git_owner,
        git_repo_name=repo_config.git_repo_name,
        title=record.title,
        prompt=record.prompt,
        schedule_rrule=record.schedule_rrule,
        schedule_timezone=record.schedule_timezone,
        schedule_summary=record.schedule_summary,
        target_mode=record.target_mode,
        cloud_agent_run_config_id=record.cloud_agent_run_config_id,
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
        owner_scope=record.owner_scope,
        owner_user_id=record.owner_user_id,
        organization_id=record.organization_id,
        created_by_user_id=record.created_by_user_id,
        trigger_kind=record.trigger_kind,
        scheduled_for=record.scheduled_for,
        target_mode=record.target_mode,
        status=record.status,
        title_snapshot=record.title_snapshot,
        prompt_snapshot=record.prompt_snapshot,
        git_provider_snapshot=record.git_provider_snapshot,
        git_owner_snapshot=record.git_owner_snapshot,
        git_repo_name_snapshot=record.git_repo_name_snapshot,
        cloud_repo_config_id_snapshot=record.cloud_repo_config_id_snapshot,
        cloud_target_id_snapshot=record.cloud_target_id_snapshot,
        cloud_target_kind_snapshot=record.cloud_target_kind_snapshot,
        sandbox_profile_id=record.sandbox_profile_id,
        cloud_workspace_exposure_id=record.cloud_workspace_exposure_id,
        agent_run_config_snapshot_json=record.agent_run_config_snapshot_json,
        cascade_attempt=record.cascade_attempt,
        last_cascade_command_id=record.last_cascade_command_id,
        last_cascade_reason=record.last_cascade_reason,
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


def _automation_owner_predicates(
    *,
    user_id: UUID,
    owner_scope: str,
    organization_id: UUID | None,
) -> list[object]:
    if owner_scope == AUTOMATION_OWNER_SCOPE_ORGANIZATION:
        return [
            Automation.owner_scope == AUTOMATION_OWNER_SCOPE_ORGANIZATION,
            Automation.organization_id == organization_id,
        ]
    return [
        Automation.owner_scope == AUTOMATION_OWNER_SCOPE_PERSONAL,
        Automation.owner_user_id == user_id,
    ]


async def _load_automation_value(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> AutomationValue | None:
    row = (
        await db.execute(
            select(Automation, CloudRepoConfig)
            .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
            .where(
                Automation.id == automation_id,
                *_automation_owner_predicates(
                    user_id=user_id,
                    owner_scope=owner_scope,
                    organization_id=organization_id,
                ),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    record, repo_config = row
    return _automation_value(record, repo_config)


async def load_automation_by_id(
    db: AsyncSession,
    *,
    automation_id: UUID,
) -> AutomationValue | None:
    row = (
        await db.execute(
            select(Automation, CloudRepoConfig)
            .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
            .where(Automation.id == automation_id)
        )
    ).one_or_none()
    if row is None:
        return None
    record, repo_config = row
    return _automation_value(record, repo_config)


async def create_automation_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    owner_scope: str,
    organization_id: UUID | None,
    cloud_repo_config_id: UUID,
    title: str,
    prompt: str,
    schedule_rrule: str,
    schedule_timezone: str,
    schedule_summary: str,
    target_mode: str,
    cloud_agent_run_config_id: UUID,
    next_run_at: datetime | None,
) -> AutomationValue:
    now = utcnow()
    record = Automation(
        owner_scope=owner_scope,
        owner_user_id=user_id if owner_scope == AUTOMATION_OWNER_SCOPE_PERSONAL else None,
        organization_id=organization_id,
        created_by_user_id=user_id,
        cloud_repo_config_id=cloud_repo_config_id,
        title=title,
        prompt=prompt,
        schedule_rrule=schedule_rrule,
        schedule_timezone=schedule_timezone,
        schedule_summary=schedule_summary,
        target_mode=target_mode,
        cloud_agent_run_config_id=cloud_agent_run_config_id,
        enabled=True,
        paused_at=None,
        next_run_at=next_run_at,
        last_scheduled_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    await db.flush()
    value = await _load_automation_value(
        db,
        user_id=user_id,
        automation_id=record.id,
        owner_scope=owner_scope,
        organization_id=organization_id,
    )
    if value is None:
        raise RuntimeError("Created automation could not be loaded.")
    return value


async def list_automations_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> list[AutomationValue]:
    rows = list(
        (
            await db.execute(
                select(Automation, CloudRepoConfig)
                .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                .where(
                    *_automation_owner_predicates(
                        user_id=user_id,
                        owner_scope=owner_scope,
                        organization_id=organization_id,
                    )
                )
                .order_by(Automation.created_at.desc())
            )
        ).all()
    )
    return [_automation_value(record, repo_config) for record, repo_config in rows]


async def load_automation_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> AutomationValue | None:
    return await _load_automation_value(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=owner_scope,
        organization_id=organization_id,
    )


async def update_automation_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
    title: object = _UNSET,
    prompt: object = _UNSET,
    schedule_rrule: object = _UNSET,
    schedule_timezone: object = _UNSET,
    schedule_summary: object = _UNSET,
    target_mode: object = _UNSET,
    cloud_agent_run_config_id: object = _UNSET,
    enabled: object = _UNSET,
    paused_at: object = _UNSET,
    next_run_at: object = _UNSET,
) -> AutomationValue | None:
    record = (
        await db.execute(
            select(Automation).where(
                Automation.id == automation_id,
                *_automation_owner_predicates(
                    user_id=user_id,
                    owner_scope=owner_scope,
                    organization_id=organization_id,
                ),
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
    if target_mode is not _UNSET:
        record.target_mode = target_mode  # type: ignore[assignment]
    if cloud_agent_run_config_id is not _UNSET:
        record.cloud_agent_run_config_id = cloud_agent_run_config_id  # type: ignore[assignment]
    if enabled is not _UNSET:
        record.enabled = enabled  # type: ignore[assignment]
    if paused_at is not _UNSET:
        record.paused_at = paused_at  # type: ignore[assignment]
    if next_run_at is not _UNSET:
        record.next_run_at = next_run_at  # type: ignore[assignment]
    record.updated_at = utcnow()
    await db.flush()
    return await _load_automation_value(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=owner_scope,
        organization_id=organization_id,
    )


async def create_manual_run_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> AutomationRunValue | None:
    row = (
        await db.execute(
            select(Automation, CloudRepoConfig, CloudAgentRunConfig)
            .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
            .join(
                CloudAgentRunConfig,
                Automation.cloud_agent_run_config_id == CloudAgentRunConfig.id,
            )
            .where(
                Automation.id == automation_id,
                *_automation_owner_predicates(
                    user_id=user_id,
                    owner_scope=owner_scope,
                    organization_id=organization_id,
                ),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    automation, repo_config, run_config = row
    now = utcnow()
    run = AutomationRun(
        automation_id=automation.id,
        owner_scope=automation.owner_scope,
        owner_user_id=automation.owner_user_id,
        organization_id=automation.organization_id,
        created_by_user_id=user_id,
        trigger_kind=AUTOMATION_RUN_TRIGGER_MANUAL,
        scheduled_for=None,
        target_mode=automation.target_mode,
        status=AUTOMATION_RUN_STATUS_QUEUED,
        title_snapshot=automation.title,
        prompt_snapshot=automation.prompt,
        git_provider_snapshot=SUPPORTED_GIT_PROVIDER,
        git_owner_snapshot=repo_config.git_owner,
        git_repo_name_snapshot=repo_config.git_repo_name,
        cloud_repo_config_id_snapshot=automation.cloud_repo_config_id,
        cloud_target_id_snapshot=None,
        cloud_target_kind_snapshot=None,
        sandbox_profile_id=None,
        cloud_workspace_exposure_id=None,
        agent_run_config_snapshot_json=_agent_snapshot(run_config),
        cascade_attempt=0,
        last_cascade_command_id=None,
        last_cascade_reason=None,
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
    await db.flush()
    return _run_value(run)


async def list_runs_for_automation_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    automation_id: UUID,
    limit: int,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> list[AutomationRunValue] | None:
    exists = (
        await db.execute(
            select(Automation.id).where(
                Automation.id == automation_id,
                *_automation_owner_predicates(
                    user_id=user_id,
                    owner_scope=owner_scope,
                    organization_id=organization_id,
                ),
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        return None
    records = list(
        (
            await db.execute(
                select(AutomationRun)
                .where(AutomationRun.automation_id == automation_id)
                .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [_run_value(record) for record in records]


async def list_latest_runs_by_cloud_workspace_ids_for_user(
    *,
    user_id: UUID,
    cloud_workspace_ids: list[UUID],
) -> dict[UUID, AutomationRunValue]:
    if not cloud_workspace_ids:
        return {}
    unique_ids = list(dict.fromkeys(cloud_workspace_ids))
    async with db_engine.async_session_factory() as db:
        records = list(
            (
                await db.execute(
                    select(AutomationRun)
                    .where(
                        AutomationRun.owner_scope == AUTOMATION_OWNER_SCOPE_PERSONAL,
                        AutomationRun.owner_user_id == user_id,
                        AutomationRun.cloud_workspace_id.in_(unique_ids),
                    )
                    .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
                )
            )
            .scalars()
            .all()
        )
    values_by_workspace: dict[UUID, AutomationRunValue] = {}
    for record in records:
        if record.cloud_workspace_id is None or record.cloud_workspace_id in values_by_workspace:
            continue
        values_by_workspace[record.cloud_workspace_id] = _run_value(record)
    return values_by_workspace


async def create_due_scheduled_runs_batch(
    db: AsyncSession,
    *,
    now: datetime,
    limit: int,
    schedule_advance_resolver: ScheduleAdvanceResolver,
) -> int:
    rows = list(
        (
            await db.execute(
                select(Automation, CloudRepoConfig, CloudAgentRunConfig)
                .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                .join(
                    CloudAgentRunConfig,
                    Automation.cloud_agent_run_config_id == CloudAgentRunConfig.id,
                )
                .where(
                    Automation.enabled.is_(True),
                    Automation.next_run_at.is_not(None),
                    Automation.next_run_at <= now,
                    or_(
                        Automation.target_mode == AUTOMATION_TARGET_MODE_LOCAL,
                        and_(
                            Automation.target_mode == AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                            CloudRepoConfig.configured.is_(True),
                        ),
                        Automation.target_mode != AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    ),
                )
                .order_by(Automation.next_run_at.asc())
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    inserted_count = 0
    for record, repo_config, run_config in rows:
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
                    owner_scope=record.owner_scope,
                    owner_user_id=record.owner_user_id,
                    organization_id=record.organization_id,
                    created_by_user_id=record.created_by_user_id,
                    trigger_kind=AUTOMATION_RUN_TRIGGER_SCHEDULED,
                    scheduled_for=advance.scheduled_for,
                    target_mode=record.target_mode,
                    status=AUTOMATION_RUN_STATUS_QUEUED,
                    title_snapshot=record.title,
                    prompt_snapshot=record.prompt,
                    git_provider_snapshot=SUPPORTED_GIT_PROVIDER,
                    git_owner_snapshot=repo_config.git_owner,
                    git_repo_name_snapshot=repo_config.git_repo_name,
                    cloud_repo_config_id_snapshot=record.cloud_repo_config_id,
                    cloud_target_id_snapshot=None,
                    cloud_target_kind_snapshot=None,
                    sandbox_profile_id=None,
                    cloud_workspace_exposure_id=None,
                    agent_run_config_snapshot_json=_agent_snapshot(run_config),
                    cascade_attempt=0,
                    last_cascade_command_id=None,
                    last_cascade_reason=None,
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
                    "automation scheduled slot already existed automation_id=%s scheduled_for=%s",
                    record.id,
                    advance.scheduled_for,
                )
        record.next_run_at = advance.next_run_at
        record.updated_at = now
    return inserted_count
