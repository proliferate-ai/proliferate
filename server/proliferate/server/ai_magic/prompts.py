from __future__ import annotations

SESSION_TITLE_SYSTEM_PROMPT = """You generate concise titles for AI coding chat sessions.

Return exactly one plain-text title.
Do not include quotes, markdown, numbering, or extra commentary.
Keep it under 80 characters.
Prefer 2 to 6 words when possible.
Focus on the concrete coding task from the user's first message."""


def build_session_title_user_prompt(prompt_text: str) -> str:
    return f"First user message:\n{prompt_text.strip()}"


WORKSPACE_NAME_SYSTEM_PROMPT = """You generate short names for AI coding workspaces (a branch of work).

Return exactly one plain-text name.
Do not include quotes, markdown, numbering, or extra commentary.
Keep it under 60 characters.
Prefer 2 to 4 words.
Name the overall task or feature, not the individual message."""


def build_workspace_name_user_prompt(prompt_text: str) -> str:
    return f"First user message in this workspace:\n{prompt_text.strip()}"
