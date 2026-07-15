from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from proliferate.config import settings
from proliferate.db.store import support_reports
from proliferate.server.support.domain.report_records import safe_file_name
from proliferate.server.support.errors import (
    SupportReportStorageUnavailable,
    SupportReportUploadConflict,
    SupportReportUploadInvalid,
)
from proliferate.server.support.models import (
    SupportReportAttachmentUploadTarget,
    SupportReportUploadRequest,
    SupportReportUploadResponse,
    SupportReportUploadTargetsRequest,
)
from proliferate.server.support.storage import presign_support_upload_target


@dataclass(frozen=True)
class ExpectedCompletedObject:
    size_bytes: int


def validate_report_scope(scope: object) -> None:
    kind = getattr(scope, "kind", None)
    workspace_ids = getattr(scope, "workspace_ids", [])
    if kind == "choose_workspace" and not workspace_ids:
        raise SupportReportUploadInvalid("Choose at least one workspace.")


def validate_report_upload_request(body: SupportReportUploadRequest) -> None:
    validate_report_scope(body.scope)
    validate_upload_target_request(
        SupportReportUploadTargetsRequest(
            diagnostics=body.diagnostics,
            attachments=body.attachments,
        )
    )


def validate_upload_target_request(body: SupportReportUploadTargetsRequest) -> None:
    if (
        body.diagnostics
        and body.diagnostics.size_bytes > settings.support_report_diagnostics_max_bytes
    ):
        raise SupportReportUploadInvalid("Diagnostics payload is too large.")

    total_attachment_bytes = 0
    seen_client_file_ids: set[str] = set()
    for attachment in body.attachments:
        if attachment.client_file_id in seen_client_file_ids:
            raise SupportReportUploadInvalid("Attachment file IDs must be unique.")
        seen_client_file_ids.add(attachment.client_file_id)
        if attachment.size_bytes > settings.support_report_attachment_max_bytes:
            raise SupportReportUploadInvalid(f"Attachment is too large: {attachment.file_name}")
        total_attachment_bytes += attachment.size_bytes
    if total_attachment_bytes > settings.support_report_total_attachment_max_bytes:
        raise SupportReportUploadInvalid("Attachments are too large.")


def validate_uploads_match_expected_intent(
    report: support_reports.SupportReportSnapshot,
    body: SupportReportUploadTargetsRequest,
) -> None:
    expected = report.expected_uploads
    if not expected:
        return
    expected_diagnostics = expected.get("diagnostics") is True
    expected_attachment_count = int_or_zero(expected.get("attachmentCount"))
    if (body.diagnostics is not None) != expected_diagnostics:
        raise SupportReportUploadConflict(
            "Support report upload targets changed diagnostics intent."
        )
    if len(body.attachments) != expected_attachment_count:
        raise SupportReportUploadConflict(
            "Support report upload targets changed attachment intent."
        )


def expected_uploads_allow_zero_upload(expected: dict[str, object]) -> bool:
    return (
        expected.get("diagnostics") is False and int_or_zero(expected.get("attachmentCount")) == 0
    )


def int_or_zero(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


def expected_completed_object_entry(
    expected_entries: dict[str, dict[str, object]],
    *,
    object_key: str,
    size_bytes: int,
    sha256: str,
) -> ExpectedCompletedObject:
    # Both `size_bytes`/`sha256` here and the manifest entry are client-supplied,
    # so this is a consistency check (the completion call agrees with the
    # upload-targets call), not an integrity check. Only the object *size* is
    # independently verified against S3 in `verify_completed_support_object`;
    # sha256 is not head-verified, so it is not a content-integrity guarantee.
    expected = expected_entries.get(object_key)
    expected_size = expected.get("sizeBytes") if expected else None
    expected_sha256 = expected.get("sha256") if expected else None
    if not isinstance(expected_size, int) or expected_size != size_bytes:
        raise SupportReportUploadInvalid("Support report object size did not match upload intent.")
    if not isinstance(expected_sha256, str) or expected_sha256 != sha256:
        raise SupportReportUploadInvalid(
            "Support report object checksum did not match upload intent."
        )
    return ExpectedCompletedObject(size_bytes=expected_size)


async def create_upload_targets_for_report(
    *,
    report: support_reports.SupportReportSnapshot,
    body: SupportReportUploadTargetsRequest,
) -> SupportReportUploadResponse:
    expires_seconds = settings.support_report_upload_url_expires_seconds
    region = support_report_region()

    diagnostics_target = None
    if body.diagnostics is not None:
        diagnostics_target = await presign_support_upload_target(
            bucket=report.s3_bucket,
            key=f"{report.s3_prefix}/diagnostics.json",
            content_type=body.diagnostics.content_type,
            max_size_bytes=settings.support_report_diagnostics_max_bytes,
            expires_seconds=expires_seconds,
            region_name=region,
        )

    attachment_targets: list[SupportReportAttachmentUploadTarget] = []
    for attachment in body.attachments:
        target = await presign_support_upload_target(
            bucket=report.s3_bucket,
            key=(
                f"{report.s3_prefix}/attachments/{attachment.client_file_id}/"
                f"{safe_file_name(attachment.file_name)}"
            ),
            content_type=attachment.content_type,
            max_size_bytes=settings.support_report_attachment_max_bytes,
            expires_seconds=expires_seconds,
            region_name=region,
        )
        attachment_targets.append(
            SupportReportAttachmentUploadTarget(
                clientFileId=attachment.client_file_id,
                objectKey=target.object_key,
                putUrl=target.put_url,
                contentType=target.content_type,
                maxSizeBytes=target.max_size_bytes,
                expiresInSeconds=target.expires_in_seconds,
                headers=target.headers,
            )
        )

    return SupportReportUploadResponse(
        reportId=report.id,
        diagnostics=diagnostics_target,
        attachments=attachment_targets,
    )


def support_report_bucket() -> str:
    bucket = settings.support_report_s3_bucket.strip()
    if not bucket:
        raise SupportReportStorageUnavailable()
    return bucket


def support_report_region() -> str | None:
    region = settings.support_report_s3_region.strip()
    return region or None


def report_prefix(report_id: str) -> str:
    cleaned_prefix = settings.support_report_s3_prefix.strip().strip("/")
    if not report_id or not all(char.isalnum() or char in {"-", "_"} for char in report_id):
        raise SupportReportUploadInvalid("Invalid support report ID.")
    day = datetime.now(UTC).strftime("%Y/%m/%d")
    return "/".join(part for part in [cleaned_prefix, day, report_id] if part)
