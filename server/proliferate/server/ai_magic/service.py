from __future__ import annotations

import json
import re
from collections import deque
from threading import Lock
from time import monotonic
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.ai_magic import (
    GIT_PUBLISH_MAX_COMMIT_MESSAGE_CHARS,
    GIT_PUBLISH_MAX_INSTRUCTIONS_CHARS,
    GIT_PUBLISH_MAX_PR_BODY_CHARS,
    GIT_PUBLISH_MAX_PR_TITLE_CHARS,
    GIT_PUBLISH_MAX_PROMPT_CHARS,
    GIT_PUBLISH_RATE_LIMIT_REQUESTS,
    GIT_PUBLISH_RATE_LIMIT_WINDOW_SECONDS,
    SESSION_TITLE_MAX_PROMPT_CHARS,
    SESSION_TITLE_MAX_TITLE_CHARS,
    SESSION_TITLE_RATE_LIMIT_REQUESTS,
    SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS,
    WORKSPACE_NAME_MAX_NAME_CHARS,
    WORKSPACE_NAME_MAX_PROMPT_CHARS,
    WORKSPACE_NAME_RATE_LIMIT_REQUESTS,
    WORKSPACE_NAME_RATE_LIMIT_WINDOW_SECONDS,
)
from proliferate.integrations.anthropic import (
    AnthropicIntegrationError,
    generate_message_text,
)
from proliferate.server.ai_magic.errors import AiMagicError
from proliferate.server.ai_magic.prompts import (
    GIT_COMMIT_MESSAGE_SYSTEM_PROMPT,
    GIT_PR_SYSTEM_PROMPT,
    SESSION_TITLE_SYSTEM_PROMPT,
    WORKSPACE_NAME_SYSTEM_PROMPT,
    build_git_commit_message_user_prompt,
    build_git_pr_user_prompt,
    build_session_title_user_prompt,
    build_workspace_name_user_prompt,
)

_session_title_windows: dict[str, deque[float]] = {}
_workspace_name_windows: dict[str, deque[float]] = {}
_git_publish_windows: dict[str, deque[float]] = {}
_rate_limit_lock = Lock()


def _enforce_rate_limit(
    windows: dict[str, deque[float]],
    user_id: str,
    *,
    request_limit: int,
    window_seconds: int,
) -> None:
    now = monotonic()
    cutoff = now - window_seconds

    with _rate_limit_lock:
        window = windows.setdefault(user_id, deque())
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= request_limit:
            raise AiMagicError(
                status_code=429,
                code="ai_magic_rate_limited",
                message="Too many AI magic requests. Try again later.",
            )
        window.append(now)


def _normalize_title(raw_title: str, *, max_chars: int) -> str:
    title = " ".join(raw_title.strip().split())
    if len(title) >= 2 and title[0] == title[-1] and title[0] in {"'", '"', "`"}:
        title = title[1:-1].strip()
    title = title.splitlines()[0].strip(" .:-")
    title = re.sub(r"^(?:#+\s*|[-*]\s+|\d+[.)]\s+)", "", title).strip()
    if len(title) > max_chars:
        title = title[:max_chars].rsplit(" ", 1)[0].strip()
    return title


async def generate_session_title(user_id: UUID, *, prompt_text: str) -> str:
    api_key = settings.anthropic_api_key.strip()
    if not api_key:
        raise AiMagicError(
            status_code=503,
            code="ai_magic_unavailable",
            message="AI magic is not configured for this environment.",
        )

    cleaned_prompt = prompt_text.strip()
    if not cleaned_prompt:
        raise AiMagicError(
            status_code=400,
            code="session_title_prompt_empty",
            message="Prompt text cannot be empty.",
        )
    if len(cleaned_prompt) > SESSION_TITLE_MAX_PROMPT_CHARS:
        raise AiMagicError(
            status_code=400,
            code="session_title_prompt_too_long",
            message="Prompt text is too long to title.",
        )

    _enforce_rate_limit(
        _session_title_windows,
        str(user_id),
        request_limit=SESSION_TITLE_RATE_LIMIT_REQUESTS,
        window_seconds=SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS,
    )

    try:
        raw_title = await generate_message_text(
            api_key=api_key,
            model=settings.ai_magic_session_title_model,
            system_prompt=SESSION_TITLE_SYSTEM_PROMPT,
            user_prompt=build_session_title_user_prompt(cleaned_prompt),
            max_tokens=64,
            temperature=0.2,
        )
    except AnthropicIntegrationError as exc:
        raise AiMagicError(
            status_code=502,
            code="session_title_generation_failed",
            message="Could not generate a session title right now.",
        ) from exc

    title = _normalize_title(raw_title, max_chars=SESSION_TITLE_MAX_TITLE_CHARS)
    if not title:
        raise AiMagicError(
            status_code=502,
            code="session_title_empty",
            message="Generated session title was empty.",
        )
    return title


async def generate_workspace_name(user_id: UUID, *, prompt_text: str) -> str:
    api_key = settings.anthropic_api_key.strip()
    if not api_key:
        raise AiMagicError(
            status_code=503,
            code="ai_magic_unavailable",
            message="AI magic is not configured for this environment.",
        )

    cleaned_prompt = prompt_text.strip()
    if not cleaned_prompt:
        raise AiMagicError(
            status_code=400,
            code="workspace_name_prompt_empty",
            message="Prompt text cannot be empty.",
        )
    if len(cleaned_prompt) > WORKSPACE_NAME_MAX_PROMPT_CHARS:
        raise AiMagicError(
            status_code=400,
            code="workspace_name_prompt_too_long",
            message="Prompt text is too long to name.",
        )

    _enforce_rate_limit(
        _workspace_name_windows,
        str(user_id),
        request_limit=WORKSPACE_NAME_RATE_LIMIT_REQUESTS,
        window_seconds=WORKSPACE_NAME_RATE_LIMIT_WINDOW_SECONDS,
    )

    try:
        raw_name = await generate_message_text(
            api_key=api_key,
            model=settings.ai_magic_workspace_name_model,
            system_prompt=WORKSPACE_NAME_SYSTEM_PROMPT,
            user_prompt=build_workspace_name_user_prompt(cleaned_prompt),
            max_tokens=64,
            temperature=0.2,
        )
    except AnthropicIntegrationError as exc:
        raise AiMagicError(
            status_code=502,
            code="workspace_name_generation_failed",
            message="Could not generate a workspace name right now.",
        ) from exc

    name = _normalize_title(raw_name, max_chars=WORKSPACE_NAME_MAX_NAME_CHARS)
    if not name:
        raise AiMagicError(
            status_code=502,
            code="workspace_name_empty",
            message="Generated workspace name was empty.",
        )
    return name


async def generate_git_publish(
    user_id: UUID,
    *,
    prompt_text: str,
    mode: str,
    instructions: str | None = None,
) -> dict[str, str | None]:
    api_key = settings.anthropic_api_key.strip()
    if not api_key:
        raise AiMagicError(
            status_code=503,
            code="ai_magic_unavailable",
            message="AI magic is not configured for this environment.",
        )

    cleaned_prompt = prompt_text.strip()
    if not cleaned_prompt:
        raise AiMagicError(
            status_code=400,
            code="git_publish_prompt_empty",
            message="Prompt text cannot be empty.",
        )
    if len(cleaned_prompt) > GIT_PUBLISH_MAX_PROMPT_CHARS:
        raise AiMagicError(
            status_code=400,
            code="git_publish_prompt_too_long",
            message="Prompt text is too long.",
        )

    cleaned_instructions = (instructions or "").strip()
    if len(cleaned_instructions) > GIT_PUBLISH_MAX_INSTRUCTIONS_CHARS:
        raise AiMagicError(
            status_code=400,
            code="git_publish_instructions_too_long",
            message="Instructions are too long.",
        )

    _enforce_rate_limit(
        _git_publish_windows,
        str(user_id),
        request_limit=GIT_PUBLISH_RATE_LIMIT_REQUESTS,
        window_seconds=GIT_PUBLISH_RATE_LIMIT_WINDOW_SECONDS,
    )

    if mode == "commit_message":
        try:
            raw_message = await generate_message_text(
                api_key=api_key,
                model=settings.ai_magic_session_title_model,
                system_prompt=GIT_COMMIT_MESSAGE_SYSTEM_PROMPT,
                user_prompt=build_git_commit_message_user_prompt(
                    cleaned_prompt, cleaned_instructions or None
                ),
                max_tokens=128,
                temperature=0.2,
            )
        except AnthropicIntegrationError as exc:
            raise AiMagicError(
                status_code=502,
                code="git_publish_generation_failed",
                message="Could not generate commit message right now.",
            ) from exc

        message = _normalize_title(raw_message, max_chars=GIT_PUBLISH_MAX_COMMIT_MESSAGE_CHARS)
        if not message:
            raise AiMagicError(
                status_code=502,
                code="git_publish_empty",
                message="Generated commit message was empty.",
            )
        return {"commit_message": message, "pr_title": None, "pr_body": None}

    elif mode == "pull_request":
        try:
            raw_response = await generate_message_text(
                api_key=api_key,
                model=settings.ai_magic_session_title_model,
                system_prompt=GIT_PR_SYSTEM_PROMPT,
                user_prompt=build_git_pr_user_prompt(
                    cleaned_prompt, cleaned_instructions or None
                ),
                max_tokens=256,
                temperature=0.2,
            )
        except AnthropicIntegrationError as exc:
            raise AiMagicError(
                status_code=502,
                code="git_publish_generation_failed",
                message="Could not generate pull request details right now.",
            ) from exc

        try:
            parsed = json.loads(raw_response.strip())
            title = _normalize_title(
                parsed.get("title", ""), max_chars=GIT_PUBLISH_MAX_PR_TITLE_CHARS
            )
            body = (parsed.get("body", "") or "").strip()
            if len(body) > GIT_PUBLISH_MAX_PR_BODY_CHARS:
                body = body[:GIT_PUBLISH_MAX_PR_BODY_CHARS].rsplit("\n", 1)[0].strip()

            if not title:
                raise AiMagicError(
                    status_code=502,
                    code="git_publish_empty",
                    message="Generated PR title was empty.",
                )

            return {"commit_message": None, "pr_title": title, "pr_body": body}
        except (json.JSONDecodeError, KeyError) as exc:
            raise AiMagicError(
                status_code=502,
                code="git_publish_parse_failed",
                message="Could not parse generated pull request details.",
            ) from exc
    else:
        raise AiMagicError(
            status_code=400,
            code="git_publish_invalid_mode",
            message="Mode must be 'commit_message' or 'pull_request'.",
        )
