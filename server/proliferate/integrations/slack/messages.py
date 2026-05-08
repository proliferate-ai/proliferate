from __future__ import annotations

from dataclasses import dataclass

SLACK_SECTION_FIELD_LIMIT = 10


@dataclass(frozen=True)
class SlackMessageField:
    label: str
    value: str


def build_mrkdwn_message_blocks(
    *,
    title: str,
    body: str,
    fields: tuple[SlackMessageField, ...] = (),
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = [
        _section(_escape_mrkdwn(title)),
        _section(_escape_mrkdwn(body)),
    ]
    if fields:
        blocks.append(
            {
                "type": "section",
                "fields": [_mrkdwn_field(field) for field in fields[:SLACK_SECTION_FIELD_LIMIT]],
            }
        )
    return blocks


def _section(text: str) -> dict[str, object]:
    return {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": text,
        },
    }


def _mrkdwn_field(field: SlackMessageField) -> dict[str, str]:
    return {
        "type": "mrkdwn",
        "text": f"*{_escape_mrkdwn(field.label)}*\n{_escape_mrkdwn(field.value)}",
    }


def _escape_mrkdwn(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
