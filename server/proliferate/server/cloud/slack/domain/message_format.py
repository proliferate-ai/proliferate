"""Slack message formatting for cloud work."""

from __future__ import annotations

from proliferate.integrations.slack.messages import build_mrkdwn_message_blocks


def ack_blocks(*, repo_label: str, web_url: str | None) -> tuple[str, list[dict[str, object]]]:
    text = f"Working on `{repo_label}`."
    if web_url:
        text = f"{text} Open the session: {web_url}"
    return text, build_mrkdwn_message_blocks(title="Proliferate", body=text)


def clarification_blocks(*, message: str) -> tuple[str, list[dict[str, object]]]:
    return message, build_mrkdwn_message_blocks(title="Proliferate", body=message)


def completion_blocks(*, message: str, web_url: str | None) -> tuple[str, list[dict[str, object]]]:
    text = message
    if web_url:
        text = f"{text}\n\nOpen the session: {web_url}"
    return text, build_mrkdwn_message_blocks(title="Proliferate", body=text)
