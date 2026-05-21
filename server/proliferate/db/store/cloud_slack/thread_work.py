"""Slack thread to Cloud workspace/session persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.slack import SLACK_THREAD_WORK_STATUS_ACTIVE
from proliferate.db.models.cloud.slack import SlackThreadWork
from proliferate.db.store.cloud_slack.records import SlackThreadWorkRecord
from proliferate.utils.time import utcnow


def _record(row: SlackThreadWork) -> SlackThreadWorkRecord:
    return SlackThreadWorkRecord(
        id=row.id,
        organization_id=row.organization_id,
        slack_team_id=row.slack_team_id,
        slack_channel_id=row.slack_channel_id,
        slack_thread_ts=row.slack_thread_ts,
        cloud_workspace_id=row.cloud_workspace_id,
        cloud_session_id=row.cloud_session_id,
        cloud_workspace_exposure_id=row.cloud_workspace_exposure_id,
        cloud_session_projection_id=row.cloud_session_projection_id,
        root_message_ts=row.root_message_ts,
        bot_ack_message_ts=row.bot_ack_message_ts,
        initial_repo_id=row.initial_repo_id,
        agent_run_config_snapshot_json=(
            dict(row.agent_run_config_snapshot_json)
            if row.agent_run_config_snapshot_json is not None
            else None
        ),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


async def get_thread_work(
    db: AsyncSession,
    *,
    slack_team_id: str,
    slack_channel_id: str,
    slack_thread_ts: str,
) -> SlackThreadWorkRecord | None:
    row = (
        await db.execute(
            select(SlackThreadWork).where(
                SlackThreadWork.slack_team_id == slack_team_id,
                SlackThreadWork.slack_channel_id == slack_channel_id,
                SlackThreadWork.slack_thread_ts == slack_thread_ts,
            )
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def get_thread_work_by_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
) -> SlackThreadWorkRecord | None:
    row = (
        await db.execute(
            select(SlackThreadWork).where(SlackThreadWork.cloud_workspace_id == cloud_workspace_id)
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def create_thread_work(
    db: AsyncSession,
    *,
    organization_id: UUID,
    slack_team_id: str,
    slack_channel_id: str,
    slack_thread_ts: str,
    cloud_workspace_id: UUID,
    cloud_workspace_exposure_id: UUID | None,
    root_message_ts: str,
    initial_repo_id: UUID,
    agent_run_config_snapshot_json: dict[str, object] | None,
) -> SlackThreadWorkRecord:
    now = utcnow()
    row = SlackThreadWork(
        organization_id=organization_id,
        slack_team_id=slack_team_id,
        slack_channel_id=slack_channel_id,
        slack_thread_ts=slack_thread_ts,
        cloud_workspace_id=cloud_workspace_id,
        cloud_session_id=None,
        cloud_workspace_exposure_id=cloud_workspace_exposure_id,
        cloud_session_projection_id=None,
        root_message_ts=root_message_ts,
        bot_ack_message_ts=None,
        initial_repo_id=initial_repo_id,
        agent_run_config_snapshot_json=agent_run_config_snapshot_json,
        status=SLACK_THREAD_WORK_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
        archived_at=None,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def update_thread_work_ack(
    db: AsyncSession,
    *,
    thread_work_id: UUID,
    bot_ack_message_ts: str,
) -> SlackThreadWorkRecord | None:
    row = await db.get(SlackThreadWork, thread_work_id)
    if row is None:
        return None
    row.bot_ack_message_ts = bot_ack_message_ts
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)


async def update_thread_work_session(
    db: AsyncSession,
    *,
    thread_work_id: UUID,
    cloud_session_id: str,
    cloud_session_projection_id: UUID | None = None,
) -> SlackThreadWorkRecord | None:
    row = await db.get(SlackThreadWork, thread_work_id)
    if row is None:
        return None
    row.cloud_session_id = cloud_session_id
    row.cloud_session_projection_id = cloud_session_projection_id
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)
