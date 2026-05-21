"""Slack workspace connection persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.slack import (
    SLACK_CONNECTION_STATUS_ACTIVE,
    SLACK_CONNECTION_STATUS_REAUTH_REQUIRED,
    SLACK_CONNECTION_STATUS_REVOKED,
)
from proliferate.db.models.cloud.slack import SlackWorkspaceConnection
from proliferate.db.store.cloud_slack.records import SlackWorkspaceConnectionRecord
from proliferate.utils.crypto import encrypt_text
from proliferate.utils.time import utcnow

SLACK_BOT_TOKEN_CIPHERTEXT_KEY_ID = "cloud-secret-v1"


def _record(row: SlackWorkspaceConnection) -> SlackWorkspaceConnectionRecord:
    return SlackWorkspaceConnectionRecord(
        id=row.id,
        organization_id=row.organization_id,
        slack_team_id=row.slack_team_id,
        slack_team_name=row.slack_team_name,
        slack_bot_user_id=row.slack_bot_user_id,
        bot_token_ciphertext=row.bot_token_ciphertext,
        bot_token_ciphertext_key_id=row.bot_token_ciphertext_key_id,
        bot_scopes=row.bot_scopes,
        status=row.status,
        installed_by_user_id=row.installed_by_user_id,
        installed_at=row.installed_at,
        last_validated_at=row.last_validated_at,
        revoked_at=row.revoked_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_active_connection_for_org(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> SlackWorkspaceConnectionRecord | None:
    row = (
        await db.execute(
            select(SlackWorkspaceConnection)
            .where(SlackWorkspaceConnection.organization_id == organization_id)
            .where(SlackWorkspaceConnection.status != SLACK_CONNECTION_STATUS_REVOKED)
            .order_by(SlackWorkspaceConnection.updated_at.desc())
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def get_active_connection_for_team(
    db: AsyncSession,
    *,
    slack_team_id: str,
) -> SlackWorkspaceConnectionRecord | None:
    row = (
        await db.execute(
            select(SlackWorkspaceConnection)
            .where(SlackWorkspaceConnection.slack_team_id == slack_team_id)
            .where(SlackWorkspaceConnection.status != SLACK_CONNECTION_STATUS_REVOKED)
            .order_by(SlackWorkspaceConnection.updated_at.desc())
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def get_connection(
    db: AsyncSession,
    connection_id: UUID,
) -> SlackWorkspaceConnectionRecord | None:
    row = await db.get(SlackWorkspaceConnection, connection_id)
    return _record(row) if row is not None else None


async def upsert_connection(
    db: AsyncSession,
    *,
    organization_id: UUID,
    slack_team_id: str,
    slack_team_name: str,
    slack_bot_user_id: str,
    bot_token: str,
    bot_scopes: str,
    installed_by_user_id: UUID,
) -> SlackWorkspaceConnectionRecord:
    now = utcnow()
    row = (
        await db.execute(
            select(SlackWorkspaceConnection)
            .where(
                or_(
                    SlackWorkspaceConnection.organization_id == organization_id,
                    SlackWorkspaceConnection.slack_team_id == slack_team_id,
                )
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        row = SlackWorkspaceConnection(
            organization_id=organization_id,
            slack_team_id=slack_team_id,
            slack_team_name=slack_team_name,
            slack_bot_user_id=slack_bot_user_id,
            bot_token_ciphertext=encrypt_text(bot_token),
            bot_token_ciphertext_key_id=SLACK_BOT_TOKEN_CIPHERTEXT_KEY_ID,
            bot_scopes=bot_scopes,
            status=SLACK_CONNECTION_STATUS_ACTIVE,
            installed_by_user_id=installed_by_user_id,
            installed_at=now,
            last_validated_at=now,
            revoked_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.organization_id = organization_id
        row.slack_team_id = slack_team_id
        row.slack_team_name = slack_team_name
        row.slack_bot_user_id = slack_bot_user_id
        row.bot_token_ciphertext = encrypt_text(bot_token)
        row.bot_token_ciphertext_key_id = SLACK_BOT_TOKEN_CIPHERTEXT_KEY_ID
        row.bot_scopes = bot_scopes
        row.status = SLACK_CONNECTION_STATUS_ACTIVE
        row.installed_by_user_id = installed_by_user_id
        row.installed_at = now
        row.last_validated_at = now
        row.revoked_at = None
        row.updated_at = now
    await db.flush()
    return _record(row)


async def mark_connection_validated(
    db: AsyncSession,
    *,
    connection_id: UUID,
) -> SlackWorkspaceConnectionRecord | None:
    row = await db.get(SlackWorkspaceConnection, connection_id)
    if row is None:
        return None
    now = utcnow()
    row.status = SLACK_CONNECTION_STATUS_ACTIVE
    row.last_validated_at = now
    row.updated_at = now
    await db.flush()
    return _record(row)


async def mark_connection_reauth_required(
    db: AsyncSession,
    *,
    connection_id: UUID,
) -> SlackWorkspaceConnectionRecord | None:
    row = await db.get(SlackWorkspaceConnection, connection_id)
    if row is None:
        return None
    row.status = SLACK_CONNECTION_STATUS_REAUTH_REQUIRED
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)


async def revoke_connection_for_org(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> SlackWorkspaceConnectionRecord | None:
    row = (
        await db.execute(
            select(SlackWorkspaceConnection)
            .where(SlackWorkspaceConnection.organization_id == organization_id)
            .where(SlackWorkspaceConnection.status != SLACK_CONNECTION_STATUS_REVOKED)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.status = SLACK_CONNECTION_STATUS_REVOKED
    row.revoked_at = now
    row.updated_at = now
    await db.flush()
    return _record(row)
