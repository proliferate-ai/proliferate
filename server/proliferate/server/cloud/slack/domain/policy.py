"""Slack bot policy helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class SlackConnectionState(Protocol):
    status: str


class SlackBotConfigState(Protocol):
    enabled: bool
    allowed_slack_channel_ids: str | None


@dataclass(frozen=True)
class SlackBotAllowed:
    pass


@dataclass(frozen=True)
class SlackBotDenied:
    code: str
    message: str
    status_code: int


SlackBotVerdict = SlackBotAllowed | SlackBotDenied


def check_active_slack_bot(
    *,
    connection: SlackConnectionState | None,
    config: SlackBotConfigState | None,
    slack_channel_id: str | None = None,
) -> SlackBotVerdict:
    if connection is None:
        return SlackBotDenied("slack_not_connected", "Slack is not connected.", 404)
    if connection.status != "active":
        return SlackBotDenied(
            "slack_connection_requires_reauth",
            "Slack needs to be reconnected.",
            409,
        )
    if config is None or not config.enabled:
        return SlackBotDenied("slack_bot_disabled", "Slack bot is disabled.", 409)
    if slack_channel_id and config.allowed_slack_channel_ids:
        allowed = {
            item.strip() for item in config.allowed_slack_channel_ids.split(",") if item.strip()
        }
        if slack_channel_id not in allowed:
            return SlackBotDenied(
                "slack_channel_not_allowed",
                "Slack bot is not enabled for this channel.",
                403,
            )
    return SlackBotAllowed()
