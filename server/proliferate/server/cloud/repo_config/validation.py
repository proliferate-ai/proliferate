"""Validation helpers for repo-scoped cloud configuration."""

from __future__ import annotations

import re

from proliferate.constants.cloud import (
    ANYHARNESS_RESERVED_ENV_PREFIX,
    PROLIFERATE_RESERVED_ENV_PREFIX,
    RESERVED_CLOUD_REPO_ENV_VARS,
)
from proliferate.server.cloud.errors import CloudApiError

_MAX_TRACKED_FILE_BYTES = 1_048_576
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def normalize_repo_file_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized:
        raise CloudApiError("invalid_repo_file_path", "File path cannot be empty.", status_code=400)
    if normalized.startswith("/"):
        raise CloudApiError(
            "invalid_repo_file_path",
            "Tracked files must use repo-relative paths.",
            status_code=400,
        )
    segments = normalized.split("/")
    for segment in segments:
        if not segment or segment in {".", ".."}:
            raise CloudApiError(
                "invalid_repo_file_path",
                "Tracked files must use normalized repo-relative paths.",
                status_code=400,
            )
        if segment == ".git":
            raise CloudApiError(
                "invalid_repo_file_path",
                "Tracked files cannot target the .git directory.",
                status_code=400,
            )
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in segment):
            raise CloudApiError(
                "invalid_repo_file_path",
                "Tracked file paths cannot contain control characters.",
                status_code=400,
            )
    return "/".join(segments)


def validate_tracked_file_content(content: str) -> None:
    if len(content.encode("utf-8")) > _MAX_TRACKED_FILE_BYTES:
        raise CloudApiError(
            "repo_file_too_large",
            "Tracked files must be 1 MiB or smaller.",
            status_code=400,
        )


def normalize_env_vars(env_vars: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in env_vars.items():
        env_key = key.strip()
        if not _ENV_KEY_RE.match(env_key):
            raise CloudApiError(
                "invalid_repo_env_var",
                f"'{key}' is not a valid environment variable name.",
                status_code=400,
            )
        if env_key.startswith(ANYHARNESS_RESERVED_ENV_PREFIX) or env_key.startswith(
            PROLIFERATE_RESERVED_ENV_PREFIX
        ):
            raise CloudApiError(
                "reserved_repo_env_var",
                f"'{env_key}' is reserved by the runtime.",
                status_code=400,
            )
        if env_key in RESERVED_CLOUD_REPO_ENV_VARS:
            raise CloudApiError(
                "reserved_repo_env_var",
                f"'{env_key}' is reserved for managed agent credentials.",
                status_code=400,
            )
        normalized[env_key] = value
    return normalized
