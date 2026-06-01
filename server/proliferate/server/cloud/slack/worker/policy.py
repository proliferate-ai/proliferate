"""Worker-side adapters for pure Slack bot policy verdicts."""

from __future__ import annotations

from proliferate.db.store.cloud_slack.records import (
    SlackBotConfigRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.domain.policy import SlackBotDenied, check_active_slack_bot


def require_active_slack_bot(
    *,
    connection: SlackWorkspaceConnectionRecord | None,
    config: SlackBotConfigRecord | None,
    slack_channel_id: str | None = None,
) -> tuple[SlackWorkspaceConnectionRecord, SlackBotConfigRecord]:
    verdict = check_active_slack_bot(
        connection=connection,
        config=config,
        slack_channel_id=slack_channel_id,
    )
    if isinstance(verdict, SlackBotDenied):
        raise CloudApiError(
            verdict.code,
            verdict.message,
            status_code=_policy_status_code(verdict.code),
        )
    assert connection is not None
    assert config is not None
    return connection, config


def _policy_status_code(code: str) -> int:
    if code == "slack_channel_not_allowed":
        return 403
    if code == "slack_not_connected":
        return 404
    return 409
