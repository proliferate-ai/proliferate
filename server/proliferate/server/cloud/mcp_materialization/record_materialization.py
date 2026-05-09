from __future__ import annotations

import asyncio
from typing import Literal

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import get_catalog_entry
from proliferate.server.cloud.mcp_catalog.domain.rendering import connector_supports_target
from proliferate.server.cloud.mcp_materialization.http_launch import (
    materialize_no_auth_http,
    materialize_oauth_http,
    materialize_secret_http,
)
from proliferate.server.cloud.mcp_materialization.results import (
    MaterializedRecordResult,
    materialization_summary,
    materialization_warning,
)
from proliferate.server.cloud.mcp_materialization.stdio_launch import (
    materialize_stdio_candidate,
)

_MATERIALIZATION_TIMEOUT_SECONDS = 20.0


async def materialize_record_with_timeout(
    record: CloudMcpConnectionRecord,
    *,
    target_location: Literal["local", "cloud"],
    semaphore: asyncio.Semaphore,
) -> MaterializedRecordResult:
    async with semaphore:
        try:
            return await asyncio.wait_for(
                materialize_record(record, target_location=target_location),
                timeout=_MATERIALIZATION_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            return _resolver_error_result(record)
        except Exception:
            return _resolver_error_result(record)


async def materialize_record(
    record: CloudMcpConnectionRecord,
    *,
    target_location: Literal["local", "cloud"],
) -> MaterializedRecordResult:
    if not record.enabled:
        return MaterializedRecordResult()
    entry = get_catalog_entry(record.catalog_entry_id)
    if entry is None:
        return MaterializedRecordResult()
    if not catalog_entry_is_configured(entry):
        return MaterializedRecordResult()
    if not connector_supports_target(entry, target_location):
        return MaterializedRecordResult(
            summaries=[
                materialization_summary(
                    record,
                    entry,
                    outcome="not_applied",
                    reason="unsupported_target",
                )
            ],
            warnings=[materialization_warning(record, entry, "unsupported_target")],
        )
    if entry.transport == "stdio":
        if target_location != "local":
            return MaterializedRecordResult()
        candidate, failure = materialize_stdio_candidate(record, entry)
        if candidate is None:
            reason = failure.reason if failure else "resolver_error"
            warning = failure.warning if failure else "resolver_error"
            return MaterializedRecordResult(
                summaries=[
                    materialization_summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason=reason,
                    )
                ],
                warnings=[materialization_warning(record, entry, warning)],
            )
        return MaterializedRecordResult(
            candidates=[candidate],
            summaries=[materialization_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "none":
        result = materialize_no_auth_http(record, entry, target_location=target_location)
        if result is None:
            return MaterializedRecordResult(
                summaries=[
                    materialization_summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason="invalid_settings",
                    )
                ],
                warnings=[materialization_warning(record, entry, "invalid_settings")],
            )
        return MaterializedRecordResult(
            servers=[result],
            summaries=[materialization_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "secret":
        result, http_failure = materialize_secret_http(
            record,
            entry,
            target_location=target_location,
        )
        if result is None:
            reason = http_failure.reason if http_failure else "missing_secret"
            warning = http_failure.warning if http_failure else "missing_secret"
            return MaterializedRecordResult(
                summaries=[
                    materialization_summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason=reason,
                    )
                ],
                warnings=[materialization_warning(record, entry, warning)],
            )
        return MaterializedRecordResult(
            servers=[result],
            summaries=[materialization_summary(record, entry, outcome="applied")],
        )
    if entry.auth_kind == "oauth":
        result, http_failure = await materialize_oauth_http(
            record,
            entry,
            target_location=target_location,
        )
        if result is None:
            reason = http_failure.reason if http_failure else "needs_reconnect"
            warning = http_failure.warning if http_failure else "needs_reconnect"
            return MaterializedRecordResult(
                summaries=[
                    materialization_summary(
                        record,
                        entry,
                        outcome="not_applied",
                        reason=reason,
                    )
                ],
                warnings=[materialization_warning(record, entry, warning)],
            )
        return MaterializedRecordResult(
            servers=[result],
            summaries=[materialization_summary(record, entry, outcome="applied")],
        )
    return MaterializedRecordResult()


def _resolver_error_result(record: CloudMcpConnectionRecord) -> MaterializedRecordResult:
    entry = get_catalog_entry(record.catalog_entry_id)
    if entry is None:
        return MaterializedRecordResult()
    return MaterializedRecordResult(
        summaries=[
            materialization_summary(
                record,
                entry,
                outcome="not_applied",
                reason="resolver_error",
            )
        ],
        warnings=[materialization_warning(record, entry, "resolver_error")],
    )
