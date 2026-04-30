from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from proliferate.config import settings
from proliferate.db.store.cloud_mcp.auth import (
    load_connection_auth,
    mark_connection_auth_status_if_version,
    update_connection_auth_if_version,
)
from proliferate.db.store.cloud_mcp.connections import list_user_connections
from proliferate.db.store.cloud_mcp.oauth_clients import get_oauth_client
from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord, CloudMcpConnectionRecord
from proliferate.integrations.mcp_oauth import McpOAuthProviderError, refresh_token
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import (
    CATALOG_VERSION,
    ArgTemplate,
    CatalogConfigurationError,
    CatalogEntry,
    EnvTemplate,
    connector_supports_target,
    get_catalog_entry,
    parse_settings,
    render_http_launch,
    validate_secret_fields,
    validate_settings,
)
from proliferate.server.cloud.mcp_materialization.models import (
    CloudMcpMaterializationWarningModel,
    LocalStdioArgTemplateModel,
    LocalStdioCandidateModel,
    LocalStdioEnvTemplateModel,
    MaterializeCloudMcpRequest,
    MaterializeCloudMcpResponse,
    McpNotAppliedReason,
    McpWarningKind,
    SessionMcpBindingSummaryModel,
    SessionMcpHeaderModel,
    SessionMcpHttpServerModel,
    local_stdio_static_arg_payload,
    local_stdio_static_env_payload,
    local_stdio_workspace_path_arg_payload,
)
from proliferate.utils.crypto import decrypt_json, decrypt_text, encrypt_json

_OAUTH_REFRESH_SKEW = timedelta(seconds=60)
_MATERIALIZATION_CONCURRENCY = 5
_MATERIALIZATION_TIMEOUT_SECONDS = 20.0
_oauth_refresh_locks: dict[UUID, asyncio.Lock] = {}
_oauth_refresh_locks_guard = asyncio.Lock()


def _oauth_redirect_uri() -> str:
    base = settings.cloud_mcp_oauth_callback_base_url.strip() or settings.api_base_url.strip()
    if not base:
        base = "http://localhost:8000"
    return f"{base.rstrip('/')}/v1/cloud/mcp/oauth/callback"


@dataclass
class _MaterializedRecordResult:
    servers: list[SessionMcpHttpServerModel] = field(default_factory=list)
    summaries: list[SessionMcpBindingSummaryModel] = field(default_factory=list)
    candidates: list[LocalStdioCandidateModel] = field(default_factory=list)
    warnings: list[CloudMcpMaterializationWarningModel] = field(default_factory=list)


@dataclass(frozen=True)
class _StdioMaterializationFailure:
    reason: McpNotAppliedReason
    warning: McpWarningKind


@dataclass(frozen=True)
class _HttpMaterializationFailure:
    reason: McpNotAppliedReason
    warning: McpWarningKind


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
    if not catalog_entry_is_configured(entry):
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
        candidate, failure = _materialize_stdio_candidate(record, entry)
        if candidate is None:
            reason = failure.reason if failure else "resolver_error"
            warning = failure.warning if failure else "resolver_error"
            return _MaterializedRecordResult(
                summaries=[_summary(record, entry, outcome="not_applied", reason=reason)],
                warnings=[_warning(record, entry, warning)],
            )
        return _MaterializedRecordResult(
            candidates=[candidate],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "none":
        result = _materialize_no_auth_http(record, entry, target_location=target_location)
        if result is None:
            return _MaterializedRecordResult(
                summaries=[
                    _summary(record, entry, outcome="not_applied", reason="invalid_settings")
                ],
                warnings=[_warning(record, entry, "invalid_settings")],
            )
        return _MaterializedRecordResult(
            servers=[result],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "secret":
        result, http_failure = _materialize_secret_http(
            record,
            entry,
            target_location=target_location,
        )
        if result is None:
            reason = http_failure.reason if http_failure else "missing_secret"
            warning = http_failure.warning if http_failure else "missing_secret"
            return _MaterializedRecordResult(
                summaries=[_summary(record, entry, outcome="not_applied", reason=reason)],
                warnings=[_warning(record, entry, warning)],
            )
        return _MaterializedRecordResult(
            servers=[result],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "oauth":
        result, http_failure = await _materialize_oauth_http(
            record,
            entry,
            target_location=target_location,
        )
        if result is None:
            reason = http_failure.reason if http_failure else "needs_reconnect"
            warning = http_failure.warning if http_failure else "needs_reconnect"
            return _MaterializedRecordResult(
                summaries=[_summary(record, entry, outcome="not_applied", reason=reason)],
                warnings=[_warning(record, entry, warning)],
            )
        return _MaterializedRecordResult(
            servers=[result],
            summaries=[_summary(record, entry, outcome="applied")],
        )
    return _MaterializedRecordResult()


def _materialize_stdio_candidate(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> tuple[LocalStdioCandidateModel | None, _StdioMaterializationFailure | None]:
    try:
        settings_for_record = _settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, _StdioMaterializationFailure("invalid_settings", "invalid_settings")
    secrets = _secret_fields_for_record(record, entry) if entry.auth_kind == "secret" else {}
    if secrets is None:
        return None, _StdioMaterializationFailure("missing_secret", "missing_secret")
    try:
        args = [
            _stdio_arg_payload(template, settings_for_record, secrets) for template in entry.args
        ]
        env = [
            _stdio_env_payload(template, settings_for_record, secrets) for template in entry.env
        ]
    except CatalogConfigurationError:
        return None, _StdioMaterializationFailure("invalid_settings", "invalid_settings")
    return (
        LocalStdioCandidateModel(
            connection_id=record.connection_id,
            catalog_entry_id=entry.id,
            server_name=record.server_name,
            connector_name=entry.name,
            command=entry.command,
            args=args,
            env=env,
        ),
        None,
    )


def _stdio_arg_payload(
    template: ArgTemplate,
    settings_for_record: dict[str, object],
    secrets: dict[str, str],
) -> LocalStdioArgTemplateModel:
    if template.kind == "workspace_path":
        return local_stdio_workspace_path_arg_payload()
    return local_stdio_static_arg_payload(
        _resolved_stdio_source_value(
            template.kind,
            template.value,
            template.field_id,
            settings_for_record,
            secrets,
        )
    )


def _stdio_env_payload(
    template: EnvTemplate,
    settings_for_record: dict[str, object],
    secrets: dict[str, str],
) -> LocalStdioEnvTemplateModel:
    return local_stdio_static_env_payload(
        template.name,
        _resolved_stdio_source_value(
            template.kind,
            template.value,
            template.field_id,
            settings_for_record,
            secrets,
        ),
    )


def _resolved_stdio_source_value(
    kind: str,
    value: str | None,
    field_id: str | None,
    settings_for_record: dict[str, object],
    secrets: dict[str, str],
) -> str:
    if kind == "static":
        return value or ""
    if kind == "secret":
        if not field_id or field_id not in secrets:
            raise CatalogConfigurationError("Required stdio secret value was missing.")
        return secrets[field_id]
    if kind == "setting":
        if not field_id or field_id not in settings_for_record:
            raise CatalogConfigurationError("Required stdio setting value was missing.")
        setting_value = settings_for_record[field_id]
        if isinstance(setting_value, bool):
            return "true" if setting_value else "false"
        return str(setting_value)
    raise CatalogConfigurationError("Unsupported stdio launch source.")


def _secret_fields_for_record(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> dict[str, str] | None:
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
    try:
        return validate_secret_fields(
            entry,
            {str(key): str(value) for key, value in secret_fields.items()},
        )
    except CatalogConfigurationError:
        return None


def _materialize_no_auth_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> SessionMcpHttpServerModel | None:
    try:
        launch = render_http_launch(
            entry,
            _settings_for_record(record, entry),
            launch_context=_launch_context(target_location),
        )
    except CatalogConfigurationError:
        return None
    return SessionMcpHttpServerModel(
        connection_id=record.connection_id,
        catalog_entry_id=entry.id,
        server_name=record.server_name,
        url=launch.url,
        headers=[
            SessionMcpHeaderModel(name=header.name, value=header.value)
            for header in launch.headers
        ],
    )


def _materialize_secret_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> tuple[SessionMcpHttpServerModel | None, _HttpMaterializationFailure | None]:
    try:
        settings_for_record = _settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, _HttpMaterializationFailure("invalid_settings", "invalid_settings")
    cleaned_secrets = _secret_fields_for_record(record, entry)
    if cleaned_secrets is None:
        return None, _HttpMaterializationFailure("missing_secret", "missing_secret")
    try:
        launch = render_http_launch(
            entry,
            settings_for_record,
            secrets=cleaned_secrets,
            launch_context=_launch_context(target_location),
        )
    except CatalogConfigurationError:
        return None, _HttpMaterializationFailure("invalid_settings", "invalid_settings")
    return (
        SessionMcpHttpServerModel(
            connection_id=record.connection_id,
            catalog_entry_id=entry.id,
            server_name=record.server_name,
            url=launch.url,
            headers=[
                SessionMcpHeaderModel(name=header.name, value=header.value)
                for header in launch.headers
            ],
        ),
        None,
    )


async def _materialize_oauth_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> tuple[SessionMcpHttpServerModel | None, _HttpMaterializationFailure | None]:
    token = await _ready_oauth_access_token(record)
    if token is None:
        return None, _HttpMaterializationFailure("needs_reconnect", "needs_reconnect")
    try:
        settings_for_record = _settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, _HttpMaterializationFailure("invalid_settings", "invalid_settings")
    try:
        launch = render_http_launch(
            entry,
            settings_for_record,
            launch_context=_launch_context(target_location),
        )
    except CatalogConfigurationError:
        return None, _HttpMaterializationFailure("invalid_settings", "invalid_settings")
    return (
        SessionMcpHttpServerModel(
            connection_id=record.connection_id,
            catalog_entry_id=entry.id,
            server_name=record.server_name,
            url=launch.url,
            headers=[
                SessionMcpHeaderModel(name="Authorization", value=f"Bearer {token}"),
                *[
                    SessionMcpHeaderModel(name=header.name, value=header.value)
                    for header in launch.headers
                ],
            ],
        ),
        None,
    )


def _settings_for_record(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> dict[str, object]:
    return validate_settings(entry, parse_settings(record.settings_json))


def _launch_context(
    target_location: Literal["local", "cloud"],
) -> Literal["local_materialization", "cloud_materialization"]:
    return "local_materialization" if target_location == "local" else "cloud_materialization"


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
    issuer = payload.get("issuer")
    redirect_uri = payload.get("redirectUri") or _oauth_redirect_uri()
    oauth_client = (
        await get_oauth_client(
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
