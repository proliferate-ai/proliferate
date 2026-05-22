from __future__ import annotations

from proliferate.server.cloud.slack.domain.message_format import (
    ack_blocks,
    clarification_blocks,
    configuration_blocks,
    completion_blocks,
)


def test_ack_blocks_use_single_section_and_button() -> None:
    fallback, blocks = ack_blocks(
        repo_label="withkeystone/landing",
        web_url="http://localhost:5175/cloud/workspaces/ws_123",
    )

    assert fallback == (
        "Working on withkeystone/landing. "
        "Open: http://localhost:5175/cloud/workspaces/ws_123"
    )
    assert blocks == [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": ":white_check_mark: Working on `withkeystone/landing`.",
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Open session"},
                    "url": "http://localhost:5175/cloud/workspaces/ws_123",
                    "action_id": "open_cloud_workspace",
                }
            ],
        },
    ]


def test_completion_blocks_omit_repeated_title_and_escape_message() -> None:
    fallback, blocks = completion_blocks(
        message="Fixed A&B > C",
        web_url="http://localhost:5175/cloud/workspaces/ws_123",
    )

    assert fallback == "Fixed A&B > C"
    assert blocks == [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "Fixed A&amp;B &gt; C"},
        }
    ]


def test_clarification_blocks_are_plain_single_message() -> None:
    fallback, blocks = clarification_blocks(message="Pick a repo <owner/name>.")

    assert fallback == "Pick a repo <owner/name>."
    assert blocks == [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "Pick a repo &lt;owner/name&gt;."},
        }
    ]


def test_configuration_blocks_include_settings_button() -> None:
    fallback, blocks = configuration_blocks(
        message="Reconnect Slack.",
        settings_url="http://localhost:5175/settings?section=slack-bot",
    )

    assert fallback == (
        "Reconnect Slack. Configure Slack: "
        "http://localhost:5175/settings?section=slack-bot"
    )
    assert blocks == [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "Reconnect Slack."},
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Configure Slack"},
                    "url": "http://localhost:5175/settings?section=slack-bot",
                    "action_id": "configure_slack",
                }
            ],
        },
    ]
