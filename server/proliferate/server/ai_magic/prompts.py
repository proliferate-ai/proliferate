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


GIT_COMMIT_MESSAGE_SYSTEM_PROMPT = """You generate conventional commit messages for git commits.

Return exactly one plain-text commit message.
Do not include quotes, markdown, backticks, or extra commentary.
Use conventional commit format: type(scope): subject
Keep the subject line under 72 characters.
Focus on what changed and why, not implementation details."""


def build_git_commit_message_user_prompt(prompt_text: str, instructions: str | None) -> str:
    base = f"Changes being committed:\n{prompt_text.strip()}"
    if instructions and instructions.strip():
        base += f"\n\nUser instructions:\n{instructions.strip()}"
    return base


GIT_PR_SYSTEM_PROMPT = """You generate pull request titles and descriptions.

Return a JSON object with "title" and "body" fields.
Title: crisp summary under 72 characters, no conventional commit prefix needed.
Body: short structured markdown (2-4 bullet points or paragraphs max).
Focus on what changed and why. Do not include implementation details unless critical.
Do not include quotes around the JSON or extra commentary."""


def build_git_pr_user_prompt(prompt_text: str, instructions: str | None) -> str:
    base = f"Changes in this pull request:\n{prompt_text.strip()}"
    if instructions and instructions.strip():
        base += f"\n\nUser instructions:\n{instructions.strip()}"
    return base
