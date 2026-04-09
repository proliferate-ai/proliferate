from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass
from threading import Lock
from time import monotonic

from proliferate.config import settings
from proliferate.constants.ai_magic import (
    SESSION_TITLE_MAX_PROMPT_CHARS,
    SESSION_TITLE_MAX_TITLE_CHARS,
    SESSION_TITLE_RATE_LIMIT_REQUESTS,
    SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS,
)
from proliferate.db.models.auth import User
from proliferate.integrations.anthropic import (
    AnthropicIntegrationError,
    generate_message_text,
)
from proliferate.server.ai_magic.prompts import (
    SESSION_TITLE_SYSTEM_PROMPT,
    build_session_title_user_prompt,
)

_session_title_windows: dict[str, deque[float]] = {}
_session_title_windows_lock = Lock()


@dataclass(slots=True)
class AiMagicServiceError(Exception):
    status_code: int
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


def _enforce_session_title_rate_limit(user_id: str) -> None:
    request_limit = SESSION_TITLE_RATE_LIMIT_REQUESTS
    window_seconds = SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS
    now = monotonic()
    cutoff = now - window_seconds

    with _session_title_windows_lock:
        window = _session_title_windows.setdefault(user_id, deque())
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= request_limit:
            raise AiMagicServiceError(
                status_code=429,
                code="ai_magic_rate_limited",
                message="Too many AI magic requests. Try again later.",
            )
        window.append(now)


def _normalize_title(raw_title: str) -> str:
    title = " ".join(raw_title.strip().split())
    if len(title) >= 2 and title[0] == title[-1] and title[0] in {"'", '"', "`"}:
        title = title[1:-1].strip()
    title = title.splitlines()[0].strip(" .:-")
    title = re.sub(r"^(?:#+\s*|[-*]\s+|\d+[.)]\s+)", "", title).strip()
    if len(title) > SESSION_TITLE_MAX_TITLE_CHARS:
        title = title[:SESSION_TITLE_MAX_TITLE_CHARS].rsplit(" ", 1)[0].strip()
    return title


async def generate_session_title(user: User, *, prompt_text: str) -> str:
    api_key = settings.anthropic_api_key.strip()
    if not api_key:
        raise AiMagicServiceError(
            status_code=503,
            code="ai_magic_unavailable",
            message="AI magic is not configured for this environment.",
        )

    cleaned_prompt = prompt_text.strip()
    if not cleaned_prompt:
        raise AiMagicServiceError(
            status_code=400,
            code="session_title_prompt_empty",
            message="Prompt text cannot be empty.",
        )
    if len(cleaned_prompt) > SESSION_TITLE_MAX_PROMPT_CHARS:
        raise AiMagicServiceError(
            status_code=400,
            code="session_title_prompt_too_long",
            message="Prompt text is too long to title.",
        )

    _enforce_session_title_rate_limit(str(user.id))

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
        raise AiMagicServiceError(
            status_code=502,
            code="session_title_generation_failed",
            message="Could not generate a session title right now.",
        ) from exc

    title = _normalize_title(raw_title)
    if not title:
        raise AiMagicServiceError(
            status_code=502,
            code="session_title_empty",
            message="Generated session title was empty.",
        )
    return title
