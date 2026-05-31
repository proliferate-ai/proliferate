from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import support_diagnostics as diagnostics_store
from proliferate.db.store import support_reports
from proliferate.integrations.aws import (
    AwsIntegrationError,
    get_json_object,
    put_json_object,
)
from proliferate.integrations.sentry import set_server_sentry_correlation_context
from proliferate.middleware.request_context import (
    get_correlation_context,
    get_request_id,
    set_resource_tenant_context,
    set_support_report_context,
)
from proliferate.server.support.domain.report_records import (
    cloud_workspace_ids_from_refs,
    expected_manifest_keys,
    expected_upload_keys,
    now_iso,
    object_manifest_from_targets,
    safe_file_name,
    support_context_record,
    support_request_record,
    support_scope_record,
    tenant_context_for_report,
    trusted_workspace_refs_for_report,
    workspace_refs_for_create,
)
from proliferate.server.support.errors import (
    SupportReportStorageUnavailable,
    SupportReportUploadInvalid,
)
from proliferate.server.support.models import (
    SupportReportAttachmentUploadTarget,
    SupportReportCompleteRequest,
    SupportReportCompleteResponse,
    SupportReportCreateRequest,
    SupportReportCreateResponse,
    SupportReportUploadRequest,
    SupportReportUploadResponse,
    SupportReportUploadTargetsRequest,
    support_report_correlation_record,
    support_report_create_response,
)
from proliferate.server.support.notifications import (
    notify_support_report,
)
from proliferate.server.support.storage import (
    presign_support_upload_target,
    verify_completed_support_object,
)

logger = logging.getLogger(__name__)


async def create_support_report(
    *,
    db: AsyncSession,
    sender_user_id: UUID,
    sender_email: str,
    sender_display_name: str | None,
    body: SupportReportCreateRequest,
) -> SupportReportCreateResponse:
    _validate_report_scope(body.scope)
    _support_report_bucket()
    workspace_refs = workspace_refs_for_create(body)
    authorized_cloud_refs = await _authorized_cloud_refs(
        db,
        sender_user_id=sender_user_id,
        workspace_refs=workspace_refs,
    )
    trusted_workspace_refs = trusted_workspace_refs_for_report(
        workspace_refs,
        authorized_cloud_refs,
    )
    tenant_context = tenant_context_for_report(
        sender_user_id=sender_user_id,
        authorized_cloud_refs=authorized_cloud_refs,
    )

    existing = await support_reports.get_report_by_owner_client_job(
        db,
        owner_user_id=sender_user_id,
        client_job_id=body.client_job_id,
    )
    if existing and existing.request_object_written_at is not None:
        _install_report_correlation(existing)
        return support_report_create_response(existing)

    report = existing
    if report is None:
        report_id = uuid4().hex
        report = await support_reports.create_report(
            db,
            report_id=report_id,
            client_job_id=body.client_job_id,
            owner_user_id=sender_user_id,
            primary_organization_id=tenant_context.primary_organization_id,
            primary_tenant_id=tenant_context.primary_tenant_id,
            tenant_ids=tenant_context.tenant_ids,
            s3_bucket=_support_report_bucket(),
            s3_prefix=_report_prefix(report_id),
            source_surface=body.source_surface,
            source_context=support_context_record(body.context),
            workspace_refs=trusted_workspace_refs,
            telemetry_refs=(
                body.telemetry_refs.model_dump(by_alias=True, exclude_none=True)
                if body.telemetry_refs
                else {}
            ),
            request_id=get_request_id(),
            cloud_diagnostics_status="pending" if authorized_cloud_refs else "not_applicable",
        )

    _install_report_correlation(report)
    request_record = support_request_record(
        report=report,
        sender_email=sender_email,
        sender_display_name=sender_display_name,
        message=body.message,
        scope=support_scope_record(body.scope, report.workspace_refs),
        correlation=support_report_correlation_record(report),
    )
    try:
        await put_json_object(
            bucket=report.s3_bucket,
            key=f"{report.s3_prefix}/request.json",
            value=request_record,
            region_name=_support_report_region(),
        )
    except AwsIntegrationError as exc:
        raise SupportReportStorageUnavailable() from exc

    report = await support_reports.mark_request_object_written(db, report_id=report.id)
    logger.info(
        "Support report created.",
        extra={
            "support_report_id": report.id,
            "support_report_status": report.status,
            "support_report_source_surface": report.source_surface,
            "support_report_cloud_diagnostics_status": report.cloud_diagnostics_status,
        },
    )
    return support_report_create_response(report)


async def create_support_report_upload_targets(
    *,
    db: AsyncSession,
    sender_user_id: UUID,
    report_id: str,
    body: SupportReportUploadTargetsRequest,
) -> SupportReportUploadResponse:
    report = await support_reports.get_report_by_id(db, report_id)
    if report is None or report.owner_user_id != sender_user_id:
        raise SupportReportUploadInvalid("Unknown support report upload.")
    if report.status not in {"created", "uploading"}:
        raise SupportReportUploadInvalid("Support report upload is already completed.")

    _install_report_correlation(report)
    _validate_upload_target_request(body)
    targets = await _create_upload_targets_for_report(report=report, body=body)
    manifest = object_manifest_from_targets(
        diagnostics=body.diagnostics,
        attachments=body.attachments,
        targets=targets,
    )
    existing_manifest = report.object_manifest
    if existing_manifest.get("schemaVersion") == 1 and existing_manifest != manifest:
        raise SupportReportUploadInvalid(
            "Support report upload targets already exist for different objects."
        )
    await support_reports.update_report_upload_manifest(
        db,
        report_id=report.id,
        object_manifest=manifest,
    )
    logger.info(
        "Support report upload targets issued.",
        extra={
            "support_report_id": report.id,
            "support_report_attachment_count": len(body.attachments),
            "support_report_diagnostics_expected": body.diagnostics is not None,
        },
    )
    return targets


async def create_support_report_upload(
    *,
    db: AsyncSession,
    sender_user_id: UUID,
    sender_email: str,
    sender_display_name: str | None,
    body: SupportReportUploadRequest,
) -> SupportReportUploadResponse:
    _validate_report_upload_request(body)
    create_response = await create_support_report(
        db=db,
        sender_user_id=sender_user_id,
        sender_email=sender_email,
        sender_display_name=sender_display_name,
        body=SupportReportCreateRequest(
            clientJobId=uuid4().hex,
            message=body.message,
            sourceSurface="desktop",
            context=body.context,
            scope=body.scope,
            workspaceRefs=[],
            expectedClientUploads={
                "diagnostics": body.diagnostics is not None,
                "attachmentCount": len(body.attachments),
            },
        ),
    )
    return await create_support_report_upload_targets(
        db=db,
        sender_user_id=sender_user_id,
        report_id=create_response.report_id,
        body=SupportReportUploadTargetsRequest(
            diagnostics=body.diagnostics,
            attachments=body.attachments,
        ),
    )


async def complete_support_report_upload(
    *,
    db: AsyncSession,
    sender_user_id: UUID,
    sender_email: str,
    sender_display_name: str | None,
    report_id: str,
    body: SupportReportCompleteRequest,
) -> SupportReportCompleteResponse:
    report = await support_reports.get_report_by_id(db, report_id)
    if report is not None:
        return await _complete_db_backed_report(
            db=db,
            report=report,
            sender_user_id=sender_user_id,
            sender_email=sender_email,
            sender_display_name=sender_display_name,
            body=body,
        )

    return await _complete_legacy_report(
        sender_email=sender_email,
        sender_display_name=sender_display_name,
        report_id=report_id,
        body=body,
    )


async def _complete_db_backed_report(
    *,
    db: AsyncSession,
    report: support_reports.SupportReportSnapshot,
    sender_user_id: UUID,
    sender_email: str,
    sender_display_name: str | None,
    body: SupportReportCompleteRequest,
) -> SupportReportCompleteResponse:
    if report.owner_user_id != sender_user_id:
        raise SupportReportUploadInvalid("Support report upload belongs to another user.")
    if report.status == "completed":
        return SupportReportCompleteResponse(reportId=report.id)

    _install_report_correlation(report)
    expected_keys = expected_manifest_keys(report.object_manifest)
    if report.object_manifest.get("schemaVersion") != 1:
        raise SupportReportUploadInvalid("Support report upload targets have not been created.")
    completed_keys = [
        *([body.diagnostics.object_key] if body.diagnostics else []),
        *[attachment.object_key for attachment in body.attachments],
    ]
    unexpected = sorted(set(completed_keys).difference(expected_keys))
    if unexpected:
        raise SupportReportUploadInvalid("Support report completion included unknown objects.")
    missing = sorted(expected_keys.difference(completed_keys))
    if missing:
        raise SupportReportUploadInvalid("Support report completion is missing expected objects.")

    if body.diagnostics is not None:
        await verify_completed_support_object(
            bucket=report.s3_bucket,
            region_name=_support_report_region(),
            prefix=report.s3_prefix,
            object_key=body.diagnostics.object_key,
            expected_size=body.diagnostics.size_bytes,
        )
    for attachment in body.attachments:
        await verify_completed_support_object(
            bucket=report.s3_bucket,
            region_name=_support_report_region(),
            prefix=report.s3_prefix,
            object_key=attachment.object_key,
            expected_size=attachment.size_bytes,
        )

    complete_record = {
        "schemaVersion": 2,
        "status": "completed",
        "reportId": report.id,
        "requestId": get_request_id(),
        "completedAt": now_iso(),
        "sender": {
            "email": sender_email,
            "displayName": sender_display_name,
        },
        "diagnostics": body.diagnostics.model_dump(by_alias=True) if body.diagnostics else None,
        "attachments": [item.model_dump(by_alias=True) for item in body.attachments],
        "packageManifest": body.package_manifest,
        "cloudDiagnosticsStatus": report.cloud_diagnostics_status,
    }
    try:
        await put_json_object(
            bucket=report.s3_bucket,
            key=f"{report.s3_prefix}/complete.json",
            value=complete_record,
            region_name=_support_report_region(),
        )
    except AwsIntegrationError as exc:
        raise SupportReportStorageUnavailable() from exc

    completed_report, should_notify = await support_reports.mark_report_completed(
        db,
        report_id=report.id,
        complete_request_id=get_request_id(),
        object_manifest={**report.object_manifest, "completed": complete_record},
    )
    logger.info(
        "Support report completed.",
        extra={
            "support_report_id": completed_report.id,
            "support_report_attachment_count": len(body.attachments),
            "support_report_diagnostics_included": body.diagnostics is not None,
            "support_report_cloud_diagnostics_status": completed_report.cloud_diagnostics_status,
        },
    )
    if should_notify:
        await notify_support_report(
            sender_email=sender_email,
            sender_display_name=sender_display_name,
            report_id=completed_report.id,
            s3_prefix=completed_report.s3_prefix,
            message="Support report submitted.",
            context=completed_report.source_context,
            diagnostics_included=body.diagnostics is not None,
            attachment_count=len(body.attachments),
            correlation=support_report_correlation_record(completed_report),
        )
        await support_reports.mark_report_slack_notified(db, report_id=completed_report.id)
    return SupportReportCompleteResponse(reportId=report.id)


async def _complete_legacy_report(
    *,
    sender_email: str,
    sender_display_name: str | None,
    report_id: str,
    body: SupportReportCompleteRequest,
) -> SupportReportCompleteResponse:
    bucket = _support_report_bucket()
    region = _support_report_region()
    prefix = _report_prefix(report_id)

    try:
        request_record = await get_json_object(
            bucket=bucket,
            key=f"{prefix}/request.json",
            region_name=region,
        )
    except AwsIntegrationError as exc:
        raise SupportReportUploadInvalid("Unknown support report upload.") from exc

    sender_record = request_record.get("sender")
    if isinstance(sender_record, dict) and sender_record.get("email") != sender_email:
        raise SupportReportUploadInvalid("Support report upload belongs to another user.")

    expected_keys = expected_upload_keys(request_record)
    completed_keys = [
        *([body.diagnostics.object_key] if body.diagnostics else []),
        *[attachment.object_key for attachment in body.attachments],
    ]
    unexpected = sorted(set(completed_keys).difference(expected_keys))
    if unexpected:
        raise SupportReportUploadInvalid("Support report completion included unknown objects.")

    if body.diagnostics is not None:
        await verify_completed_support_object(
            bucket=bucket,
            region_name=region,
            prefix=prefix,
            object_key=body.diagnostics.object_key,
            expected_size=body.diagnostics.size_bytes,
        )
    for attachment in body.attachments:
        await verify_completed_support_object(
            bucket=bucket,
            region_name=region,
            prefix=prefix,
            object_key=attachment.object_key,
            expected_size=attachment.size_bytes,
        )

    complete_record = {
        "schemaVersion": 1,
        "status": "completed",
        "reportId": report_id,
        "requestId": get_request_id(),
        "completedAt": now_iso(),
        "sender": {
            "email": sender_email,
            "displayName": sender_display_name,
        },
        "diagnostics": body.diagnostics.model_dump(by_alias=True) if body.diagnostics else None,
        "attachments": [attachment.model_dump(by_alias=True) for attachment in body.attachments],
        "packageManifest": body.package_manifest,
    }

    try:
        await put_json_object(
            bucket=bucket,
            key=f"{prefix}/complete.json",
            value=complete_record,
            region_name=region,
        )
    except AwsIntegrationError as exc:
        raise SupportReportStorageUnavailable() from exc

    context_record = request_record.get("context")
    await notify_support_report(
        sender_email=sender_email,
        sender_display_name=sender_display_name,
        report_id=report_id,
        s3_prefix=prefix,
        message=str(request_record.get("message") or "Support report submitted."),
        context=context_record if isinstance(context_record, dict) else None,
        diagnostics_included=body.diagnostics is not None,
        attachment_count=len(body.attachments),
        correlation=None,
    )

    return SupportReportCompleteResponse(reportId=report_id)


def _validate_report_scope(scope: object) -> None:
    kind = getattr(scope, "kind", None)
    workspace_ids = getattr(scope, "workspace_ids", [])
    if kind == "choose_workspace" and not workspace_ids:
        raise SupportReportUploadInvalid("Choose at least one workspace.")


def _validate_report_upload_request(body: SupportReportUploadRequest) -> None:
    _validate_report_scope(body.scope)
    _validate_upload_target_request(
        SupportReportUploadTargetsRequest(
            diagnostics=body.diagnostics,
            attachments=body.attachments,
        )
    )


def _validate_upload_target_request(body: SupportReportUploadTargetsRequest) -> None:
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


async def _create_upload_targets_for_report(
    *,
    report: support_reports.SupportReportSnapshot,
    body: SupportReportUploadTargetsRequest,
) -> SupportReportUploadResponse:
    expires_seconds = settings.support_report_upload_url_expires_seconds
    region = _support_report_region()

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


async def _authorized_cloud_refs(
    db: AsyncSession,
    *,
    sender_user_id: UUID,
    workspace_refs: tuple[dict[str, object], ...],
) -> tuple[diagnostics_store.AuthorizedCloudWorkspaceSnapshot, ...]:
    workspace_ids = cloud_workspace_ids_from_refs(workspace_refs)
    return await diagnostics_store.list_authorized_cloud_workspaces(
        db,
        user_id=sender_user_id,
        workspace_ids=workspace_ids,
        limit=5,
    )


def _install_report_correlation(report: support_reports.SupportReportSnapshot) -> None:
    set_support_report_context(report.id)
    set_resource_tenant_context(
        organization_id=str(report.primary_organization_id)
        if report.primary_organization_id
        else None,
        tenant_id=report.primary_tenant_id,
    )
    set_server_sentry_correlation_context(get_correlation_context())


def _support_report_bucket() -> str:
    bucket = settings.support_report_s3_bucket.strip()
    if not bucket:
        raise SupportReportStorageUnavailable()
    return bucket


def _support_report_region() -> str | None:
    region = settings.support_report_s3_region.strip()
    return region or None


def _report_prefix(report_id: str) -> str:
    cleaned_prefix = settings.support_report_s3_prefix.strip().strip("/")
    if not report_id or not all(char.isalnum() or char in {"-", "_"} for char in report_id):
        raise SupportReportUploadInvalid("Invalid support report ID.")
    day = datetime.now(UTC).strftime("%Y/%m/%d")
    return "/".join(part for part in [cleaned_prefix, day, report_id] if part)
