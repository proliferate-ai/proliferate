from __future__ import annotations

from typing import Literal

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.domain.rendering import render_http_launch
from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogConfigurationError,
    CatalogEntry,
)
from proliferate.server.cloud.mcp_materialization.launch_inputs import (
    launch_context,
    secret_fields_for_record,
    settings_for_record,
)
from proliferate.server.cloud.mcp_materialization.models import (
    SessionMcpHeaderModel,
    SessionMcpHttpServerModel,
)
from proliferate.server.cloud.mcp_materialization.oauth_tokens import ready_oauth_access_token
from proliferate.server.cloud.mcp_materialization.results import HttpMaterializationFailure


def materialize_no_auth_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> SessionMcpHttpServerModel | None:
    try:
        launch = render_http_launch(
            entry,
            settings_for_record(record, entry),
            launch_context=launch_context(target_location),
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


def materialize_secret_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> tuple[SessionMcpHttpServerModel | None, HttpMaterializationFailure | None]:
    try:
        settings = settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, HttpMaterializationFailure("invalid_settings", "invalid_settings")
    cleaned_secrets = secret_fields_for_record(record, entry)
    if cleaned_secrets is None:
        return None, HttpMaterializationFailure("missing_secret", "missing_secret")
    try:
        launch = render_http_launch(
            entry,
            settings,
            secrets=cleaned_secrets,
            launch_context=launch_context(target_location),
        )
    except CatalogConfigurationError:
        return None, HttpMaterializationFailure("invalid_settings", "invalid_settings")
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


async def materialize_oauth_http(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
    *,
    target_location: Literal["local", "cloud"],
) -> tuple[SessionMcpHttpServerModel | None, HttpMaterializationFailure | None]:
    token = await ready_oauth_access_token(record)
    if token is None:
        return None, HttpMaterializationFailure("needs_reconnect", "needs_reconnect")
    try:
        settings = settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, HttpMaterializationFailure("invalid_settings", "invalid_settings")
    try:
        launch = render_http_launch(
            entry,
            settings,
            launch_context=launch_context(target_location),
        )
    except CatalogConfigurationError:
        return None, HttpMaterializationFailure("invalid_settings", "invalid_settings")
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
