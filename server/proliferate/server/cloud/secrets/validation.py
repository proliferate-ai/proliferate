"""Validation helpers for cloud secret APIs."""

from __future__ import annotations

import re
from pathlib import PurePosixPath

from proliferate.server.cloud.errors import CloudApiError

_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_BLOCKED_ABSOLUTE_PREFIXES = ("/proc", "/sys", "/dev", "/run/e2b")


def normalize_secret_env_name(name: str) -> str:
    normalized = name.strip()
    if not _ENV_NAME_RE.match(normalized):
        raise CloudApiError(
            "invalid_secret_env_name",
            "Secret environment variable names must use shell-compatible syntax.",
            status_code=400,
        )
    if normalized.startswith("PROLIFERATE_"):
        raise CloudApiError(
            "reserved_secret_env_name",
            "Secret environment variables cannot start with PROLIFERATE_.",
            status_code=400,
        )
    return normalized


def normalize_global_secret_file_path(path: str) -> str:
    normalized = str(PurePosixPath(path.strip()))
    parsed = PurePosixPath(normalized)
    if not normalized.startswith("/"):
        raise CloudApiError(
            "invalid_secret_file_path",
            "Organization and personal secret files must use absolute paths.",
            status_code=400,
        )
    if ".." in parsed.parts:
        raise CloudApiError(
            "invalid_secret_file_path",
            "Secret file paths cannot contain '..'.",
            status_code=400,
        )
    if normalized == "/" or any(
        normalized == prefix or normalized.startswith(f"{prefix}/")
        for prefix in _BLOCKED_ABSOLUTE_PREFIXES
    ):
        raise CloudApiError(
            "blocked_secret_file_path",
            "Secret files cannot be written under protected system paths.",
            status_code=400,
        )
    return normalized


def normalize_workspace_secret_file_path(path: str) -> str:
    raw = path.strip()
    normalized = str(PurePosixPath(raw))
    parsed = PurePosixPath(normalized)
    if raw.startswith("/") or normalized.startswith("/"):
        raise CloudApiError(
            "invalid_workspace_secret_file_path",
            "Workspace secret files must use paths relative to the repo root.",
            status_code=400,
        )
    if normalized in {"", "."} or ".." in parsed.parts:
        raise CloudApiError(
            "invalid_workspace_secret_file_path",
            "Workspace secret file paths must stay inside the repo.",
            status_code=400,
        )
    return normalized


def validate_secret_value(value: str, *, field_name: str = "secret") -> str:
    if value == "":
        raise CloudApiError(
            "empty_secret_value",
            f"{field_name} cannot be empty.",
            status_code=400,
        )
    byte_size = len(value.encode("utf-8"))
    if byte_size > 256 * 1024:
        raise CloudApiError(
            "secret_value_too_large",
            f"{field_name} must be 256 KiB or smaller.",
            status_code=400,
        )
    return value
