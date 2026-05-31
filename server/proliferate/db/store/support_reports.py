"""Persistence helpers for support reports."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.support import SupportReport
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SupportReportSnapshot:
    id: str
    client_job_id: str
    owner_user_id: UUID
    primary_organization_id: UUID | None
    primary_tenant_id: str
    tenant_ids: tuple[str, ...]
    status: str
    s3_bucket: str
    s3_prefix: str
    source_surface: str
    source_context: dict[str, object]
    workspace_refs: tuple[dict[str, object], ...]
    telemetry_refs: dict[str, object]
    object_manifest: dict[str, object]
    request_id: str | None
    complete_request_id: str | None
    request_object_written_at: datetime | None
    cloud_diagnostics_status: str
    cloud_diagnostics_error: str | None
    cloud_diagnostics_started_at: datetime | None
    cloud_diagnostics_completed_at: datetime | None
    slack_notified_at: datetime | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


async def get_report_by_id(
    db: AsyncSession,
    report_id: str,
) -> SupportReportSnapshot | None:
    row = await db.get(SupportReport, report_id)
    return _snapshot(row) if row is not None else None


async def get_report_by_owner_client_job(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    client_job_id: str,
) -> SupportReportSnapshot | None:
    row = (
        await db.execute(
            select(SupportReport).where(
                SupportReport.owner_user_id == owner_user_id,
                SupportReport.client_job_id == client_job_id,
            )
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def create_report(
    db: AsyncSession,
    *,
    report_id: str,
    client_job_id: str,
    owner_user_id: UUID,
    primary_organization_id: UUID | None,
    primary_tenant_id: str,
    tenant_ids: tuple[str, ...],
    s3_bucket: str,
    s3_prefix: str,
    source_surface: str,
    source_context: dict[str, object],
    workspace_refs: tuple[dict[str, object], ...],
    telemetry_refs: dict[str, object],
    request_id: str | None,
    cloud_diagnostics_status: str,
) -> SupportReportSnapshot:
    now = utcnow()
    row = SupportReport(
        id=report_id,
        client_job_id=client_job_id,
        owner_user_id=owner_user_id,
        primary_organization_id=primary_organization_id,
        primary_tenant_id=primary_tenant_id,
        tenant_ids_json=_dump_json(list(tenant_ids)),
        status="created",
        s3_bucket=s3_bucket,
        s3_prefix=s3_prefix,
        source_surface=source_surface,
        source_context_json=_dump_json(source_context),
        workspace_refs_json=_dump_json(list(workspace_refs)),
        telemetry_refs_json=_dump_json(telemetry_refs),
        object_manifest_json=_dump_json({}),
        request_id=request_id,
        cloud_diagnostics_status=cloud_diagnostics_status,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _snapshot(row)


async def mark_request_object_written(
    db: AsyncSession,
    *,
    report_id: str,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    now = utcnow()
    row.request_object_written_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def update_report_upload_manifest(
    db: AsyncSession,
    *,
    report_id: str,
    object_manifest: dict[str, object],
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    row.object_manifest_json = _dump_json(object_manifest)
    if row.status != "completed":
        row.status = "uploading"
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def mark_report_completed(
    db: AsyncSession,
    *,
    report_id: str,
    complete_request_id: str | None,
    object_manifest: dict[str, object],
) -> tuple[SupportReportSnapshot, bool]:
    row = await _require_report_row(db, report_id)
    should_notify = row.slack_notified_at is None
    if row.status != "completed":
        row.status = "completed"
        row.completed_at = utcnow()
    row.complete_request_id = complete_request_id
    row.object_manifest_json = _dump_json(object_manifest)
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row), should_notify


async def mark_report_slack_notified(
    db: AsyncSession,
    *,
    report_id: str,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    row.slack_notified_at = utcnow()
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def mark_cloud_diagnostics_status(
    db: AsyncSession,
    *,
    report_id: str,
    status: str,
    error: str | None = None,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    now = utcnow()
    row.cloud_diagnostics_status = status
    row.cloud_diagnostics_error = error
    if status == "running":
        row.cloud_diagnostics_started_at = now
    if status in {"completed", "failed", "skipped"}:
        row.cloud_diagnostics_completed_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def _require_report_row(db: AsyncSession, report_id: str) -> SupportReport:
    row = await db.get(SupportReport, report_id)
    if row is None:
        raise LookupError(f"Support report not found: {report_id}")
    return row


def _snapshot(row: SupportReport) -> SupportReportSnapshot:
    return SupportReportSnapshot(
        id=row.id,
        client_job_id=row.client_job_id,
        owner_user_id=row.owner_user_id,
        primary_organization_id=row.primary_organization_id,
        primary_tenant_id=row.primary_tenant_id,
        tenant_ids=tuple(str(item) for item in _load_json(row.tenant_ids_json, [])),
        status=row.status,
        s3_bucket=row.s3_bucket,
        s3_prefix=row.s3_prefix,
        source_surface=row.source_surface,
        source_context=_dict_json(row.source_context_json),
        workspace_refs=tuple(
            item for item in _load_json(row.workspace_refs_json, []) if isinstance(item, dict)
        ),
        telemetry_refs=_dict_json(row.telemetry_refs_json),
        object_manifest=_dict_json(row.object_manifest_json),
        request_id=row.request_id,
        complete_request_id=row.complete_request_id,
        request_object_written_at=row.request_object_written_at,
        cloud_diagnostics_status=row.cloud_diagnostics_status,
        cloud_diagnostics_error=row.cloud_diagnostics_error,
        cloud_diagnostics_started_at=row.cloud_diagnostics_started_at,
        cloud_diagnostics_completed_at=row.cloud_diagnostics_completed_at,
        slack_notified_at=row.slack_notified_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


def _dict_json(raw: str) -> dict[str, object]:
    value = _load_json(raw, {})
    return value if isinstance(value, dict) else {}


def _load_json(raw: str, fallback: object) -> object:
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


def _dump_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
