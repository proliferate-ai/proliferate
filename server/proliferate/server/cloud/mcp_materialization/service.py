from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.mcp_catalog import CATALOG_VERSION
from proliferate.db.store.cloud_mcp.connections import list_user_connections
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import get_catalog_entry
from proliferate.server.cloud.mcp_materialization.models import (
    MaterializeCloudMcpRequest,
    MaterializeCloudMcpResponse,
)
from proliferate.server.cloud.mcp_materialization.record_materialization import (
    materialize_record_with_timeout,
)
from proliferate.server.cloud.plugins.catalog.models import plugin_package_payload
from proliferate.server.cloud.plugins.catalog.service import plugin_packages_for_catalog_entries

_MATERIALIZATION_CONCURRENCY = 5


def _cloud_mcp_enabled_or_raise() -> None:
    if not settings.cloud_mcp_enabled:
        raise CloudApiError("cloud_mcp_disabled", "Cloud MCP is disabled.", status_code=403)


async def materialize_cloud_mcp_servers(
    db: AsyncSession,
    *,
    user_id: UUID,
    body: MaterializeCloudMcpRequest,
) -> MaterializeCloudMcpResponse:
    _cloud_mcp_enabled_or_raise()
    records = await list_user_connections(db, user_id)
    requested = set(body.connection_ids or [])
    if requested:
        records = [record for record in records if record.connection_id in requested]

    semaphore = asyncio.Semaphore(_MATERIALIZATION_CONCURRENCY)
    results = await asyncio.gather(
        *[
            materialize_record_with_timeout(
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
    catalog_entries = []
    seen_catalog_entry_ids: set[str] = set()
    for record in records:
        if record.catalog_entry_id in seen_catalog_entry_ids:
            continue
        entry = get_catalog_entry(record.catalog_entry_id)
        if entry is None or not catalog_entry_is_configured(entry):
            continue
        seen_catalog_entry_ids.add(record.catalog_entry_id)
        catalog_entries.append(entry)

    return MaterializeCloudMcpResponse(
        catalog_version=CATALOG_VERSION,
        mcp_servers=servers,
        mcp_binding_summaries=summaries,
        local_stdio_candidates=candidates,
        plugin_packages=[
            plugin_package_payload(package)
            for package in plugin_packages_for_catalog_entries(catalog_entries)
        ],
        warnings=warnings,
    )
