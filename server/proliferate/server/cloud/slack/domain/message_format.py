"""Slack message formatting for cloud work."""

from __future__ import annotations


def ack_blocks(*, repo_label: str, web_url: str | None) -> tuple[str, list[dict[str, object]]]:
    text = f"Working on {repo_label}."
    if web_url:
        text = f"{text} Open: {web_url}"
    blocks = [_section(f":white_check_mark: Working on `{_escape_mrkdwn(repo_label)}`.")]
    _append_open_button(blocks, web_url)
    return text, blocks


def clarification_blocks(*, message: str) -> tuple[str, list[dict[str, object]]]:
    return message, [_section(_escape_mrkdwn(message))]


def configuration_blocks(
    *,
    message: str,
    settings_url: str | None,
) -> tuple[str, list[dict[str, object]]]:
    text = message
    if settings_url:
        text = f"{text} Configure Slack: {settings_url}"
    blocks = [_section(_escape_mrkdwn(message))]
    _append_button(
        blocks,
        url=settings_url,
        text="Configure Slack",
        action_id="configure_slack",
    )
    return text, blocks


def completion_blocks(*, message: str, web_url: str | None) -> tuple[str, list[dict[str, object]]]:
    _ = web_url
    return message, [_section(_escape_mrkdwn(message))]


def _section(text: str) -> dict[str, object]:
    return {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": text,
        },
    }


def _append_open_button(blocks: list[dict[str, object]], web_url: str | None) -> None:
    _append_button(
        blocks,
        url=web_url,
        text="Open session",
        action_id="open_cloud_workspace",
    )


def _append_button(
    blocks: list[dict[str, object]],
    *,
    url: str | None,
    text: str,
    action_id: str,
) -> None:
    if not url:
        return
    blocks.append(
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": text,
                    },
                    "url": url,
                    "action_id": action_id,
                }
            ],
        }
    )


def _escape_mrkdwn(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
