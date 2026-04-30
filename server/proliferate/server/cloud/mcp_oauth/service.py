from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from proliferate.config import settings
from proliferate.db.store.cloud_mcp.auth import upsert_connection_auth
from proliferate.db.store.cloud_mcp.connections import (
    get_user_connection,
    get_user_connection_by_db_id,
)
from proliferate.db.store.cloud_mcp.oauth_clients import (
    delete_oauth_client,
    get_oauth_client,
    upsert_oauth_client,
)
from proliferate.db.store.cloud_mcp.oauth_flows import (
    cancel_oauth_flow_for_user,
    claim_active_oauth_flow_by_state_hash,
    complete_oauth_flow,
    create_oauth_flow_canceling_existing,
    fail_oauth_flow,
    get_oauth_flow_for_user,
)
from proliferate.db.store.cloud_mcp.types import CloudMcpOAuthClientRecord
from proliferate.integrations.mcp_oauth import (
    McpOAuthProviderError,
    build_authorization_url,
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
    exchange_token,
    normalize_resource_url,
    random_urlsafe,
    register_client,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.catalog import (
    build_oauth_server_url,
    get_catalog_entry,
)
from proliferate.server.cloud.mcp_connections.service import _parse_settings
from proliferate.server.cloud.mcp_oauth.models import (
    CloudMcpOAuthCallbackResponse,
    CloudMcpOAuthFlowStatusResponse,
    StartCloudMcpOAuthFlowResponse,
    oauth_flow_start_payload,
    oauth_flow_status_payload,
)
from proliferate.utils.crypto import decrypt_text, encrypt_json, encrypt_text

OAUTH_FLOW_TTL = timedelta(minutes=10)


def _cloud_mcp_enabled_or_raise() -> None:
    if not settings.cloud_mcp_enabled:
        raise CloudApiError("cloud_mcp_disabled", "Cloud MCP is disabled.", status_code=403)


def _state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def _callback_base_url() -> str:
    base = settings.cloud_mcp_oauth_callback_base_url.strip() or settings.api_base_url.strip()
    if not base:
        base = "http://localhost:8000"
    return base.rstrip("/")


def _redirect_uri() -> str:
    return f"{_callback_base_url()}/v1/cloud/mcp/oauth/callback"


async def _get_or_register_client(
    *,
    issuer: str,
    redirect_uri: str,
    catalog_entry_id: str,
    resource: str,
) -> CloudMcpOAuthClientRecord:
    cached = await get_oauth_client(
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=catalog_entry_id,
    )
    if cached is not None:
        return cached

    metadata = await discover_authorization_server_metadata(issuer)
    registered = await register_client(metadata, redirect_uri)
    return await upsert_oauth_client(
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=catalog_entry_id,
        resource=resource,
        client_id=registered.client_id,
        client_secret_ciphertext=(
            encrypt_text(registered.client_secret) if registered.client_secret else None
        ),
        client_secret_expires_at=registered.client_secret_expires_at,
        token_endpoint_auth_method=registered.token_endpoint_auth_method,
        registration_client_uri=registered.registration_client_uri,
        registration_access_token_ciphertext=(
            encrypt_text(registered.registration_access_token)
            if registered.registration_access_token
            else None
        ),
    )


async def start_cloud_mcp_oauth_flow(
    *,
    user_id: UUID,
    connection_id: str,
) -> StartCloudMcpOAuthFlowResponse:
    _cloud_mcp_enabled_or_raise()
    connection = await get_user_connection(user_id, connection_id)
    if connection is None:
        raise CloudApiError("not_found", "MCP connection was not found.", status_code=404)
    entry = get_catalog_entry(connection.catalog_entry_id)
    if entry is None or entry.auth_kind != "oauth":
        raise CloudApiError(
            "invalid_payload",
            "MCP connection does not use OAuth.",
            status_code=400,
        )
    server_url = build_oauth_server_url(entry, _parse_settings(connection.settings_json))
    try:
        protected = await discover_protected_resource_metadata(server_url)
        issuer = protected.authorization_servers[0]
        auth_metadata = await discover_authorization_server_metadata(issuer)
        resource = normalize_resource_url(protected.resource or server_url)
        redirect_uri = _redirect_uri()
        client = await _get_or_register_client(
            issuer=auth_metadata.issuer,
            redirect_uri=redirect_uri,
            catalog_entry_id=entry.id,
            resource=resource,
        )
        state = random_urlsafe(32)
        verifier = random_urlsafe(48)
        authorization_url = build_authorization_url(
            metadata=auth_metadata,
            client_id=client.client_id,
            redirect_uri=redirect_uri,
            state=state,
            verifier=verifier,
            resource=resource,
            scope=protected.challenged_scope,
        )
    except McpOAuthProviderError as exc:
        raise CloudApiError(
            exc.code,
            "Could not start OAuth for this connector.",
            status_code=400,
        ) from exc

    flow = await create_oauth_flow_canceling_existing(
        connection_db_id=connection.id,
        user_id=user_id,
        state_hash=_state_hash(state),
        code_verifier_ciphertext=encrypt_text(verifier),
        issuer=auth_metadata.issuer,
        resource=resource,
        client_id=client.client_id,
        token_endpoint=auth_metadata.token_endpoint,
        requested_scopes=json.dumps(
            protected.challenged_scope.split() if protected.challenged_scope else []
        ),
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        expires_at=datetime.now(UTC) + OAUTH_FLOW_TTL,
    )
    return oauth_flow_start_payload(flow)


async def get_cloud_mcp_oauth_flow_status(
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowStatusResponse:
    flow = await get_oauth_flow_for_user(user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    status = flow
    if flow.status == "active" and flow.expires_at <= datetime.now(UTC):
        status = await fail_oauth_flow(flow_id=flow.id, failure_code="expired") or flow
    return oauth_flow_status_payload(status, include_authorization_url=status.status == "active")


async def cancel_cloud_mcp_oauth_flow(
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowStatusResponse:
    flow = await cancel_oauth_flow_for_user(user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    return oauth_flow_status_payload(flow, include_authorization_url=False)


async def complete_cloud_mcp_oauth_callback(
    *,
    state: str,
    code: str,
) -> CloudMcpOAuthCallbackResponse:
    _cloud_mcp_enabled_or_raise()
    hashed = _state_hash(state)
    flow = await claim_active_oauth_flow_by_state_hash(hashed)
    if flow is None:
        return CloudMcpOAuthCallbackResponse(ok=False, status="failed")
    if flow.expires_at <= datetime.now(UTC):
        await fail_oauth_flow(flow_id=flow.id, failure_code="expired")
        return CloudMcpOAuthCallbackResponse(ok=False, status="expired")
    if not flow.token_endpoint or not flow.resource:
        await fail_oauth_flow(flow_id=flow.id, failure_code="invalid_flow")
        return CloudMcpOAuthCallbackResponse(ok=False, status="failed")

    try:
        token = await exchange_token(
            token_endpoint=flow.token_endpoint,
            client_id=flow.client_id,
            code=code,
            code_verifier=decrypt_text(flow.code_verifier_ciphertext),
            redirect_uri=flow.redirect_uri,
            resource=flow.resource,
        )
    except McpOAuthProviderError as exc:
        if exc.code == "invalid_client" and flow.issuer:
            connection = await get_user_connection_by_db_id(flow.user_id, flow.connection_db_id)
            await delete_oauth_client(
                issuer=flow.issuer,
                redirect_uri=flow.redirect_uri,
                catalog_entry_id=connection.catalog_entry_id if connection else "",
            )
        await fail_oauth_flow(flow_id=flow.id, failure_code=exc.code)
        return CloudMcpOAuthCallbackResponse(ok=False, status="failed")

    await upsert_connection_auth(
        connection_db_id=flow.connection_db_id,
        auth_kind="oauth",
        auth_status="ready",
        payload_ciphertext=encrypt_json(
            {
                "issuer": flow.issuer,
                "resource": flow.resource,
                "clientId": flow.client_id,
                "accessToken": token.access_token,
                "refreshToken": token.refresh_token,
                "expiresAt": token.expires_at.isoformat() if token.expires_at else None,
                "scopes": list(token.scopes),
                "tokenEndpoint": flow.token_endpoint,
            }
        ),
        payload_format="oauth-bundle-v1",
        token_expires_at=token.expires_at,
    )
    await complete_oauth_flow(flow_id=flow.id)
    return CloudMcpOAuthCallbackResponse(ok=True, status="completed")
