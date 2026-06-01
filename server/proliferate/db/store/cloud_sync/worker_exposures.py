"""Worker exposure snapshot queries."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sync import CloudSessionProjection
from proliferate.db.models.cloud.workspaces import CloudWorkspace


@dataclass(frozen=True)
class WorkerExposureSnapshot:
    exposure_id: UUID
    target_id: UUID
    cloud_workspace_id: UUID
    session_projection_id: UUID | None
    anyharness_workspace_id: str
    anyharness_session_id: str | None
    projection_level: str
    commandable: bool
    status: str
    revision: int | None
    last_uploaded_seq: int


async def list_worker_exposure_snapshots_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[WorkerExposureSnapshot, ...]:
    projection_rows = (
        await db.execute(
            select(CloudSessionProjection, CloudWorkspaceExposure)
            .join(
                CloudWorkspaceExposure,
                CloudWorkspaceExposure.id == CloudSessionProjection.exposure_id,
            )
            .join(CloudWorkspace, CloudWorkspace.id == CloudWorkspaceExposure.cloud_workspace_id)
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .where(CloudWorkspaceExposure.status == "active")
            .where(CloudWorkspace.archived_at.is_(None))
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.ended_at.is_(None))
            .where(
                or_(
                    CloudSessionProjection.workspace_id.is_not(None),
                    CloudWorkspaceExposure.anyharness_workspace_id.is_not(None),
                )
            )
            .order_by(
                CloudWorkspaceExposure.updated_at.desc(),
                CloudSessionProjection.updated_at.desc(),
                CloudSessionProjection.id.asc(),
            )
        )
    ).all()
    snapshots: list[WorkerExposureSnapshot] = [
        WorkerExposureSnapshot(
            exposure_id=exposure.id,
            target_id=projection.target_id,
            cloud_workspace_id=exposure.cloud_workspace_id,
            session_projection_id=projection.id,
            anyharness_workspace_id=(
                projection.workspace_id or exposure.anyharness_workspace_id or ""
            ),
            anyharness_session_id=projection.session_id,
            projection_level=projection.projection_level,
            commandable=projection.commandable,
            status=exposure.status,
            revision=exposure.revision,
            last_uploaded_seq=projection.last_uploaded_seq or 0,
        )
        for projection, exposure in projection_rows
    ]

    exposure_rows = (
        await db.execute(
            select(CloudWorkspaceExposure)
            .join(CloudWorkspace, CloudWorkspace.id == CloudWorkspaceExposure.cloud_workspace_id)
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .where(CloudWorkspaceExposure.status == "active")
            .where(CloudWorkspace.archived_at.is_(None))
            .where(CloudWorkspaceExposure.anyharness_workspace_id.is_not(None))
            .order_by(CloudWorkspaceExposure.updated_at.desc(), CloudWorkspaceExposure.id.asc())
        )
    ).scalars()
    snapshots.extend(
        WorkerExposureSnapshot(
            exposure_id=exposure.id,
            target_id=exposure.target_id,
            cloud_workspace_id=exposure.cloud_workspace_id,
            session_projection_id=None,
            anyharness_workspace_id=exposure.anyharness_workspace_id or "",
            anyharness_session_id=None,
            projection_level=exposure.default_projection_level,
            commandable=exposure.commandable,
            status=exposure.status,
            revision=exposure.revision,
            last_uploaded_seq=0,
        )
        for exposure in exposure_rows
    )
    return tuple(snapshots)


def exposure_fingerprint_hash(snapshots: tuple[WorkerExposureSnapshot, ...]) -> str:
    values = [
        {
            key: str(value) if isinstance(value, UUID) else value
            for key, value in asdict(snapshot).items()
            if key != "last_uploaded_seq"
        }
        for snapshot in snapshots
    ]
    values.sort(
        key=lambda row: (
            str(row["exposure_id"]),
            str(row["session_projection_id"] or ""),
            str(row["anyharness_session_id"] or ""),
        )
    )
    payload = json.dumps(values, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
