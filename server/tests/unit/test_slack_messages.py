from __future__ import annotations

from proliferate.integrations.slack.messages import (
    SLACK_SECTION_FIELD_LIMIT,
    SlackMessageField,
    build_mrkdwn_message_blocks,
)


def test_build_mrkdwn_message_blocks_escapes_text_and_fields() -> None:
    blocks = build_mrkdwn_message_blocks(
        title="*New <support> message*",
        body="Need help with A&B > C",
        fields=(
            SlackMessageField("From", "Pablo <pablo@example.com>"),
            SlackMessageField("Workspace", "A&B"),
        ),
    )

    assert blocks[0]["text"]["text"] == "*New &lt;support&gt; message*"
    assert blocks[1]["text"]["text"] == "Need help with A&amp;B &gt; C"
    assert blocks[2]["fields"] == [
        {"type": "mrkdwn", "text": "*From*\nPablo &lt;pablo@example.com&gt;"},
        {"type": "mrkdwn", "text": "*Workspace*\nA&amp;B"},
    ]


def test_build_mrkdwn_message_blocks_limits_section_fields() -> None:
    fields = tuple(
        SlackMessageField(f"Field {index}", str(index))
        for index in range(SLACK_SECTION_FIELD_LIMIT + 2)
    )

    blocks = build_mrkdwn_message_blocks(
        title="Title",
        body="Body",
        fields=fields,
    )

    assert len(blocks[2]["fields"]) == SLACK_SECTION_FIELD_LIMIT
