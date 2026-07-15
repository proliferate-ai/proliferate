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


COMMIT_MESSAGE_SYSTEM_PROMPT = """You generate git commit subject lines from a diff.

Return exactly one plain-text commit subject line.
Do not include quotes, markdown, or a trailing period.
Keep it under 72 characters.
Use imperative mood (e.g. "add", "fix", "refactor", not "added" or "adds").
Prefix the subject with a conventional-commit type (feat, fix, refactor, docs, chore, test)
followed by a colon and a space, e.g. "fix: handle null session id".
Infer an optional scope in parentheses after the type from the diff's file paths when it is
obvious, e.g. "feat(auth): add token refresh".
Summarize the overall intent of the change, not a list of touched files.
If repository instructions are provided, follow them when they do not conflict with the rules
above."""


def build_commit_message_user_prompt(
    diff_text: str,
    instructions: str | None = None,
    branch_name: str | None = None,
) -> str:
    parts: list[str] = []
    cleaned_instructions = (instructions or "").strip()
    if cleaned_instructions:
        parts.append(f"Repository instructions:\n{cleaned_instructions}")
    cleaned_branch_name = (branch_name or "").strip()
    if cleaned_branch_name:
        parts.append(f"Branch: {cleaned_branch_name}")
    parts.append(f"Diff:\n{diff_text}")
    return "\n\n".join(parts)
