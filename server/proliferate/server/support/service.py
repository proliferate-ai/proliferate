from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import uuid4

from proliferate.config import settings
from proliferate.integrations.aws import (
    AwsIntegrationError,
    get_json_object,
    head_object,
    presign_put_object,
    put_json_object,
)
from proliferate.integrations.slack.errors import SlackWebhookError
from proliferate.integrations.slack.messages import (
    SlackMessageField,
    build_mrkdwn_message_blocks,
)
from proliferate.integrations.slack.webhooks import post_incoming_webhook
from proliferate.middleware.request_context import get_request_id
from proliferate.server.support.domain.message import (
    build_support_message_plan,
    build_support_report_plan,
    normalize_support_message,
)
from proliferate.server.support.errors import (
    SupportDeliveryFailed,
    SupportMessageEmpty,
    SupportReportStorageUnavailable,
    SupportReportUploadInvalid,
    SupportUnavailable,
)
from proliferate.server.support.models import (
    SupportReportAttachmentUploadTarget,
    SupportReportCompleteRequest,
    SupportReportCompleteResponse,
    SupportReportUploadRequest,
    SupportReportUploadResponse,
    SupportReportUploadTarget,
)

logger = logging.getLogger(__name__)


async def send_support_message(
    *,
    sender_email: str,
    sender_display_name: str | None,
    message: str,
    context: dict[str, object] | None = None,
) -> None:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        raise SupportUnavailable()

    cleaned_message = normalize_support_message(message)
    if not cleaned_message:
        raise SupportMessageEmpty()

    plan = build_support_message_plan(
        sender_name=sender_display_name or sender_email,
        sender_email=sender_email,
        message=cleaned_message,
        context=context,
        request_id=get_request_id(),
    )
    blocks = build_mrkdwn_message_blocks(
        title="*New support message*",
        body=plan.message,
        fields=tuple(SlackMessageField(field.label, field.value) for field in plan.fields),
    )

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        raise SupportDeliveryFailed() from exc


async def create_support_report_upload(
    *,
    sender_email: str,
    sender_display_name: str | None,
    body: SupportReportUploadRequest,
) -> SupportReportUploadResponse:
    _validate_report_upload_request(body)
    bucket = _support_report_bucket()
    region = _support_report_region()

    report_id = uuid4().hex
    prefix = _report_prefix(report_id)
    request_id = get_request_id()
    expires_seconds = settings.support_report_upload_url_expires_seconds

    diagnostics_target: SupportReportUploadTarget | None = None
    if body.diagnostics is not None:
        diagnostics_key = f"{prefix}/diagnostics.json"
        diagnostics_target = await _presign_target(
            bucket=bucket,
            key=diagnostics_key,
            content_type=body.diagnostics.content_type,
            max_size_bytes=settings.support_report_diagnostics_max_bytes,
            expires_seconds=expires_seconds,
            region_name=region,
        )

    attachment_targets: list[SupportReportAttachmentUploadTarget] = []
    for attachment in body.attachments:
        attachment_key = (
            f"{prefix}/attachments/{attachment.client_file_id}/"
            f"{_safe_file_name(attachment.file_name)}"
        )
        target = await _presign_target(
            bucket=bucket,
            key=attachment_key,
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

    context_record = (
        body.context.model_dump(by_alias=True, exclude_none=True) if body.context else None
    )
    diagnostics_record = (
        diagnostics_target.model_dump(by_alias=True) if diagnostics_target else None
    )
    record = {
        "schemaVersion": 1,
        "status": "initiated",
        "reportId": report_id,
        "requestId": request_id,
        "createdAt": _now_iso(),
        "sender": {
            "email": sender_email,
            "displayName": sender_display_name,
        },
        "message": body.message.strip(),
        "context": context_record,
        "scope": body.scope.model_dump(by_alias=True),
        "diagnostics": body.diagnostics.model_dump(by_alias=True) if body.diagnostics else None,
        "attachments": [attachment.model_dump(by_alias=True) for attachment in body.attachments],
        "objects": {
            "diagnostics": diagnostics_record,
            "attachments": [target.model_dump(by_alias=True) for target in attachment_targets],
        },
    }

    try:
        await put_json_object(
            bucket=bucket,
            key=f"{prefix}/request.json",
            value=record,
            region_name=region,
        )
    except AwsIntegrationError as exc:
        raise SupportReportStorageUnavailable() from exc

    return SupportReportUploadResponse(
        reportId=report_id,
        diagnostics=diagnostics_target,
        attachments=attachment_targets,
    )


async def complete_support_report_upload(
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

    expected_keys = _expected_upload_keys(request_record)
    completed_keys = [
        *([body.diagnostics.object_key] if body.diagnostics else []),
        *[attachment.object_key for attachment in body.attachments],
    ]
    unexpected = sorted(set(completed_keys).difference(expected_keys))
    if unexpected:
        raise SupportReportUploadInvalid("Support report completion included unknown objects.")

    if body.diagnostics is not None:
        await _verify_completed_object(
            bucket=bucket,
            region_name=region,
            prefix=prefix,
            object_key=body.diagnostics.object_key,
            expected_size=body.diagnostics.size_bytes,
        )
    for attachment in body.attachments:
        await _verify_completed_object(
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
        "completedAt": _now_iso(),
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
    await _notify_support_report(
        sender_email=sender_email,
        sender_display_name=sender_display_name,
        report_id=report_id,
        s3_prefix=prefix,
        message=str(request_record.get("message") or "Support report submitted."),
        context=context_record if isinstance(context_record, dict) else None,
        diagnostics_included=body.diagnostics is not None,
        attachment_count=len(body.attachments),
    )

    return SupportReportCompleteResponse(reportId=report_id)


def _validate_report_upload_request(body: SupportReportUploadRequest) -> None:
    if body.scope.kind == "choose_workspace" and not body.scope.workspace_ids:
        raise SupportReportUploadInvalid("Choose at least one workspace.")
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


async def _notify_support_report(
    *,
    sender_email: str,
    sender_display_name: str | None,
    report_id: str,
    s3_prefix: str,
    message: str,
    context: dict[str, object] | None,
    diagnostics_included: bool,
    attachment_count: int,
) -> None:
    webhook_url = settings.support_slack_webhook_url.strip()
    if not webhook_url:
        return

    plan = build_support_report_plan(
        sender_name=sender_display_name or sender_email,
        sender_email=sender_email,
        message=normalize_support_message(message) or "Support report submitted.",
        report_id=report_id,
        s3_prefix=s3_prefix,
        diagnostics_included=diagnostics_included,
        attachment_count=attachment_count,
        context=context,
        request_id=get_request_id(),
    )
    blocks = build_mrkdwn_message_blocks(
        title="*New support report*",
        body=plan.message,
        fields=tuple(SlackMessageField(field.label, field.value) for field in plan.fields),
    )

    try:
        await post_incoming_webhook(
            webhook_url=webhook_url,
            text=plan.fallback_text,
            blocks=blocks,
        )
    except SlackWebhookError as exc:
        logger.warning("Support report Slack notification failed: %s", exc)
        return


async def _presign_target(
    *,
    bucket: str,
    key: str,
    content_type: str,
    max_size_bytes: int,
    expires_seconds: int,
    region_name: str | None,
) -> SupportReportUploadTarget:
    try:
        url = await presign_put_object(
            bucket=bucket,
            key=key,
            content_type=content_type,
            expires_seconds=expires_seconds,
            region_name=region_name,
        )
    except AwsIntegrationError as exc:
        raise SupportReportStorageUnavailable() from exc
    return SupportReportUploadTarget(
        objectKey=key,
        putUrl=url,
        contentType=content_type,
        maxSizeBytes=max_size_bytes,
        expiresInSeconds=expires_seconds,
        headers={"x-amz-server-side-encryption": "AES256"},
    )


async def _verify_completed_object(
    *,
    bucket: str,
    region_name: str | None,
    prefix: str,
    object_key: str,
    expected_size: int,
) -> None:
    if not object_key.startswith(f"{prefix}/"):
        raise SupportReportUploadInvalid("Support report object key is outside report prefix.")
    try:
        metadata = await head_object(
            bucket=bucket,
            key=object_key,
            region_name=region_name,
        )
    except AwsIntegrationError as exc:
        raise SupportReportUploadInvalid("Support report object upload is missing.") from exc

    content_length = metadata.get("ContentLength")
    if isinstance(content_length, int) and content_length != expected_size:
        raise SupportReportUploadInvalid("Support report object size did not match.")


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


def _safe_file_name(file_name: str) -> str:
    name = PurePosixPath(file_name).name.strip()
    return name or "attachment"


def _expected_upload_keys(request_record: dict[str, object]) -> set[str]:
    objects = request_record.get("objects")
    if not isinstance(objects, dict):
        return set()

    keys: set[str] = set()
    diagnostics = objects.get("diagnostics")
    if isinstance(diagnostics, dict) and isinstance(diagnostics.get("objectKey"), str):
        keys.add(str(diagnostics["objectKey"]))
    attachments = objects.get("attachments")
    if isinstance(attachments, list):
        for item in attachments:
            if isinstance(item, dict) and isinstance(item.get("objectKey"), str):
                keys.add(str(item["objectKey"]))
    return keys


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()
