from __future__ import annotations

import re
from collections import deque
from threading import Lock
from time import monotonic
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.ai_magic import (
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
    SESSION_TITLE_SYSTEM_PROMPT,
    WORKSPACE_NAME_SYSTEM_PROMPT,
    build_session_title_user_prompt,
    build_workspace_name_user_prompt,
)

_session_title_windows: dict[str, deque[float]] = {}
_workspace_name_windows: dict[str, deque[float]] = {}
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
