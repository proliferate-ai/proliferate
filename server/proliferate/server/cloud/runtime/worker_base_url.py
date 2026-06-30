"""Worker callback URL resolution for managed cloud runtimes."""

from __future__ import annotations

from urllib.parse import urlparse

from proliferate.config import settings
from proliferate.server.cloud.errors import CloudApiError

_LOCAL_CLOUD_BASE_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _is_local_cloud_base_url(value: str) -> bool:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    return hostname in _LOCAL_CLOUD_BASE_HOSTS or hostname.endswith(".localhost")


def cloud_worker_base_url() -> str:
    local_candidates: list[tuple[str, str]] = []
    for source, candidate in (
        ("CLOUD_WORKER_BASE_URL", settings.cloud_worker_base_url),
        ("API_BASE_URL", settings.api_base_url),
        ("CLOUD_MCP_OAUTH_CALLBACK_BASE_URL", settings.cloud_mcp_oauth_callback_base_url),
        (
            "CLOUD_MCP_OAUTH_CALLBACK_FALLBACK_BASE_URL",
            settings.cloud_mcp_oauth_callback_fallback_base_url,
        ),
    ):
        normalized = candidate.strip().rstrip("/")
        if not normalized:
            continue
        if _is_local_cloud_base_url(normalized):
            local_candidates.append((source, normalized))
            continue
        return normalized

    detail = (
        " Managed cloud provisioning is currently configured only with local callback URLs: "
        + ", ".join(f"{source}={value}" for source, value in local_candidates)
        + "."
        if local_candidates
        else ""
    )
    raise CloudApiError(
        "cloud_worker_base_url_required",
        "Managed cloud worker enrollment requires CLOUD_WORKER_BASE_URL to be a public URL "
        "reachable from the sandbox. Start an HTTPS tunnel to this server and set "
        "CLOUD_WORKER_BASE_URL to that tunnel URL." + detail,
        status_code=400,
    )
