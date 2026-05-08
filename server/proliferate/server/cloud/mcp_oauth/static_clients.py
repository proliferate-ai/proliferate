from __future__ import annotations

from dataclasses import dataclass

from proliferate.config import settings
from proliferate.constants.cloud_mcp import SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS


@dataclass(frozen=True)
class StaticOAuthClientConfig:
    client_id: str
    client_secret: str | None
    token_endpoint_auth_method: str


def get_static_oauth_client_config(entry_id: str) -> StaticOAuthClientConfig | None:
    if entry_id != "slack":
        return None
    if not settings.cloud_mcp_slack_enabled:
        return None
    client_id = settings.cloud_mcp_slack_client_id.strip()
    if not client_id:
        return None
    auth_method = settings.cloud_mcp_slack_token_endpoint_auth_method.strip()
    if auth_method not in SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS:
        return None
    client_secret = settings.cloud_mcp_slack_client_secret.strip() or None
    if not client_secret:
        return None
    return StaticOAuthClientConfig(
        client_id=client_id,
        client_secret=client_secret,
        token_endpoint_auth_method=auth_method,
    )
