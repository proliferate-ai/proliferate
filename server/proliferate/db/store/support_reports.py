"""Persistence helpers for support reports."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.support import SupportReport
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SupportFeedReportRow:
    """Privacy-safe projection of a completed report for the internal feed.

    Only fields the feed may expose are read. The account email is never
    selected; ``owner_outreach_email`` is the explicit outreach override only.
    """

    id: str
    owner_user_id: UUID
    kind: str
    tracker_summary: str | None
    client_release_id: str | None
    notify_me: bool
    credit_consent: bool
    credit_name: str | None
    owner_outreach_email: str | None
    telemetry_refs: dict[str, object]
    created_at: datetime
    completed_at: datetime


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
    expected_uploads: dict[str, object]
    public_content_consent: bool
    kind: str
    credit_consent: bool
    credit_name: str | None
    client_release_id: str | None
    client_release_provided: bool
    tracker_summary: str | None
    urgent: bool
    notify_me: bool
    request_id: str | None
    complete_request_id: str | None
    request_object_written_at: datetime | None
    cloud_diagnostics_status: str
    cloud_diagnostics_error: str | None
    cloud_diagnostics_started_at: datetime | None
    cloud_diagnostics_completed_at: datetime | None
    slack_notified_at: datetime | None
    tracker_status: str
    tracker_attempt_count: int
    tracker_next_attempt_at: datetime | None
    tracker_locked_until: datetime | None
    tracker_synced_at: datetime | None
    tracker_slack_notified_at: datetime | None
    tracker_last_error_code: str | None
    tracker_last_error_message: str | None
    github_status: str
    github_issue_id: str | None
    github_issue_number: int | None
    github_issue_url: str | None
    github_synced_at: datetime | None
    github_create_attempted_at: datetime | None
    linear_status: str
    linear_issue_id: str | None
    linear_issue_identifier: str | None
    linear_issue_url: str | None
    linear_synced_at: datetime | None
    linear_create_attempted_at: datetime | None
    crosslink_status: str
    crosslink_synced_at: datetime | None
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
    expected_uploads: dict[str, object],
    public_content_consent: bool,
    kind: str,
    credit_consent: bool,
    credit_name: str | None = None,
    client_release_id: str | None = None,
    client_release_provided: bool = False,
    tracker_summary: str | None = None,
    urgent: bool = False,
    notify_me: bool = False,
    request_id: str | None = None,
    cloud_diagnostics_status: str = "not_applicable",
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
        expected_uploads_json=_dump_json(expected_uploads),
        public_content_consent=public_content_consent,
        kind=kind,
        credit_consent=credit_consent,
        credit_name=credit_name,
        client_release_id=client_release_id,
        client_release_provided=client_release_provided,
        tracker_summary=tracker_summary,
        urgent=urgent,
        notify_me=notify_me,
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
    tracker_status: str | None = None,
    github_status: str | None = None,
    linear_status: str | None = None,
    crosslink_status: str | None = None,
) -> tuple[SupportReportSnapshot, bool]:
    row = await _require_report_row(db, report_id)
    should_notify = row.slack_notified_at is None
    if row.status != "completed":
        row.status = "completed"
        row.completed_at = utcnow()
    row.complete_request_id = complete_request_id
    row.object_manifest_json = _dump_json(object_manifest)
    if tracker_status is not None:
        row.tracker_status = tracker_status
        row.tracker_next_attempt_at = utcnow() if tracker_status == "pending" else None
    if github_status is not None:
        row.github_status = github_status
    if linear_status is not None:
        row.linear_status = linear_status
    if crosslink_status is not None:
        row.crosslink_status = crosslink_status
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


async def get_tracker_status(
    db: AsyncSession,
    *,
    report_id: str,
) -> SupportReportSnapshot:
    return await _require_report(db, report_id)


async def claim_due_tracker_report(
    db: AsyncSession,
    *,
    report_id: str | None = None,
    lease_seconds: int = 300,
) -> SupportReportSnapshot | None:
    now = utcnow()
    query = (
        select(SupportReport)
        .where(
            SupportReport.status == "completed",
            SupportReport.tracker_status.in_(
                ("pending", "partial", "failed_retryable", "in_progress")
            ),
            or_(
                SupportReport.tracker_next_attempt_at.is_(None),
                SupportReport.tracker_next_attempt_at <= now,
            ),
            or_(
                SupportReport.tracker_locked_until.is_(None),
                SupportReport.tracker_locked_until <= now,
            ),
        )
        .order_by(SupportReport.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if report_id is not None:
        query = query.where(SupportReport.id == report_id)
    row = (await db.execute(query)).scalar_one_or_none()
    if row is None:
        return None
    row.tracker_status = "in_progress"
    row.tracker_attempt_count = (row.tracker_attempt_count or 0) + 1
    row.tracker_locked_until = now + timedelta(seconds=lease_seconds)
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def record_tracker_success(
    db: AsyncSession,
    *,
    report_id: str,
    tracker_status: str,
    github_status: str,
    linear_status: str,
    crosslink_status: str,
    github_issue_id: str | None,
    github_issue_number: int | None,
    github_issue_url: str | None,
    linear_issue_id: str | None,
    linear_issue_identifier: str | None,
    linear_issue_url: str | None,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    now = utcnow()
    row.tracker_status = tracker_status
    row.tracker_synced_at = now
    row.tracker_locked_until = None
    row.tracker_next_attempt_at = None if tracker_status in {"completed", "disabled"} else now
    row.tracker_last_error_code = None
    row.tracker_last_error_message = None
    row.github_status = github_status
    row.linear_status = linear_status
    row.crosslink_status = crosslink_status
    if github_issue_id is not None:
        row.github_issue_id = github_issue_id
        row.github_issue_number = github_issue_number
        row.github_issue_url = github_issue_url
        row.github_synced_at = now
        row.github_create_attempted_at = row.github_create_attempted_at or now
    if linear_issue_id is not None:
        row.linear_issue_id = linear_issue_id
        row.linear_issue_identifier = linear_issue_identifier
        row.linear_issue_url = linear_issue_url
        row.linear_synced_at = now
        row.linear_create_attempted_at = row.linear_create_attempted_at or now
    if crosslink_status == "completed":
        row.crosslink_synced_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def record_tracker_failure(
    db: AsyncSession,
    *,
    report_id: str,
    status: str,
    error_code: str,
    error_message: str,
    next_attempt_at: datetime | None,
    github_status: str | None = None,
    linear_status: str | None = None,
    crosslink_status: str | None = None,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    row.tracker_status = status
    row.tracker_locked_until = None
    row.tracker_next_attempt_at = next_attempt_at
    row.tracker_last_error_code = error_code[:128]
    row.tracker_last_error_message = error_message[:2000]
    if github_status is not None:
        row.github_status = github_status
    if linear_status is not None:
        row.linear_status = linear_status
    if crosslink_status is not None:
        row.crosslink_status = crosslink_status
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def mark_tracker_slack_notified(
    db: AsyncSession,
    *,
    report_id: str,
) -> SupportReportSnapshot:
    row = await _require_report_row(db, report_id)
    row.tracker_slack_notified_at = utcnow()
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def list_completed_reports_for_feed(
    db: AsyncSession,
    *,
    after_completed_at: datetime | None,
    after_id: str | None,
    limit: int,
) -> list[SupportFeedReportRow]:
    """Return completed reports ordered by ``(completed_at, id)``.

    An empty cursor (both bounds ``None``) starts from the oldest completion.
    The caller reads ``limit + 1`` to determine ``hasMore``.
    """

    query = (
        select(SupportReport, User.outreach_email)
        .join(User, User.id == SupportReport.owner_user_id)
        .where(
            SupportReport.status == "completed",
            SupportReport.completed_at.is_not(None),
        )
        .order_by(SupportReport.completed_at.asc(), SupportReport.id.asc())
        .limit(limit)
    )
    if after_completed_at is not None and after_id is not None:
        query = query.where(
            tuple_(SupportReport.completed_at, SupportReport.id) > (after_completed_at, after_id)
        )
    rows = (await db.execute(query)).all()
    return [_feed_row(report, outreach_email) for report, outreach_email in rows]


def _feed_row(row: SupportReport, owner_outreach_email: str | None) -> SupportFeedReportRow:
    assert row.completed_at is not None
    return SupportFeedReportRow(
        id=row.id,
        owner_user_id=row.owner_user_id,
        kind=row.kind,
        tracker_summary=row.tracker_summary,
        client_release_id=row.client_release_id,
        notify_me=row.notify_me,
        credit_consent=row.credit_consent,
        credit_name=row.credit_name,
        owner_outreach_email=owner_outreach_email,
        telemetry_refs=_dict_json(row.telemetry_refs_json),
        created_at=row.created_at,
        completed_at=row.completed_at,
    )


async def _require_report_row(db: AsyncSession, report_id: str) -> SupportReport:
    row = await db.get(SupportReport, report_id)
    if row is None:
        raise LookupError(f"Support report not found: {report_id}")
    return row


async def _require_report(db: AsyncSession, report_id: str) -> SupportReportSnapshot:
    return _snapshot(await _require_report_row(db, report_id))


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
        expected_uploads=_dict_json(row.expected_uploads_json),
        public_content_consent=row.public_content_consent,
        kind=row.kind,
        credit_consent=row.credit_consent,
        credit_name=row.credit_name,
        client_release_id=row.client_release_id,
        client_release_provided=row.client_release_provided,
        tracker_summary=row.tracker_summary,
        urgent=row.urgent,
        notify_me=row.notify_me,
        request_id=row.request_id,
        complete_request_id=row.complete_request_id,
        request_object_written_at=row.request_object_written_at,
        cloud_diagnostics_status=row.cloud_diagnostics_status,
        cloud_diagnostics_error=row.cloud_diagnostics_error,
        cloud_diagnostics_started_at=row.cloud_diagnostics_started_at,
        cloud_diagnostics_completed_at=row.cloud_diagnostics_completed_at,
        slack_notified_at=row.slack_notified_at,
        tracker_status=row.tracker_status,
        tracker_attempt_count=row.tracker_attempt_count,
        tracker_next_attempt_at=row.tracker_next_attempt_at,
        tracker_locked_until=row.tracker_locked_until,
        tracker_synced_at=row.tracker_synced_at,
        tracker_slack_notified_at=row.tracker_slack_notified_at,
        tracker_last_error_code=row.tracker_last_error_code,
        tracker_last_error_message=row.tracker_last_error_message,
        github_status=row.github_status,
        github_issue_id=row.github_issue_id,
        github_issue_number=row.github_issue_number,
        github_issue_url=row.github_issue_url,
        github_synced_at=row.github_synced_at,
        github_create_attempted_at=row.github_create_attempted_at,
        linear_status=row.linear_status,
        linear_issue_id=row.linear_issue_id,
        linear_issue_identifier=row.linear_issue_identifier,
        linear_issue_url=row.linear_issue_url,
        linear_synced_at=row.linear_synced_at,
        linear_create_attempted_at=row.linear_create_attempted_at,
        crosslink_status=row.crosslink_status,
        crosslink_synced_at=row.crosslink_synced_at,
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
