"""Persistence helpers for automations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_OWNER_SCOPE_ORGANIZATION,
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_TARGET_MODE_LOCAL,
)
from proliferate.db.models.automations import Automation
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.utils.time import utcnow

_UNSET: Final = object()


def _execution_target_for_target_mode(target_mode: str) -> str:
    return (
        AUTOMATION_EXECUTION_TARGET_LOCAL
        if target_mode == AUTOMATION_TARGET_MODE_LOCAL
        else AUTOMATION_EXECUTION_TARGET_CLOUD
    )


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
    archived_at: datetime | None
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
        archived_at=record.archived_at,
        next_run_at=record.next_run_at,
        last_scheduled_at=record.last_scheduled_at,
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
    include_archived: bool = False,
) -> list[AutomationValue]:
    predicates = list(
        _automation_owner_predicates(
            user_id=user_id,
            owner_scope=owner_scope,
            organization_id=organization_id,
        )
    )
    if not include_archived:
        predicates.append(Automation.archived_at.is_(None))
    rows = list(
        (
            await db.execute(
                select(Automation, CloudRepoConfig)
                .join(CloudRepoConfig, Automation.cloud_repo_config_id == CloudRepoConfig.id)
                .where(*predicates)
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
    archived_at: object = _UNSET,
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
    if archived_at is not _UNSET:
        record.archived_at = archived_at  # type: ignore[assignment]
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
