from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from proliferate.config import settings
from proliferate.db.store.cloud_mcp.auth import (
    load_connection_auth,
    mark_connection_auth_status_if_version,
    update_connection_auth_if_version,
)
from proliferate.db.store.cloud_mcp.connections import list_user_connections
from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord, CloudMcpConnectionRecord
from proliferate.integrations.mcp_oauth import McpOAuthProviderError, refresh_token
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.catalog import (
    CATALOG_VERSION,
    CatalogEntry,
    build_oauth_server_url,
    connector_supports_target,
    get_catalog_entry,
)
from proliferate.server.cloud.mcp_connections.service import _parse_settings
from proliferate.server.cloud.mcp_materialization.models import (
    CloudMcpMaterializationWarningModel,
    LocalStdioCandidateModel,
    MaterializeCloudMcpRequest,
    MaterializeCloudMcpResponse,
    McpNotAppliedReason,
    McpWarningKind,
    SessionMcpBindingSummaryModel,
    SessionMcpHeaderModel,
    SessionMcpHttpServerModel,
    arg_template_payload,
    env_template_payload,
)
from proliferate.utils.crypto import decrypt_json, encrypt_json

_OAUTH_REFRESH_SKEW = timedelta(seconds=60)
_MATERIALIZATION_CONCURRENCY = 5
_MATERIALIZATION_TIMEOUT_SECONDS = 20.0
_oauth_refresh_locks: dict[UUID, asyncio.Lock] = {}
_oauth_refresh_locks_guard = asyncio.Lock()


@dataclass
class _MaterializedRecordResult:
    servers: list[SessionMcpHttpServerModel] = field(default_factory=list)
    summaries: list[SessionMcpBindingSummaryModel] = field(default_factory=list)
    candidates: list[LocalStdioCandidateModel] = field(default_factory=list)
    warnings: list[CloudMcpMaterializationWarningModel] = field(default_factory=list)


def _cloud_mcp_enabled_or_raise() -> None:
    if not settings.cloud_mcp_enabled:
        raise CloudApiError("cloud_mcp_disabled", "Cloud MCP is disabled.", status_code=403)


def _warning(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    kind: McpWarningKind,
) -> CloudMcpMaterializationWarningModel:
    return CloudMcpMaterializationWarningModel(
        connection_id=record.connection_id,
        catalog_entry_id=entry.id,
        connector_name=entry.name,
        server_name=record.server_name,
        kind=kind,
    )


def _summary(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    outcome: Literal["applied", "not_applied"],
    reason: McpNotAppliedReason | None = None,
) -> SessionMcpBindingSummaryModel:
    return SessionMcpBindingSummaryModel(
        id=record.connection_id,
        server_name=record.server_name,
        display_name=entry.name,
        transport=entry.transport,
        outcome=outcome,
        reason=reason,
    )


async def materialize_cloud_mcp_servers(
    *,
    user_id: UUID,
    body: MaterializeCloudMcpRequest,
) -> MaterializeCloudMcpResponse:
    _cloud_mcp_enabled_or_raise()
    records = await list_user_connections(user_id)
    requested = set(body.connection_ids or [])
    if requested:
        records = [record for record in records if record.connection_id in requested]

    semaphore = asyncio.Semaphore(_MATERIALIZATION_CONCURRENCY)
    results = await asyncio.gather(
        *[
            _materialize_record_with_timeout(
                record,
                target_location=body.target_location,
                semaphore=semaphore,
            )
            for record in records
        ]
    )
    servers = [server for result in results for server in result.servers]
    summaries = [summary for result in results for summary in result.summaries]
    candidates = [candidate for result in results for candidate in result.candidates]
    warnings = [warning for result in results for warning in result.warnings]

    return MaterializeCloudMcpResponse(
        catalog_version=CATALOG_VERSION,
        mcp_servers=servers,
        mcp_binding_summaries=summaries,
        local_stdio_candidates=candidates,
        warnings=warnings,
    )


async def _materialize_record_with_timeout(
    record: CloudMcpConnectionRecord,
    *,
    target_location: Literal["local", "cloud"],
    semaphore: asyncio.Semaphore,
) -> _MaterializedRecordResult:
    async with semaphore:
        try:
            return await asyncio.wait_for(
                _materialize_record(record, target_location=target_location),
                timeout=_MATERIALIZATION_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            entry = get_catalog_entry(record.catalog_entry_id)
            if entry is None:
                return _MaterializedRecordResult()
            return _MaterializedRecordResult(
                summaries=[
                    _summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason="resolver_error",
                    )
                ],
                warnings=[_warning(record, entry, "resolver_error")],
            )
        except Exception:
            entry = get_catalog_entry(record.catalog_entry_id)
            if entry is None:
                return _MaterializedRecordResult()
            return _MaterializedRecordResult(
                summaries=[
                    _summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason="resolver_error",
                    )
                ],
                warnings=[_warning(record, entry, "resolver_error")],
            )


async def _materialize_record(
    record: CloudMcpConnectionRecord,
    *,
    target_location: Literal["local", "cloud"],
) -> _MaterializedRecordResult:
    if not record.enabled:
        return _MaterializedRecordResult()
    entry = get_catalog_entry(record.catalog_entry_id)
    if entry is None:
        return _MaterializedRecordResult()
    if not connector_supports_target(entry, target_location):
        return _MaterializedRecordResult(
            summaries=[
                _summary(
                    record,
                    entry,
                    outcome="not_applied",
                    reason="unsupported_target",
                )
            ],
            warnings=[_warning(record, entry, "unsupported_target")],
        )
    if entry.transport == "stdio":
        if target_location != "local":
            return _MaterializedRecordResult()
        return _MaterializedRecordResult(
            candidates=[
                LocalStdioCandidateModel(
                    connection_id=record.connection_id,
                    catalog_entry_id=entry.id,
                    server_name=record.server_name,
                    connector_name=entry.name,
                    command=entry.command,
                    args=[arg_template_payload(template) for template in entry.args],
                    env=[env_template_payload(template) for template in entry.env],
                )
            ],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "secret":
        result = _materialize_secret_http(record, entry)
        if result is None:
            return _MaterializedRecordResult(
                summaries=[
                    _summary(record, entry, outcome="not_applied", reason="missing_secret")
                ],
                warnings=[_warning(record, entry, "missing_secret")],
            )
        return _MaterializedRecordResult(
            servers=[result],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "oauth":
        result = await _materialize_oauth_http(record, entry)
        if result is None:
            return _MaterializedRecordResult(
                summaries=[
                    _summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason="needs_reconnect",
                    )
                ],
                warnings=[_warning(record, entry, "needs_reconnect")],
            )
        return _MaterializedRecordResult(
            servers=[result],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    return _MaterializedRecordResult()


def _materialize_secret_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> SessionMcpHttpServerModel | None:
    if (
        record.auth is None
        or record.auth.auth_status != "ready"
        or not record.auth.payload_ciphertext
    ):
        return None
    payload = decrypt_json(record.auth.payload_ciphertext)
    secret_fields = payload.get("secretFields")
    if not isinstance(secret_fields, dict):
        return None
    secret_value = str(secret_fields.get(entry.auth_field_id or "") or "")
    if not secret_value:
        return None
    url = entry.url
    headers: list[SessionMcpHeaderModel] = []
    if entry.auth_style is not None:
        if entry.auth_style.kind == "bearer":
            headers.append(
                SessionMcpHeaderModel(name="Authorization", value=f"Bearer {secret_value}")
            )
        elif entry.auth_style.kind == "header" and entry.auth_style.header_name:
            headers.append(
                SessionMcpHeaderModel(
                    name=entry.auth_style.header_name,
                    value=secret_value,
                )
            )
        elif entry.auth_style.kind == "query" and entry.auth_style.parameter_name:
            url = _with_query_secret(url, entry.auth_style.parameter_name, secret_value)
    if not url:
        return None
    return SessionMcpHttpServerModel(
        connection_id=record.connection_id,
        catalog_entry_id=entry.id,
        server_name=record.server_name,
        url=url,
        headers=headers,
    )


async def _materialize_oauth_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> SessionMcpHttpServerModel | None:
    token = await _ready_oauth_access_token(record)
    if token is None:
        return None
    return SessionMcpHttpServerModel(
        connection_id=record.connection_id,
        catalog_entry_id=entry.id,
        server_name=record.server_name,
        url=build_oauth_server_url(entry, _parse_settings(record.settings_json)),
        headers=[SessionMcpHeaderModel(name="Authorization", value=f"Bearer {token}")],
    )


async def _ready_oauth_access_token(
    record: CloudMcpConnectionRecord,
) -> str | None:
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
    auth = await load_connection_auth(connection_db_id=record.id)
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
    token_parts = (refresh_token_value, token_endpoint, client_id, resource)
    if not all(isinstance(value, str) and value for value in token_parts):
        marked = await mark_connection_auth_status_if_version(
            connection_db_id=record.id,
            expected_auth_version=auth.auth_version,
            auth_kind="oauth",
            auth_status="needs_reconnect",
            last_error_code="missing_refresh_token",
        )
        if marked is None:
            return await _latest_ready_oauth_access_token(record)
        return None
    try:
        refreshed = await refresh_token(
            token_endpoint=token_endpoint,
            client_id=client_id,
            refresh_token_value=refresh_token_value,
            resource=resource,
        )
    except McpOAuthProviderError as exc:
        marked = await mark_connection_auth_status_if_version(
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
    updated = await update_connection_auth_if_version(
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
    auth = await load_connection_auth(connection_db_id=record.id)
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


def _with_query_secret(url: str, parameter_name: str, secret_value: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[parameter_name] = secret_value
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            urlencode(query),
            parsed.fragment,
        )
    )
