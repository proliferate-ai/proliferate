from __future__ import annotations

import os
from dataclasses import dataclass

from proliferate.config import settings
from proliferate.integrations.mcp_oauth import AuthorizationServerMetadata
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.domain.catalog_schema import IntegrationAuthMode


@dataclass(frozen=True)
class StaticOAuthClientConfig:
    client_id: str
    client_secret: str | None
    token_endpoint_auth_method: str | None


def static_oauth_client_config(mode: IntegrationAuthMode) -> StaticOAuthClientConfig:
    if not mode.client_id_env:
        raise CloudApiError(
            "missing_static_oauth_client",
            "This deployment is missing static OAuth client configuration.",
            status_code=409,
        )
    client_id = _env_or_settings(mode.client_id_env)
    client_secret = _env_or_settings(mode.client_secret_env) if mode.client_secret_env else None
    token_method = (
        _env_or_settings(mode.token_endpoint_auth_method_env)
        if mode.token_endpoint_auth_method_env
        else None
    )
    if not client_id:
        raise CloudApiError(
            "missing_static_oauth_client",
            "This deployment is missing static OAuth client configuration.",
            status_code=409,
        )
    return StaticOAuthClientConfig(
        client_id=client_id,
        client_secret=client_secret or None,
        token_endpoint_auth_method=token_method or None,
    )


def choose_oauth_mode(
    modes: tuple[IntegrationAuthMode, ...],
    *,
    requested_kind: str | None,
) -> IntegrationAuthMode:
    oauth_modes = tuple(mode for mode in modes if mode.kind == "oauth2")
    if not oauth_modes:
        raise CloudApiError(
            "integration_oauth_unavailable",
            "This integration does not support OAuth.",
            status_code=409,
        )
    if requested_kind is None:
        return oauth_modes[0]
    for mode in oauth_modes:
        if mode.client_strategy == requested_kind:
            return mode
    raise CloudApiError(
        "integration_oauth_unavailable",
        "This integration does not support the requested OAuth mode.",
        status_code=409,
    )


def choose_custom_oauth_strategy(metadata: AuthorizationServerMetadata) -> str:
    if metadata.registration_endpoint:
        return "dcr"
    if metadata.client_id_metadata_document_supported:
        return "client_metadata_document"
    raise CloudApiError(
        "dynamic_oauth_required",
        "Custom MCP integrations must support Dynamic Client Registration "
        "or Client ID Metadata Documents.",
        status_code=400,
    )


def _env_or_settings(name: str | None) -> str | None:
    if not name:
        return None
    env_value = os.environ.get(name)
    if env_value:
        return env_value
    attr = name.lower()
    if hasattr(settings, attr):
        value = getattr(settings, attr)
        return value if isinstance(value, str) else None
    aliases = {
        "GOOGLE_WORKSPACE_MCP_CLIENT_ID": "cloud_mcp_google_workspace_oauth_client_id",
        "GOOGLE_WORKSPACE_MCP_CLIENT_SECRET": "cloud_mcp_google_workspace_oauth_client_secret",
    }
    alias = aliases.get(name)
    if alias and hasattr(settings, alias):
        value = getattr(settings, alias)
        return value if isinstance(value, str) else None
    return None
