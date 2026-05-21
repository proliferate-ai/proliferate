"""Slack bot config persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.slack import SLACK_REPO_MODE_AUTO
from proliferate.db.models.cloud.slack import SlackBotConfig
from proliferate.db.store.cloud_slack.records import SlackBotConfigRecord
from proliferate.utils.time import utcnow


def _record(row: SlackBotConfig) -> SlackBotConfigRecord:
    return SlackBotConfigRecord(
        id=row.id,
        organization_id=row.organization_id,
        slack_workspace_connection_id=row.slack_workspace_connection_id,
        enabled=row.enabled,
        repo_mode=row.repo_mode,
        fixed_cloud_repo_config_id=row.fixed_cloud_repo_config_id,
        allowed_cloud_repo_config_ids=row.allowed_cloud_repo_config_ids,
        default_agent_kind=row.default_agent_kind,
        default_agent_run_config_id=row.default_agent_run_config_id,
        allowed_slack_channel_ids=row.allowed_slack_channel_ids,
        ack_message_template=row.ack_message_template,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_bot_config(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> SlackBotConfigRecord | None:
    row = (
        await db.execute(
            select(SlackBotConfig).where(SlackBotConfig.organization_id == organization_id)
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def ensure_bot_config(
    db: AsyncSession,
    *,
    organization_id: UUID,
    slack_workspace_connection_id: UUID,
) -> SlackBotConfigRecord:
    row = (
        await db.execute(
            select(SlackBotConfig)
            .where(SlackBotConfig.organization_id == organization_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = SlackBotConfig(
            organization_id=organization_id,
            slack_workspace_connection_id=slack_workspace_connection_id,
            enabled=True,
            repo_mode=SLACK_REPO_MODE_AUTO,
            fixed_cloud_repo_config_id=None,
            allowed_cloud_repo_config_ids=None,
            default_agent_kind=None,
            default_agent_run_config_id=None,
            allowed_slack_channel_ids=None,
            ack_message_template=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.slack_workspace_connection_id = slack_workspace_connection_id
        row.updated_at = now
    await db.flush()
    return _record(row)


async def update_bot_config(
    db: AsyncSession,
    *,
    organization_id: UUID,
    enabled: bool | None = None,
    repo_mode: str | None = None,
    fixed_cloud_repo_config_id: UUID | None = None,
    update_fixed_cloud_repo_config_id: bool = False,
    allowed_cloud_repo_config_ids: str | None = None,
    update_allowed_cloud_repo_config_ids: bool = False,
    default_agent_kind: str | None = None,
    update_default_agent_kind: bool = False,
    default_agent_run_config_id: UUID | None = None,
    update_default_agent_run_config_id: bool = False,
    allowed_slack_channel_ids: str | None = None,
    update_allowed_slack_channel_ids: bool = False,
    ack_message_template: str | None = None,
    update_ack_message_template: bool = False,
) -> SlackBotConfigRecord | None:
    row = (
        await db.execute(
            select(SlackBotConfig)
            .where(SlackBotConfig.organization_id == organization_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if enabled is not None:
        row.enabled = enabled
    if repo_mode is not None:
        row.repo_mode = repo_mode
    if update_fixed_cloud_repo_config_id:
        row.fixed_cloud_repo_config_id = fixed_cloud_repo_config_id
    if update_allowed_cloud_repo_config_ids:
        row.allowed_cloud_repo_config_ids = allowed_cloud_repo_config_ids
    if update_default_agent_kind:
        row.default_agent_kind = default_agent_kind
    if update_default_agent_run_config_id:
        row.default_agent_run_config_id = default_agent_run_config_id
    if update_allowed_slack_channel_ids:
        row.allowed_slack_channel_ids = allowed_slack_channel_ids
    if update_ack_message_template:
        row.ack_message_template = ack_message_template
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)
