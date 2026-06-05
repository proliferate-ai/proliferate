"""Admission policy for worker event projection ingest."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store


@dataclass(frozen=True)
class ProjectionIngestPolicy:
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    projection_level: str
    live_fanout: bool
    transcript_rows: bool


@dataclass(frozen=True)
class ProjectionIngestAdmission:
    policy: ProjectionIngestPolicy | None
    discard_reason: str = "inactive_projection"


async def projection_ingest_policy(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    workspace_id: str | None,
) -> ProjectionIngestAdmission:
    projection = await projections_store.get_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    if projection is None or projection.exposure_id is None:
        return ProjectionIngestAdmission(policy=None)
    exposure = await exposures_store.get_workspace_exposure_by_id(
        db,
        projection.exposure_id,
    )
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        return ProjectionIngestAdmission(policy=None)
    expected_workspace_id = exposure.anyharness_workspace_id or projection.workspace_id
    if expected_workspace_id and workspace_id and workspace_id != expected_workspace_id:
        return ProjectionIngestAdmission(policy=None, discard_reason="workspace_mismatch")
    return ProjectionIngestAdmission(
        policy=ProjectionIngestPolicy(
            cloud_workspace_id=projection.cloud_workspace_id or exposure.cloud_workspace_id,
            workspace_id=expected_workspace_id or workspace_id,
            projection_level=projection.projection_level,
            live_fanout=projection.projection_level == "live",
            transcript_rows=projection.projection_level in {"transcript", "live"},
        )
    )
