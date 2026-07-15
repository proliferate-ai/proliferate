"""Persistence checks for repository-environment automation references."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.automations import Automation, AutomationRun


async def repo_environment_has_automation_references(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> bool:
    definition_exists = await db.scalar(
        select(exists().where(Automation.repo_environment_id == repo_environment_id))
    )
    if definition_exists:
        return True
    return bool(
        await db.scalar(
            select(
                exists().where(
                    AutomationRun.repo_environment_id_snapshot == repo_environment_id
                )
            )
        )
    )
