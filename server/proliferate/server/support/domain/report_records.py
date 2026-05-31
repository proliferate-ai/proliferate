"""Pure support report record builders and ID normalization."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Protocol
from uuid import UUID

from proliferate.server.support.models import (
    SupportReportCreateRequest,
    SupportReportUploadResponse,
)


class SupportReportLike(Protocol):
    id: str
    client_job_id: str
    request_id: str | None
    owner_user_id: UUID
    primary_organization_id: UUID | None
    primary_tenant_id: str
    tenant_ids: tuple[str, ...]
    created_at: datetime
    source_context: dict[str, object]
    workspace_refs: tuple[dict[str, object], ...]
    telemetry_refs: dict[str, object]
    object_manifest: dict[str, object]


class AuthorizedCloudRefLike(Protocol):
    organization_id: UUID | None
    owner_user_id: UUID | None


@dataclass(frozen=True)
class ReportTenantContext:
    primary_organization_id: UUID | None
    primary_tenant_id: str
    tenant_ids: tuple[str, ...]


def workspace_refs_for_create(
    body: SupportReportCreateRequest,
) -> tuple[dict[str, object], ...]:
    refs = [ref.model_dump(by_alias=True, exclude_none=True) for ref in body.workspace_refs]
    existing_ids = {str(ref.get("id")) for ref in refs if ref.get("id")}
    for workspace_id in body.scope.workspace_ids:
        if workspace_id in existing_ids:
            continue
        refs.append(workspace_ref_from_id(workspace_id))
    return tuple(refs)


def workspace_ref_from_id(workspace_id: str) -> dict[str, object]:
    if workspace_id.startswith("cloud:"):
        return {
            "id": workspace_id,
            "location": "cloud",
            "cloudWorkspaceId": workspace_id.removeprefix("cloud:"),
        }
    return {
        "id": workspace_id,
        "location": "local",
    }


def cloud_workspace_ids_from_refs(
    workspace_refs: tuple[dict[str, object], ...],
) -> tuple[UUID, ...]:
    ids: list[UUID] = []
    for ref in workspace_refs:
        raw = ref.get("cloudWorkspaceId")
        if not raw and isinstance(ref.get("id"), str):
            raw_id = str(ref["id"])
            raw = raw_id.removeprefix("cloud:") if raw_id.startswith("cloud:") else None
        if not raw:
            continue
        try:
            ids.append(UUID(str(raw)))
        except ValueError:
            continue
    return tuple(dict.fromkeys(ids))


def tenant_context_for_report(
    *,
    sender_user_id: UUID,
    authorized_cloud_refs: tuple[AuthorizedCloudRefLike, ...],
) -> ReportTenantContext:
    if not authorized_cloud_refs:
        tenant_id = f"user:{sender_user_id}"
        return ReportTenantContext(None, tenant_id, (tenant_id,))

    primary_organization_id: UUID | None = None
    primary_tenant_id = f"user:{sender_user_id}"
    tenant_ids: list[str] = [primary_tenant_id]
    for ref in authorized_cloud_refs:
        if ref.organization_id is not None:
            tenant_id = f"org:{ref.organization_id}"
            if primary_organization_id is None:
                primary_organization_id = ref.organization_id
                primary_tenant_id = tenant_id
        elif ref.owner_user_id is not None:
            tenant_id = f"user:{ref.owner_user_id}"
        else:
            tenant_id = f"user:{sender_user_id}"
        tenant_ids.append(tenant_id)
    return ReportTenantContext(
        primary_organization_id,
        primary_tenant_id,
        tuple(dict.fromkeys(tenant_ids)),
    )


def support_context_record(context: object | None) -> dict[str, object]:
    if context is None:
        return {}
    record = context.model_dump(by_alias=True, exclude_none=True)
    pathname = record.get("pathname")
    if isinstance(pathname, str):
        record["pathname"] = sanitize_pathname(pathname)
    return record


def sanitize_pathname(pathname: str) -> str:
    path = pathname.split("?", 1)[0]
    parts = []
    for segment in path.split("/"):
        if not segment:
            continue
        dynamic = len(segment) >= 24 or segment.startswith(("cloud:", "client-session:"))
        parts.append("{id}" if dynamic else segment)
    return "/" + "/".join(parts)


def support_request_record(
    *,
    report: SupportReportLike,
    sender_email: str,
    sender_display_name: str | None,
    message: str,
    scope: dict[str, object],
    correlation: dict[str, object],
) -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "status": "created",
        "reportId": report.id,
        "clientJobId": report.client_job_id,
        "requestId": report.request_id,
        "createdAt": report.created_at.isoformat(),
        "sender": {
            "email": sender_email,
            "displayName": sender_display_name,
        },
        "message": message.strip(),
        "context": report.source_context,
        "scope": scope,
        "workspaceRefs": list(report.workspace_refs),
        "telemetryRefs": report.telemetry_refs,
        "correlation": correlation,
        "objects": report.object_manifest,
    }


def object_manifest_from_targets(
    *,
    diagnostics: object | None,
    attachments: list[object],
    targets: SupportReportUploadResponse,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "diagnostics": object_manifest_entry(diagnostics, targets.diagnostics),
        "attachments": [
            object_manifest_entry(
                attachment,
                next(
                    (
                        target
                        for target in targets.attachments
                        if getattr(attachment, "client_file_id", None) == target.client_file_id
                    ),
                    None,
                ),
            )
            for attachment in attachments
        ],
    }


def object_manifest_entry(
    source: object | None, target: object | None
) -> dict[str, object] | None:
    if source is None or target is None:
        return None
    entry = {
        "objectKey": getattr(target, "object_key", None),
        "contentType": getattr(source, "content_type", None),
        "sizeBytes": getattr(source, "size_bytes", None),
        "sha256": getattr(source, "sha256", None),
    }
    client_file_id = getattr(source, "client_file_id", None)
    if client_file_id:
        entry["clientFileId"] = client_file_id
        entry["fileName"] = getattr(source, "file_name", None)
    return {key: value for key, value in entry.items() if value is not None}


def expected_manifest_keys(manifest: dict[str, object]) -> set[str]:
    keys: set[str] = set()
    diagnostics = manifest.get("diagnostics")
    if isinstance(diagnostics, dict) and isinstance(diagnostics.get("objectKey"), str):
        keys.add(str(diagnostics["objectKey"]))
    attachments = manifest.get("attachments")
    if isinstance(attachments, list):
        for item in attachments:
            if isinstance(item, dict) and isinstance(item.get("objectKey"), str):
                keys.add(str(item["objectKey"]))
    return keys


def expected_upload_keys(request_record: dict[str, object]) -> set[str]:
    objects = request_record.get("objects")
    if not isinstance(objects, dict):
        return set()
    return expected_manifest_keys(objects)


def safe_file_name(file_name: str) -> str:
    name = PurePosixPath(file_name).name.strip()
    return name or "attachment"


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
