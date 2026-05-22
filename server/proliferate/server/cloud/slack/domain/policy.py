"""Slack bot policy helpers."""

from __future__ import annotations

from proliferate.constants.slack import SLACK_CONNECTION_STATUS_ACTIVE
from proliferate.db.store.cloud_slack.records import (
    SlackBotConfigRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.server.cloud.errors import CloudApiError


def require_active_slack_bot(
    *,
    connection: SlackWorkspaceConnectionRecord | None,
    config: SlackBotConfigRecord | None,
    slack_channel_id: str | None = None,
) -> tuple[SlackWorkspaceConnectionRecord, SlackBotConfigRecord]:
    if connection is None:
        raise CloudApiError("slack_not_connected", "Slack is not connected.", status_code=404)
    if connection.status != SLACK_CONNECTION_STATUS_ACTIVE:
        raise CloudApiError(
            "slack_connection_requires_reauth",
            "Slack needs to be reconnected.",
            status_code=409,
        )
    if config is None or not config.enabled:
        raise CloudApiError("slack_bot_disabled", "Slack bot is disabled.", status_code=409)
    if slack_channel_id and config.allowed_slack_channel_ids:
        allowed = {
            item.strip()
            for item in config.allowed_slack_channel_ids.split(",")
            if item.strip()
        }
        if slack_channel_id not in allowed:
            raise CloudApiError(
                "slack_channel_not_allowed",
                "Slack bot is not enabled for this channel.",
                status_code=403,
            )
    return connection, config
