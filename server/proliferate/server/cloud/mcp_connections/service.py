from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.analytics import (
    CloudMcpConnectionEventInsert,
    record_cloud_mcp_connection_event,
)
from proliferate.db.store.cloud_mcp.auth import upsert_connection_auth
from proliferate.db.store.cloud_mcp.connections import (
    delete_user_connection,
    get_user_connection,
    list_user_connections,
    patch_user_connection,
    upsert_user_connection,
)
from proliferate.db.store.cloud_mcp.oauth_flows import cancel_active_oauth_flows_for_connection
from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import get_catalog_entry
from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.mcp_connections.domain.connection_rules import (
    McpConnectionRuleViolation,
    connection_oauth_resource_url,
    connection_settings_json,
    generate_server_name,
    oauth_resource_change_requires_reconnect,
    parse_connection_settings,
    reject_local_oauth_account_change,
    resolve_connection_auth_state,
    validate_connection_secret_fields,
    validate_connection_settings,
)
from proliferate.server.cloud.mcp_connections.domain.connection_rules import (
    validate_connection_id as validate_connection_id_rule,
)
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpAuthKind,
    CloudMcpAuthStatus,
    CreateCloudMcpConnectionRequest,
    PatchCloudMcpConnectionRequest,
    PublicizeCloudMcpConnectionRequest,
    PutCloudMcpSecretAuthRequest,
)
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership
from proliferate.utils.crypto import encrypt_json


@dataclass(frozen=True)
class CloudMcpConnectionPayload:
    record: CloudMcpConnectionRecord
    settings: dict[str, object]
    auth_kind: CloudMcpAuthKind
    auth_status: CloudMcpAuthStatus


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


def _not_found() -> NoReturn:
    raise CloudApiError("not_found", "MCP connection was not found.", status_code=404)


def validate_connection_id(connection_id: str) -> str:
    try:
        return validate_connection_id_rule(connection_id)
    except McpConnectionRuleViolation as exc:
        _invalid_payload(str(exc))


def _validate_connection_settings_or_raise(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    try:
        return validate_connection_settings(entry, settings)
    except McpConnectionRuleViolation as exc:
        _invalid_payload(str(exc))


def _validate_secret_fields_or_raise(
    entry: CatalogEntry,
    secret_fields: dict[str, str],
) -> dict[str, str]:
    try:
        return validate_connection_secret_fields(entry, secret_fields)
    except McpConnectionRuleViolation as exc:
        _invalid_payload(str(exc))


def _oauth_resource_url_or_raise(entry: CatalogEntry, settings: dict[str, object]) -> str:
    try:
        return connection_oauth_resource_url(entry, settings)
    except McpConnectionRuleViolation as exc:
        _invalid_payload(str(exc))


def _reject_local_oauth_account_change_or_raise(
    entry: CatalogEntry,
    old_settings: dict[str, object],
    new_settings: dict[str, object],
) -> None:
    try:
        reject_local_oauth_account_change(entry, old_settings, new_settings)
    except McpConnectionRuleViolation as exc:
        _invalid_payload(str(exc))


def _auth_state(
    record: CloudMcpConnectionRecord,
) -> tuple[CloudMcpAuthKind, CloudMcpAuthStatus]:
    entry = get_catalog_entry(record.catalog_entry_id)
    state = resolve_connection_auth_state(
        entry_auth_kind=entry.auth_kind if entry else None,
        has_auth=record.auth is not None,
        stored_auth_kind=record.auth.auth_kind if record.auth else None,
        stored_auth_status=record.auth.auth_status if record.auth else None,
    )
    return state.auth_kind, state.auth_status


def _connection_payload(record: CloudMcpConnectionRecord) -> CloudMcpConnectionPayload:
    auth_kind, auth_status = _auth_state(record)
    entry = get_catalog_entry(record.catalog_entry_id)
    parsed_settings = parse_connection_settings(record.settings_json)
    if entry is not None:
        with suppress(McpConnectionRuleViolation):
            parsed_settings = validate_connection_settings(entry, parsed_settings)
    return CloudMcpConnectionPayload(
        record=record,
        settings=parsed_settings,
        auth_kind=auth_kind,
        auth_status=auth_status,
    )


async def _record_mcp_connection_event(
    db: AsyncSession,
    record: CloudMcpConnectionRecord,
    *,
    event_type: str,
    auth_kind: str | None = None,
    auth_status: str | None = None,
    enabled: bool | None = None,
    failure_code: str | None = None,
) -> None:
    if auth_kind is None or auth_status is None:
        resolved_auth_kind, resolved_auth_status = _auth_state(record)
        auth_kind = auth_kind or resolved_auth_kind
        auth_status = auth_status or resolved_auth_status
    await record_cloud_mcp_connection_event(
        db,
        CloudMcpConnectionEventInsert(
            user_id=record.user_id,
            org_id=record.org_id,
            connection_id=record.connection_id,
            catalog_entry_id=record.catalog_entry_id,
            event_type=event_type,
            auth_kind=auth_kind,
            auth_status=auth_status,
            enabled=enabled if enabled is not None else record.enabled,
            failure_code=failure_code,
        ),
    )


async def _refresh_personal_runtime_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    actor_user_id: UUID,
    reason: str,
) -> None:
    from proliferate.server.cloud.runtime_config.service import (  # noqa: PLC0415
        refresh_profile_runtime_config,
    )

    profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
        db,
        user_id=user_id,
        created_by_user_id=actor_user_id,
    )
    await refresh_profile_runtime_config(
        db,
        sandbox_profile_id=profile.id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


async def _refresh_org_runtime_config(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
    reason: str,
) -> None:
    from proliferate.server.cloud.runtime_config.service import (  # noqa: PLC0415
        refresh_profile_runtime_config,
    )

    profile = await sandbox_profile_store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=actor_user_id,
    )
    await refresh_profile_runtime_config(
        db,
        sandbox_profile_id=profile.id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


async def list_cloud_mcp_connections(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudMcpConnectionPayload]:
    records = await list_user_connections(db, user_id)
    return [_connection_payload(record) for record in records]


async def create_cloud_mcp_connection(
    db: AsyncSession,
    user_id: UUID,
    body: CreateCloudMcpConnectionRequest,
) -> CloudMcpConnectionPayload:
    catalog_entry_id = body.catalog_entry_id.strip()
    entry = get_catalog_entry(catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    if not catalog_entry_is_configured(entry):
        _invalid_payload("Connector catalog entry is not configured for this deployment.")
    settings = _validate_connection_settings_or_raise(entry, body.settings)
    existing = await list_user_connections(db, user_id)
    if any(record.catalog_entry_id == entry.id for record in existing):
        _invalid_payload(f"{entry.name} is already connected.")
    connection_id = ""
    server_name = generate_server_name(
        entry,
        {record.server_name for record in existing},
        connection_id,
    )
    record = await upsert_user_connection(
        db,
        user_id=user_id,
        catalog_entry_id=entry.id,
        catalog_entry_version=entry.version,
        server_name=server_name,
        settings_json=connection_settings_json(settings),
        enabled=body.enabled,
    )
    await _record_mcp_connection_event(
        db,
        record,
        event_type="connection_created",
        auth_kind=entry.auth_kind,
        enabled=body.enabled,
    )
    if entry.auth_kind == "none":
        await upsert_connection_auth(
            db,
            connection_db_id=record.id,
            auth_kind="none",
            auth_status="ready",
            payload_ciphertext=None,
            payload_format="json-v1",
        )
        refreshed = await get_user_connection(db, user_id, record.connection_id)
        if refreshed is None:
            _not_found()
        record = refreshed
        await _record_mcp_connection_event(
            db,
            record,
            event_type="auth_ready",
            auth_kind="none",
            auth_status="ready",
            enabled=record.enabled,
        )
    await _refresh_personal_runtime_config(
        db,
        user_id=user_id,
        actor_user_id=user_id,
        reason="mcp_connection_created",
    )
    return _connection_payload(record)


async def patch_cloud_mcp_connection(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    existing: CloudMcpConnectionRecord,
    body: PatchCloudMcpConnectionRequest,
) -> CloudMcpConnectionPayload:
    entry = get_catalog_entry(existing.catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    settings_json = None
    if body.settings is not None:
        new_settings = _validate_connection_settings_or_raise(entry, body.settings)
        old_settings = parse_connection_settings(existing.settings_json)
        _reject_local_oauth_account_change_or_raise(entry, old_settings, new_settings)
        if entry.auth_kind == "oauth" and existing.auth and existing.auth.auth_status == "ready":
            old_resource = _oauth_resource_url_or_raise(entry, old_settings)
            new_resource = _oauth_resource_url_or_raise(entry, new_settings)
            if oauth_resource_change_requires_reconnect(
                auth_kind=entry.auth_kind,
                auth_status=existing.auth.auth_status,
                old_resource_url=old_resource,
                new_resource_url=new_resource,
            ):
                _invalid_payload("Reconnect this MCP before changing URL-affecting settings.")
        settings_json = connection_settings_json(new_settings)
    old_public_org_id = existing.public_organization_id
    new_public_org_id = old_public_org_id
    if body.public_to_org is True:
        if body.public_organization_id is None:
            _invalid_payload("organizationId is required when publicizing an MCP connection.")
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=body.public_organization_id,
            user_id=actor_user_id,
        )
        require_target_admin_membership(membership)
        new_public_org_id = body.public_organization_id
    elif body.public_to_org is False:
        if old_public_org_id is not None:
            membership = await organizations_store.get_active_membership(
                db,
                organization_id=old_public_org_id,
                user_id=actor_user_id,
            )
            require_target_admin_membership(membership)
        new_public_org_id = None
    record = await patch_user_connection(
        db,
        user_id=existing.user_id,
        connection_id=existing.connection_id,
        enabled=body.enabled,
        settings_json=settings_json,
        catalog_entry_version=entry.version if settings_json is not None else None,
        public_to_org=body.public_to_org,
        public_organization_id=new_public_org_id,
        public_status=(
            "public"
            if body.public_to_org
            else "private"
            if body.public_to_org is not None
            else None
        ),
        public_updated_by_user_id=(
            actor_user_id if body.public_to_org is not None else existing.public_updated_by_user_id
        ),
    )
    if record is None:
        _not_found()
    if body.enabled is not None and body.enabled != existing.enabled:
        await _record_mcp_connection_event(
            db,
            record,
            event_type="enabled" if body.enabled else "disabled",
            enabled=record.enabled,
        )
    await _refresh_personal_runtime_config(
        db,
        user_id=record.user_id,
        actor_user_id=actor_user_id,
        reason="mcp_connection_updated",
    )
    refresh_org_ids = {
        org_id
        for org_id in (old_public_org_id, record.public_organization_id)
        if org_id is not None
    }
    for organization_id in refresh_org_ids:
        await _refresh_org_runtime_config(
            db,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            reason="mcp_connection_publicized",
        )
    return _connection_payload(record)


async def publicize_cloud_mcp_connection(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    existing: CloudMcpConnectionRecord,
    body: PublicizeCloudMcpConnectionRequest,
) -> CloudMcpConnectionPayload:
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=body.organization_id,
        user_id=actor_user_id,
    )
    require_target_admin_membership(membership)
    record = await patch_user_connection(
        db,
        user_id=existing.user_id,
        connection_id=existing.connection_id,
        public_to_org=True,
        public_organization_id=body.organization_id,
        public_status="public",
        public_updated_by_user_id=actor_user_id,
    )
    if record is None:
        _not_found()
    await _refresh_personal_runtime_config(
        db,
        user_id=record.user_id,
        actor_user_id=actor_user_id,
        reason="mcp_connection_publicized",
    )
    await _refresh_org_runtime_config(
        db,
        organization_id=body.organization_id,
        actor_user_id=actor_user_id,
        reason="mcp_connection_publicized",
    )
    return _connection_payload(record)


async def unpublicize_cloud_mcp_connection(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    existing: CloudMcpConnectionRecord,
) -> CloudMcpConnectionPayload:
    org_id = existing.public_organization_id
    if org_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=org_id,
            user_id=actor_user_id,
        )
        require_target_admin_membership(membership)
    record = await patch_user_connection(
        db,
        user_id=existing.user_id,
        connection_id=existing.connection_id,
        public_to_org=False,
        public_organization_id=None,
        public_status="private",
        public_updated_by_user_id=actor_user_id,
    )
    if record is None:
        _not_found()
    await _refresh_personal_runtime_config(
        db,
        user_id=record.user_id,
        actor_user_id=actor_user_id,
        reason="mcp_connection_unpublicized",
    )
    if org_id is not None:
        await _refresh_org_runtime_config(
            db,
            organization_id=org_id,
            actor_user_id=actor_user_id,
            reason="mcp_connection_unpublicized",
        )
    return _connection_payload(record)


async def put_cloud_mcp_connection_secret_auth(
    db: AsyncSession,
    record: CloudMcpConnectionRecord,
    body: PutCloudMcpSecretAuthRequest,
) -> CloudMcpConnectionPayload:
    entry = get_catalog_entry(record.catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    cleaned = _validate_secret_fields_or_raise(entry, body.secret_fields)
    await upsert_connection_auth(
        db,
        connection_db_id=record.id,
        auth_kind="secret",
        auth_status="ready",
        payload_ciphertext=encrypt_json({"secretFields": cleaned}),
        payload_format="secret-fields-v1",
    )
    updated = await get_user_connection(db, record.user_id, record.connection_id)
    if updated is None:
        _not_found()
    await _record_mcp_connection_event(
        db,
        updated,
        event_type=(
            "secret_updated"
            if record.auth is not None and record.auth.auth_status == "ready"
            else "auth_ready"
        ),
        auth_kind="secret",
        auth_status="ready",
        enabled=updated.enabled,
    )
    await _refresh_personal_runtime_config(
        db,
        user_id=record.user_id,
        actor_user_id=record.user_id,
        reason="mcp_connection_auth_updated",
    )
    if updated.public_organization_id is not None:
        await _refresh_org_runtime_config(
            db,
            organization_id=updated.public_organization_id,
            actor_user_id=record.user_id,
            reason="mcp_connection_auth_updated",
        )
    return _connection_payload(updated)


async def delete_cloud_mcp_connection_for_user(
    db: AsyncSession,
    connection: CloudMcpConnectionRecord,
) -> None:
    public_org_id = connection.public_organization_id
    await _record_mcp_connection_event(
        db,
        connection,
        event_type="deleted",
        enabled=connection.enabled,
    )
    await cancel_active_oauth_flows_for_connection(
        db,
        connection_db_id=connection.id,
        failure_code="connection_deleted",
    )
    await delete_user_connection(db, connection.user_id, connection.connection_id)
    await _refresh_personal_runtime_config(
        db,
        user_id=connection.user_id,
        actor_user_id=connection.user_id,
        reason="mcp_connection_deleted",
    )
    if public_org_id is not None:
        await _refresh_org_runtime_config(
            db,
            organization_id=public_org_id,
            actor_user_id=connection.user_id,
            reason="mcp_connection_deleted",
        )
