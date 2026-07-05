"""Agent auth harness settings persistence (per user/harness/surface toggles)."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import AgentAuthHarnessSettings
from proliferate.utils.time import utcnow


async def get_harness_settings(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
) -> dict[str, Any] | None:
    """Get persisted settings for a scope. Returns None if no row exists."""
    row = (
        await db.execute(
            select(AgentAuthHarnessSettings).where(
                AgentAuthHarnessSettings.user_id == user_id,
                AgentAuthHarnessSettings.harness_kind == harness_kind,
                AgentAuthHarnessSettings.surface == surface,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return json.loads(row.settings_json)  # type: ignore[no-any-return]


async def list_harness_settings_for_surface(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> dict[str, dict[str, Any]]:
    """All settings rows for a user+surface, keyed by harness_kind."""
    rows = (
        (
            await db.execute(
                select(AgentAuthHarnessSettings).where(
                    AgentAuthHarnessSettings.user_id == user_id,
                    AgentAuthHarnessSettings.surface == surface,
                )
            )
        )
        .scalars()
        .all()
    )
    return {row.harness_kind: json.loads(row.settings_json) for row in rows}


async def put_harness_settings(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    settings: dict[str, Any],
) -> dict[str, Any]:
    """Upsert settings for a scope. Returns the persisted settings."""
    row = (
        await db.execute(
            select(AgentAuthHarnessSettings).where(
                AgentAuthHarnessSettings.user_id == user_id,
                AgentAuthHarnessSettings.harness_kind == harness_kind,
                AgentAuthHarnessSettings.surface == surface,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    settings_json = json.dumps(settings, sort_keys=True)
    if row is None:
        db.add(
            AgentAuthHarnessSettings(
                user_id=user_id,
                harness_kind=harness_kind,
                surface=surface,
                settings_json=settings_json,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        row.settings_json = settings_json
        row.updated_at = now
    await db.flush()
    return settings
