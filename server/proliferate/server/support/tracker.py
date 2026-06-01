"""Support report tracker orchestration."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store import support_reports
from proliferate.integrations.aws import (
    AwsIntegrationError,
    get_json_object,
    put_json_object,
)
from proliferate.integrations.github import issues as github_issues
from proliferate.integrations.linear import LinearIssue
from proliferate.integrations.linear import (
    ensure_support_issue as ensure_linear_support_issue,
)
from proliferate.integrations.linear import (
    support_report_marker as linear_support_report_marker,
)
from proliferate.server.support.notifications import notify_support_report_tracker
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TrackerOutcome:
    tracker_status: str
    github_status: str
    linear_status: str
    crosslink_status: str
    github_issue_id: str | None = None
    github_issue_number: int | None = None
    github_issue_url: str | None = None
    linear_issue_id: str | None = None
    linear_issue_identifier: str | None = None
    linear_issue_url: str | None = None


async def ensure_support_tracker_for_report(report_id: str) -> None:
    await run_support_tracker_reconcile_pass(report_id=report_id, limit=1)


async def run_support_tracker_reconcile_pass(
    *,
    report_id: str | None = None,
    limit: int | None = None,
) -> int:
    if not settings.support_tracker_enabled:
        return 0
    processed = 0
    batch_limit = limit if limit is not None else settings.support_tracker_reconciler_batch_size
    for _ in range(max(batch_limit, 0)):
        report = await _claim_tracker_report(report_id=report_id)
        if report is None:
            break
        processed += 1
        await _process_claimed_report(report)
        if report_id is not None:
            break
    return processed


async def _claim_tracker_report(
    *,
    report_id: str | None,
) -> support_reports.SupportReportSnapshot | None:
    async with db_engine.async_session_factory() as db, db.begin():
        return await support_reports.claim_due_tracker_report(
            db,
            report_id=report_id,
            lease_seconds=300,
        )


async def _process_claimed_report(report: support_reports.SupportReportSnapshot) -> None:
    try:
        if not _github_configured():
            await _record_failure(
                report,
                status="failed_permanent",
                error_code="github_unconfigured",
                error_message="Support GitHub issue tracker is not configured.",
                retryable=False,
                github_status="failed_permanent",
                linear_status=report.linear_status,
                crosslink_status=report.crosslink_status,
            )
            return
        request_record = await _load_request_record(report)
        outcome = await _ensure_vendor_issues(report, request_record)
        synced_report = await _record_success(report, outcome)
        await _write_tracker_record(synced_report)
        if synced_report.tracker_slack_notified_at is None and (
            synced_report.github_issue_url or synced_report.linear_issue_url
        ):
            notified = await notify_support_report_tracker(
                report_id=synced_report.id,
                github_issue_url=synced_report.github_issue_url,
                linear_issue_url=synced_report.linear_issue_url,
            )
            if notified:
                await _mark_tracker_slack_notified(synced_report.id)
    except Exception as exc:
        logger.exception(
            "Support tracker processing failed.",
            extra={"support_report_id": report.id},
        )
        await _record_failure(
            report,
            status=_retry_status(report),
            error_code=exc.__class__.__name__,
            error_message=str(exc) or "Support tracker processing failed.",
            retryable=True,
            github_status=(
                "failed_retryable" if report.github_status in {"pending", "none"} else None
            ),
            linear_status=(
                "failed_retryable" if report.linear_status in {"pending", "none"} else None
            ),
            crosslink_status=(
                "failed_retryable" if report.crosslink_status in {"pending", "none"} else None
            ),
        )


async def _ensure_vendor_issues(
    report: support_reports.SupportReportSnapshot,
    request_record: dict[str, object],
) -> TrackerOutcome:
    github_issue = await github_issues.ensure_support_issue(
        app_id=settings.support_github_app_id.strip(),
        private_key=settings.support_github_app_private_key.strip(),
        installation_id=settings.support_github_app_installation_id.strip(),
        owner=settings.support_github_owner.strip(),
        repo=settings.support_github_repo.strip(),
        report_id=report.id,
        title=_issue_title(report, request_record),
        body=_github_issue_body(
            report=report,
            request_record=request_record,
            linear_issue_url=report.linear_issue_url,
        ),
        labels=_github_labels(report),
    )

    linear_issue: LinearIssue | None = None
    linear_status = "disabled"
    if _linear_configured():
        try:
            linear_issue = await ensure_linear_support_issue(
                api_key=settings.support_linear_api_key.strip(),
                team_id=settings.support_linear_team_id.strip(),
                project_id=_blank_to_none(settings.support_linear_project_id),
                label_ids=_linear_label_ids(report),
                report_id=report.id,
                title=_issue_title(report, request_record),
                description=_linear_issue_description(
                    report=report,
                    request_record=request_record,
                    github_issue_url=github_issue.url,
                ),
            )
            linear_status = "completed"
        except Exception:
            logger.exception(
                "Support tracker Linear issue creation failed.",
                extra={"support_report_id": report.id},
            )
            linear_status = "failed_retryable"

    crosslink_status = "disabled"
    if linear_issue is not None:
        updated_github_issue = await github_issues.ensure_support_issue(
            app_id=settings.support_github_app_id.strip(),
            private_key=settings.support_github_app_private_key.strip(),
            installation_id=settings.support_github_app_installation_id.strip(),
            owner=settings.support_github_owner.strip(),
            repo=settings.support_github_repo.strip(),
            report_id=report.id,
            title=_issue_title(report, request_record),
            body=_github_issue_body(
                report=report,
                request_record=request_record,
                linear_issue_url=linear_issue.url,
            ),
            labels=_github_labels(report),
        )
        github_issue = updated_github_issue
        crosslink_status = "completed"
    elif _linear_configured():
        crosslink_status = "failed_retryable"

    tracker_status = (
        "completed"
        if (
            linear_status in {"completed", "disabled"}
            and crosslink_status in {"completed", "disabled"}
        )
        else "partial"
    )
    return TrackerOutcome(
        tracker_status=tracker_status,
        github_status="completed",
        linear_status=linear_status,
        crosslink_status=crosslink_status,
        github_issue_id=github_issue.id,
        github_issue_number=github_issue.number,
        github_issue_url=github_issue.url,
        linear_issue_id=linear_issue.id if linear_issue else report.linear_issue_id,
        linear_issue_identifier=(
            linear_issue.identifier if linear_issue else report.linear_issue_identifier
        ),
        linear_issue_url=linear_issue.url if linear_issue else report.linear_issue_url,
    )


async def _record_success(
    report: support_reports.SupportReportSnapshot,
    outcome: TrackerOutcome,
) -> support_reports.SupportReportSnapshot:
    async with db_engine.async_session_factory() as db, db.begin():
        return await support_reports.record_tracker_success(
            db,
            report_id=report.id,
            tracker_status=outcome.tracker_status,
            github_status=outcome.github_status,
            linear_status=outcome.linear_status,
            crosslink_status=outcome.crosslink_status,
            github_issue_id=outcome.github_issue_id,
            github_issue_number=outcome.github_issue_number,
            github_issue_url=outcome.github_issue_url,
            linear_issue_id=outcome.linear_issue_id,
            linear_issue_identifier=outcome.linear_issue_identifier,
            linear_issue_url=outcome.linear_issue_url,
        )


async def _record_failure(
    report: support_reports.SupportReportSnapshot,
    *,
    status: str,
    error_code: str,
    error_message: str,
    retryable: bool,
    github_status: str | None,
    linear_status: str | None,
    crosslink_status: str | None,
) -> None:
    next_attempt_at = (
        utcnow()
        + timedelta(
            seconds=min(
                settings.support_tracker_retry_base_seconds
                * (2 ** max(report.tracker_attempt_count - 1, 0)),
                3600,
            )
        )
        if retryable and status == "failed_retryable"
        else None
    )
    async with db_engine.async_session_factory() as db, db.begin():
        await support_reports.record_tracker_failure(
            db,
            report_id=report.id,
            status=status,
            error_code=error_code,
            error_message=error_message,
            next_attempt_at=next_attempt_at,
            github_status=github_status,
            linear_status=linear_status,
            crosslink_status=crosslink_status,
        )


async def _mark_tracker_slack_notified(report_id: str) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await support_reports.mark_tracker_slack_notified(db, report_id=report_id)


async def _load_request_record(
    report: support_reports.SupportReportSnapshot,
) -> dict[str, object]:
    try:
        return await get_json_object(
            bucket=report.s3_bucket,
            key=f"{report.s3_prefix}/request.json",
            region_name=_support_report_region(),
        )
    except AwsIntegrationError as exc:
        raise RuntimeError("Support report request record is unavailable.") from exc


async def _write_tracker_record(report: support_reports.SupportReportSnapshot) -> None:
    record = {
        "schemaVersion": 1,
        "reportId": report.id,
        "trackerStatus": report.tracker_status,
        "github": {
            "status": report.github_status,
            "issueId": report.github_issue_id,
            "issueNumber": report.github_issue_number,
            "url": report.github_issue_url,
        },
        "linear": {
            "status": report.linear_status,
            "issueId": report.linear_issue_id,
            "identifier": report.linear_issue_identifier,
            "url": report.linear_issue_url,
        },
        "crosslinkStatus": report.crosslink_status,
        "syncedAt": utcnow().isoformat(),
    }
    try:
        await put_json_object(
            bucket=report.s3_bucket,
            key=f"{report.s3_prefix}/tracker.json",
            value=record,
            region_name=_support_report_region(),
        )
    except AwsIntegrationError:
        logger.exception(
            "Support tracker record could not be written.",
            extra={"support_report_id": report.id},
        )


def _github_issue_body(
    *,
    report: support_reports.SupportReportSnapshot,
    request_record: dict[str, object],
    linear_issue_url: str | None,
) -> str:
    lines = [
        github_issues.support_report_marker(report.id),
        f"Support report: `{report.id}`",
        "",
    ]
    if linear_issue_url:
        lines.extend([f"Linear: {linear_issue_url}", ""])
    lines.extend(_public_content_lines(report, request_record))
    lines.extend(
        [
            "Internal diagnostics are stored in the private support report bundle.",
            _internal_report_line(report.id),
        ]
    )
    return "\n".join(line for line in lines if line is not None).strip()


def _linear_issue_description(
    *,
    report: support_reports.SupportReportSnapshot,
    request_record: dict[str, object],
    github_issue_url: str | None,
) -> str:
    lines = [
        linear_support_report_marker(report.id),
        f"Support report: `{report.id}`",
        "",
        f"GitHub: {github_issue_url}" if github_issue_url else None,
        _internal_report_line(report.id),
        "",
    ]
    lines.extend(_public_content_lines(report, request_record))
    return "\n".join(line for line in lines if line is not None).strip()


def _public_content_lines(
    report: support_reports.SupportReportSnapshot,
    request_record: dict[str, object],
) -> list[str]:
    if not report.public_content_consent:
        return [
            "The submitter did not opt in to publishing their issue text publicly.",
            "",
        ]
    lines = [
        "## User report",
        "",
        str(request_record.get("message") or "").strip() or "(no message provided)",
        "",
    ]
    attachments = _attachment_names(request_record)
    if attachments:
        lines.extend(
            [
                "## Attachments",
                "",
                *[f"- {name}" for name in attachments],
                "",
            ]
        )
    return lines


def _attachment_names(request_record: dict[str, object]) -> list[str]:
    objects = request_record.get("objects")
    if not isinstance(objects, dict):
        return []
    attachments = objects.get("attachments")
    if not isinstance(attachments, list):
        return []
    names: list[str] = []
    for item in attachments:
        if isinstance(item, dict) and isinstance(item.get("fileName"), str):
            names.append(str(item["fileName"]))
    return names[:20]


def _issue_title(
    report: support_reports.SupportReportSnapshot,
    request_record: dict[str, object],
) -> str:
    if not report.public_content_consent:
        return f"Bug Report: Support report {report.id}"
    message = str(request_record.get("message") or "").strip().replace("\n", " ")
    summary = message[:80].strip() or "Support issue"
    return f"Bug Report: {summary}"


def _internal_report_line(report_id: str) -> str:
    base_url = settings.support_report_internal_base_url.strip().rstrip("/")
    if not base_url:
        return f"Internal report ID: `{report_id}`"
    return f"Internal report: {base_url}/{report_id}"


def _github_labels(report: support_reports.SupportReportSnapshot) -> tuple[str, ...]:
    labels = [settings.support_github_label_support.strip()]
    if not report.public_content_consent:
        labels.append(settings.support_github_label_private.strip())
    return tuple(label for label in labels if label)


def _linear_label_ids(report: support_reports.SupportReportSnapshot) -> tuple[str, ...]:
    label_ids = [
        label_id.strip()
        for label_id in settings.support_linear_label_ids.split(",")
        if label_id.strip()
    ]
    private_details_label_id = settings.support_linear_private_details_label_id.strip()
    if not report.public_content_consent and private_details_label_id:
        label_ids.append(private_details_label_id)
    return tuple(dict.fromkeys(label_ids))


def _github_configured() -> bool:
    return all(
        value.strip()
        for value in (
            settings.support_github_app_id,
            settings.support_github_app_private_key,
            settings.support_github_app_installation_id,
            settings.support_github_owner,
            settings.support_github_repo,
        )
    )


def _linear_configured() -> bool:
    return bool(
        settings.support_linear_api_key.strip() and settings.support_linear_team_id.strip()
    )


def _retry_status(report: support_reports.SupportReportSnapshot) -> str:
    if report.tracker_attempt_count >= settings.support_tracker_max_attempts:
        return "failed_permanent"
    return "failed_retryable"


def _blank_to_none(value: str) -> str | None:
    cleaned = value.strip()
    return cleaned or None


def _support_report_region() -> str | None:
    region = settings.support_report_s3_region.strip()
    return region or None
