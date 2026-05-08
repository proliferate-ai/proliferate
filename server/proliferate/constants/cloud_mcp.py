"""Cloud MCP product/protocol constants."""

from __future__ import annotations

from datetime import timedelta

CLOUD_MCP_CONNECTION_ID_PATTERN = r"^[A-Za-z0-9_.:-]{1,255}$"
CLOUD_MCP_CONNECTION_ID_ERROR = "MCP connection id must be 1-255 URL-safe characters."
CLOUD_MCP_SERVER_NAME_MAX_LENGTH = 40
CLOUD_MCP_OAUTH_CALLBACK_PATH = "/v1/cloud/mcp/oauth/callback"
CLOUD_MCP_OAUTH_FLOW_TTL = timedelta(minutes=10)
SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = frozenset(
    {
        "client_secret_post",
        "client_secret_basic",
    }
)
