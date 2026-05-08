from __future__ import annotations

import hashlib
import json
from datetime import datetime

from proliferate.constants.cloud_mcp import CLOUD_MCP_OAUTH_CALLBACK_PATH


def oauth_state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def resolve_callback_base_url(
    *,
    configured_callback_base_url: str,
    api_base_url: str,
) -> str:
    base = configured_callback_base_url.strip() or api_base_url.strip()
    if not base:
        base = "http://localhost:8000"
    return base.rstrip("/")


def oauth_redirect_uri(
    *,
    configured_callback_base_url: str,
    api_base_url: str,
) -> str:
    base_url = resolve_callback_base_url(
        configured_callback_base_url=configured_callback_base_url,
        api_base_url=api_base_url,
    )
    return f"{base_url}{CLOUD_MCP_OAUTH_CALLBACK_PATH}"


def oauth_flow_is_expired(*, expires_at: datetime, now: datetime) -> bool:
    return expires_at <= now


def oauth_status_includes_authorization_url(status: str) -> bool:
    return status == "active"


def oauth_requested_scopes_json(challenged_scope: str | None) -> str:
    return json.dumps(challenged_scope.split() if challenged_scope else [])


def should_drop_cached_oauth_client_on_token_error(error_code: str) -> bool:
    return error_code == "invalid_client"


def build_oauth_auth_payload(
    *,
    issuer: str | None,
    resource: str | None,
    client_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime | None,
    scopes: tuple[str, ...],
    token_endpoint: str | None,
    redirect_uri: str,
) -> dict[str, object]:
    return {
        "issuer": issuer,
        "resource": resource,
        "clientId": client_id,
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": expires_at.isoformat() if expires_at else None,
        "scopes": list(scopes),
        "tokenEndpoint": token_endpoint,
        "redirectUri": redirect_uri,
    }
