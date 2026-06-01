"""Outbound Slack message processing."""

from __future__ import annotations

from datetime import timedelta

from cryptography.fernet import InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.cloud_slack import connections as connection_store
from proliferate.db.store.cloud_slack import outbound as outbound_store
from proliferate.db.store.cloud_slack.records import (
    SlackOutboundMessageRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.integrations.slack import client as slack_client
from proliferate.integrations.slack.errors import SlackApiError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.crypto import decrypt_text
from proliferate.utils.time import utcnow


async def process_due_outbound_messages(db: AsyncSession, *, limit: int) -> None:
    due = await outbound_store.list_due_outbound_messages(db, now=utcnow(), limit=limit)
    for message in due:
        await send_outbound_message(db, message)


async def send_outbound_message(
    db: AsyncSession,
    message: SlackOutboundMessageRecord,
) -> None:
    sending = await outbound_store.mark_outbound_sending(db, message_id=message.id)
    if sending is None or sending.status != "sending":
        return
    connection = await connection_store.get_connection(db, sending.slack_workspace_connection_id)
    if connection is None:
        await outbound_store.mark_outbound_failed(
            db,
            message_id=sending.id,
            error_code="slack_connection_missing",
            error_message="Slack connection is missing.",
        )
        return
    try:
        bot_token = await _decrypt_bot_token_or_reauth(db, connection=connection)
    except CloudApiError as exc:
        await outbound_store.mark_outbound_failed(
            db,
            message_id=sending.id,
            error_code=exc.code,
            error_message=exc.message,
        )
        return
    try:
        result = await slack_client.chat_post_message(
            bot_token=bot_token,
            channel_id=sending.slack_channel_id,
            text=sending.fallback_text,
            blocks=sending.blocks_json,
            thread_ts=sending.slack_thread_ts,
        )
    except SlackApiError as exc:
        retry_after = exc.retry_after_seconds
        attempts = sending.attempts + (0 if retry_after else 1)
        max_attempts = max(1, settings.slack_outbound_max_attempts)
        await outbound_store.mark_outbound_retry(
            db,
            message_id=sending.id,
            attempts=attempts,
            next_attempt_at=utcnow()
            + timedelta(seconds=retry_after or min(300, 2 ** min(attempts, 8))),
            error_code=exc.code,
            error_message=str(exc),
            dropped=attempts >= max_attempts,
        )
        return
    await outbound_store.mark_outbound_sent(
        db,
        message_id=sending.id,
        sent_message_ts=result.message_ts,
    )


async def _decrypt_bot_token_or_reauth(
    db: AsyncSession,
    *,
    connection: SlackWorkspaceConnectionRecord,
) -> str:
    try:
        return decrypt_text(connection.bot_token_ciphertext)
    except InvalidToken as exc:
        await connection_store.mark_connection_reauth_required(db, connection_id=connection.id)
        raise CloudApiError(
            "slack_connection_reauth_required",
            "Slack must be reconnected before the bot can be used.",
            status_code=409,
        ) from exc
