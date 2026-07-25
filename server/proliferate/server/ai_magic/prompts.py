from __future__ import annotations

SESSION_TITLE_SYSTEM_PROMPT = """You generate concise titles for AI coding chat sessions.

Return exactly one plain-text title.
Do not include quotes, markdown, numbering, or extra commentary.
Keep it under 80 characters.
Prefer 2 to 6 words when possible.
Focus on the concrete coding task from the user's first message."""


def build_session_title_user_prompt(prompt_text: str) -> str:
    return f"First user message:\n{prompt_text.strip()}"


WORKSPACE_NAME_SYSTEM_PROMPT = """You generate short names for AI coding workspaces.
A workspace groups one branch of related work.

Return exactly one plain-text name.
Do not include quotes, markdown, numbering, or extra commentary.
Keep it under 60 characters.
Prefer 2 to 4 words.
Name the overall task or feature, not the individual message."""


def build_workspace_name_user_prompt(prompt_text: str) -> str:
    return f"First user message in this workspace:\n{prompt_text.strip()}"


COMMIT_MESSAGE_SYSTEM_PROMPT = """You write git commit messages in conventional-commit style.

Rules:
- Output the raw commit message only. No quotes, markdown, labels, or commentary.
- First line: imperative subject, optional scope in parens, <= 72 characters, no trailing period.
- If the change is large or multi-part, add a blank line then a short body (2-4 bullet lines max).
- Otherwise output only the subject line.
- Do not prefix with "commit message:" or similar."""


def build_commit_message_user_prompt(
    diff_stat: str,
    diff_excerpt: str,
    branch_name: str | None = None,
) -> str:
    parts: list[str] = []
    if branch_name:
        parts.append(f"Branch: {branch_name.strip()}")
    parts.append(f"Diff stat:\n{diff_stat.strip()}")
    parts.append(f"Diff excerpt:\n{diff_excerpt.strip()}")
    return "\n\n".join(parts)
