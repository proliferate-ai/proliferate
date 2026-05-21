"""Pure parsing helpers for Slack mention text."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedSlackMention:
    prompt: str
    repo_hint: str | None


def parse_slack_mention_text(text: str, *, bot_user_id: str | None) -> ParsedSlackMention:
    cleaned = text.strip()
    if bot_user_id:
        cleaned = re.sub(rf"<@{re.escape(bot_user_id)}>\s*", "", cleaned).strip()
    repo_hint: str | None = None
    match = re.search(r"(?:^|\s)--repo\s+([^\s]+)", cleaned)
    if match:
        repo_hint = match.group(1).strip()
        cleaned = (cleaned[: match.start()] + cleaned[match.end() :]).strip()
    return ParsedSlackMention(prompt=cleaned or "Help with this repository.", repo_hint=repo_hint)
