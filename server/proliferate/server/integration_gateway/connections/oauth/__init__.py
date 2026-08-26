"""OAuth authorization-flow lifecycle for cloud integrations."""

from __future__ import annotations

from proliferate.server.integration_gateway.connections.oauth.clients import resolve_oauth_client
from proliferate.server.integration_gateway.connections.oauth.service import (
    OAUTH_CALLBACK_PATH,
    OAuthCallbackResult,
    OAuthFlowStart,
    OAuthFlowStatus,
    cancel_oauth_flow,
    complete_oauth_callback,
    get_oauth_flow_status,
    start_oauth_flow,
)
from proliferate.server.integration_gateway.connections.oauth.surfaces import (
    OAUTH_WEB_COMPLETION_PATH,
)

__all__ = [
    "OAUTH_CALLBACK_PATH",
    "OAUTH_WEB_COMPLETION_PATH",
    "OAuthCallbackResult",
    "OAuthFlowStart",
    "OAuthFlowStatus",
    "cancel_oauth_flow",
    "complete_oauth_callback",
    "get_oauth_flow_status",
    "resolve_oauth_client",
    "start_oauth_flow",
]
