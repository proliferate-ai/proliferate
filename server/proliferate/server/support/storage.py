from __future__ import annotations

from proliferate.integrations.aws import AwsIntegrationError, head_object, presign_put_object
from proliferate.server.support.errors import (
    SupportReportStorageUnavailable,
    SupportReportUploadInvalid,
)
from proliferate.server.support.models import SupportReportUploadTarget


async def presign_support_upload_target(
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


async def verify_completed_support_object(
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
