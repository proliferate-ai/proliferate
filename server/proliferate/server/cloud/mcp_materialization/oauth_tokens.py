from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from proliferate.config import settings
from proliferate.db.store.cloud_mcp.auth import (
    load_connection_auth_standalone,
    mark_connection_auth_status_if_version_standalone,
    update_connection_auth_if_version_standalone,
)
from proliferate.db.store.cloud_mcp.oauth_clients import get_oauth_client_standalone
from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord, CloudMcpConnectionRecord
from proliferate.integrations.mcp_oauth import McpOAuthProviderError, refresh_token
from proliferate.server.cloud.mcp_oauth.domain.flow_rules import oauth_redirect_uri
from proliferate.utils.crypto import decrypt_json, decrypt_text, encrypt_json

_OAUTH_REFRESH_SKEW = timedelta(seconds=60)
_oauth_refresh_locks: dict[UUID, asyncio.Lock] = {}
_oauth_refresh_locks_guard = asyncio.Lock()


def _redirect_uri() -> str:
    return oauth_redirect_uri(
        configured_callback_base_url=settings.cloud_mcp_oauth_callback_base_url,
        api_base_url=settings.api_base_url,
        fallback_callback_base_url=settings.cloud_mcp_oauth_callback_fallback_base_url,
    )


async def ready_oauth_access_token(record: CloudMcpConnectionRecord) -> str | None:
    lock = await _oauth_refresh_lock(record.id)
    async with lock:
        return await _ready_oauth_access_token_locked(record)


async def _oauth_refresh_lock(connection_db_id: UUID) -> asyncio.Lock:
    async with _oauth_refresh_locks_guard:
        lock = _oauth_refresh_locks.get(connection_db_id)
        if lock is None:
            lock = asyncio.Lock()
            _oauth_refresh_locks[connection_db_id] = lock
        return lock


async def _ready_oauth_access_token_locked(
    record: CloudMcpConnectionRecord,
) -> str | None:
    auth = await load_connection_auth_standalone(connection_db_id=record.id)
    if auth is None:
        auth = record.auth
    if auth is None or auth.auth_status != "ready" or not auth.payload_ciphertext:
        return None
    payload = decrypt_json(auth.payload_ciphertext)
    access_token = payload.get("accessToken")
    if not isinstance(access_token, str) or not access_token:
        return None
    expires_at = _parse_expires_at(payload.get("expiresAt"))
    if expires_at is None or expires_at > datetime.now(UTC) + _OAUTH_REFRESH_SKEW:
        return access_token

    refresh_token_value = payload.get("refreshToken")
    token_endpoint = payload.get("tokenEndpoint")
    client_id = payload.get("clientId")
    resource = payload.get("resource")
    if not (
        isinstance(refresh_token_value, str)
        and refresh_token_value
        and isinstance(token_endpoint, str)
        and token_endpoint
        and isinstance(client_id, str)
        and client_id
        and isinstance(resource, str)
        and resource
    ):
        marked = await mark_connection_auth_status_if_version_standalone(
            connection_db_id=record.id,
            expected_auth_version=auth.auth_version,
            auth_kind="oauth",
            auth_status="needs_reconnect",
            last_error_code="missing_refresh_token",
        )
        if marked is None:
            return await _latest_ready_oauth_access_token(record)
        return None

    issuer = payload.get("issuer")
    redirect_uri = payload.get("redirectUri") or _redirect_uri()
    oauth_client = (
        await get_oauth_client_standalone(
            issuer=issuer,
            redirect_uri=redirect_uri,
            catalog_entry_id=record.catalog_entry_id,
        )
        if isinstance(issuer, str) and isinstance(redirect_uri, str)
        else None
    )
    client_secret = (
        decrypt_text(oauth_client.client_secret_ciphertext)
        if oauth_client and oauth_client.client_secret_ciphertext
        else None
    )
    try:
        refreshed = await refresh_token(
            token_endpoint=token_endpoint,
            client_id=client_id,
            refresh_token_value=refresh_token_value,
            resource=resource,
            client_secret=client_secret,
            token_endpoint_auth_method=(
                oauth_client.token_endpoint_auth_method if oauth_client else None
            ),
        )
    except McpOAuthProviderError as exc:
        marked = await mark_connection_auth_status_if_version_standalone(
            connection_db_id=record.id,
            expected_auth_version=auth.auth_version,
            auth_kind="oauth",
            auth_status="needs_reconnect" if exc.code == "invalid_grant" else "error",
            last_error_code=exc.code,
        )
        if marked is None:
            return await _latest_ready_oauth_access_token(record)
        return None

    next_payload = {
        **payload,
        "accessToken": refreshed.access_token,
        "refreshToken": refreshed.refresh_token or refresh_token_value,
        "expiresAt": refreshed.expires_at.isoformat() if refreshed.expires_at else None,
        "scopes": list(refreshed.scopes) or payload.get("scopes") or [],
    }
    updated = await update_connection_auth_if_version_standalone(
        connection_db_id=record.id,
        expected_auth_version=auth.auth_version,
        auth_kind="oauth",
        auth_status="ready",
        payload_ciphertext=encrypt_json(next_payload),
        payload_format="oauth-bundle-v1",
        token_expires_at=refreshed.expires_at,
    )
    if updated is None:
        return await _latest_ready_oauth_access_token(record)
    return refreshed.access_token


async def _latest_ready_oauth_access_token(record: CloudMcpConnectionRecord) -> str | None:
    auth = await load_connection_auth_standalone(connection_db_id=record.id)
    if auth is None:
        return None
    return _ready_access_token_from_auth(auth)


def _ready_access_token_from_auth(auth: CloudMcpAuthRecord) -> str | None:
    if auth.auth_status != "ready" or not auth.payload_ciphertext:
        return None
    payload = decrypt_json(auth.payload_ciphertext)
    access_token = payload.get("accessToken")
    if not isinstance(access_token, str) or not access_token:
        return None
    expires_at = _parse_expires_at(payload.get("expiresAt"))
    if expires_at is not None and expires_at <= datetime.now(UTC) + _OAUTH_REFRESH_SKEW:
        return None
    return access_token


def _parse_expires_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
