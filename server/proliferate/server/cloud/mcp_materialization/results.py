from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.mcp_materialization.models import (
    CloudMcpMaterializationWarningModel,
    LocalStdioCandidateModel,
    McpNotAppliedReason,
    McpWarningKind,
    SessionMcpBindingSummaryModel,
    SessionMcpHttpServerModel,
)


@dataclass
class MaterializedRecordResult:
    servers: list[SessionMcpHttpServerModel] = field(default_factory=list)
    summaries: list[SessionMcpBindingSummaryModel] = field(default_factory=list)
    candidates: list[LocalStdioCandidateModel] = field(default_factory=list)
    warnings: list[CloudMcpMaterializationWarningModel] = field(default_factory=list)


@dataclass(frozen=True)
class StdioMaterializationFailure:
    reason: McpNotAppliedReason
    warning: McpWarningKind


@dataclass(frozen=True)
class HttpMaterializationFailure:
    reason: McpNotAppliedReason
    warning: McpWarningKind


def materialization_warning(
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


def materialization_summary(
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
