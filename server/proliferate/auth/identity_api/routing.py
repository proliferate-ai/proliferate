"""Route helpers for product identity auth."""

from __future__ import annotations

from urllib.parse import urlparse

from proliferate.config import settings


def api_path_prefix() -> str:
    raw_prefix = settings.api_path_prefix.strip()
    if not raw_prefix or raw_prefix == "/":
        return ""
    if not raw_prefix.startswith("/"):
        raw_prefix = f"/{raw_prefix}"
    return raw_prefix.rstrip("/")


def auth_route_path(path: str) -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{api_path_prefix()}{normalized_path}"


def auth_route_path_for_base(path: str, *, base_url: str) -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    prefix = api_path_prefix()
    if not prefix:
        return normalized_path

    base_path = urlparse(base_url).path.rstrip("/")
    if base_path == prefix or base_path.endswith(prefix):
        return normalized_path
    return f"{prefix}{normalized_path}"
