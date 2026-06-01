from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.db.store.support_reports import SupportReportSnapshot


class SupportMessageContext(BaseModel):
    source: Literal["sidebar", "home", "settings", "cloud_gated"] = "sidebar"
    intent: Literal["general", "unlimited_cloud", "team_features"] = "general"
    pathname: str | None = Field(default=None, max_length=255)
    workspace_id: str | None = Field(default=None, alias="workspaceId", max_length=255)
    workspace_name: str | None = Field(default=None, alias="workspaceName", max_length=255)
    workspace_location: Literal["local", "cloud"] | None = Field(
        default=None,
        alias="workspaceLocation",
    )


class SupportMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: SupportMessageContext | None = None


class SupportMessageResponse(BaseModel):
    ok: bool = True


class SupportReportWorkspaceScope(BaseModel):
    kind: Literal[
        "most_recent_workspace",
        "choose_workspace",
        "app_only",
    ] = "most_recent_workspace"
    workspace_ids: list[str] = Field(default_factory=list, alias="workspaceIds", max_length=10)


class SupportReportWorkspaceReference(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    location: Literal["local", "cloud"]
    cloud_workspace_id: str | None = Field(
        default=None,
        alias="cloudWorkspaceId",
        max_length=255,
    )
    cloud_target_id: str | None = Field(default=None, alias="cloudTargetId", max_length=255)
    sandbox_profile_id: str | None = Field(
        default=None,
        alias="sandboxProfileId",
        max_length=255,
    )
    anyharness_workspace_id: str | None = Field(
        default=None,
        alias="anyharnessWorkspaceId",
        max_length=255,
    )
    exposure_id: str | None = Field(default=None, alias="exposureId", max_length=255)
    materialization_id: str | None = Field(
        default=None,
        alias="materializationId",
        max_length=255,
    )
    session_ids: list[str] = Field(default_factory=list, alias="sessionIds", max_length=20)
    status: str | None = Field(default=None, max_length=128)
    visibility: str | None = Field(default=None, max_length=128)
    sandbox_type: str | None = Field(default=None, alias="sandboxType", max_length=128)


class SupportReportTelemetryReferences(BaseModel):
    posthog_distinct_id: str | None = Field(
        default=None,
        alias="posthogDistinctId",
        max_length=255,
    )
    posthog_session_id: str | None = Field(
        default=None,
        alias="posthogSessionId",
        max_length=255,
    )
    sentry_event_ids: list[str] = Field(
        default_factory=list, alias="sentryEventIds", max_length=20
    )


class SupportReportExpectedClientUploads(BaseModel):
    diagnostics: bool = True
    attachment_count: int = Field(default=0, alias="attachmentCount", ge=0, le=20)


class SupportReportCreateRequest(BaseModel):
    client_job_id: str = Field(alias="clientJobId", min_length=1, max_length=128)
    message: str = Field(default="", max_length=5000)
    source_surface: Literal["desktop", "web", "mobile", "cloud_api"] = Field(
        default="desktop",
        alias="sourceSurface",
    )
    context: SupportMessageContext | None = None
    scope: SupportReportWorkspaceScope
    workspace_refs: list[SupportReportWorkspaceReference] = Field(
        default_factory=list,
        alias="workspaceRefs",
        max_length=20,
    )
    telemetry_refs: SupportReportTelemetryReferences | None = Field(
        default=None,
        alias="telemetryRefs",
    )
    expected_client_uploads: SupportReportExpectedClientUploads = Field(
        default_factory=SupportReportExpectedClientUploads,
        alias="expectedClientUploads",
    )
    public_content_consent: bool | None = Field(default=None, alias="publicContentConsent")


class SupportReportServerCorrelation(BaseModel):
    report_id: str = Field(alias="reportId")
    request_id: str | None = Field(default=None, alias="requestId")
    owner_user_id: str = Field(alias="ownerUserId")
    primary_organization_id: str | None = Field(default=None, alias="primaryOrganizationId")
    primary_tenant_id: str = Field(alias="primaryTenantId")
    tenant_ids: list[str] = Field(default_factory=list, alias="tenantIds")
    cloud_workspace_ids: list[str] = Field(default_factory=list, alias="cloudWorkspaceIds")
    cloud_target_ids: list[str] = Field(default_factory=list, alias="cloudTargetIds")
    anyharness_workspace_ids: list[str] = Field(
        default_factory=list,
        alias="anyharnessWorkspaceIds",
    )
    session_ids: list[str] = Field(default_factory=list, alias="sessionIds")


class SupportReportCreateResponse(BaseModel):
    report_id: str = Field(alias="reportId")
    client_job_id: str = Field(alias="clientJobId")
    status: str
    server_correlation: SupportReportServerCorrelation = Field(alias="serverCorrelation")
    cloud_diagnostics_status: str = Field(alias="cloudDiagnosticsStatus")


class SupportReportUploadFile(BaseModel):
    client_file_id: str = Field(alias="clientFileId", min_length=1, max_length=128)
    file_name: str = Field(alias="fileName", min_length=1, max_length=255)
    content_type: str = Field(
        default="application/octet-stream",
        alias="contentType",
        max_length=255,
    )
    size_bytes: int = Field(alias="sizeBytes", ge=0)
    sha256: str = Field(min_length=1, max_length=128)


class SupportReportDiagnosticsUpload(BaseModel):
    content_type: str = Field(default="application/json", alias="contentType", max_length=255)
    size_bytes: int = Field(alias="sizeBytes", ge=0)
    sha256: str = Field(min_length=1, max_length=128)


class SupportReportUploadRequest(BaseModel):
    message: str = Field(default="", max_length=5000)
    context: SupportMessageContext | None = None
    scope: SupportReportWorkspaceScope
    diagnostics: SupportReportDiagnosticsUpload | None = None
    attachments: list[SupportReportUploadFile] = Field(default_factory=list, max_length=20)
    public_content_consent: bool | None = Field(default=None, alias="publicContentConsent")


class SupportReportUploadTargetsRequest(BaseModel):
    diagnostics: SupportReportDiagnosticsUpload | None = None
    attachments: list[SupportReportUploadFile] = Field(default_factory=list, max_length=20)


class SupportReportUploadTarget(BaseModel):
    object_key: str = Field(alias="objectKey")
    put_url: str = Field(alias="putUrl")
    content_type: str = Field(alias="contentType")
    max_size_bytes: int = Field(alias="maxSizeBytes")
    expires_in_seconds: int = Field(alias="expiresInSeconds")
    headers: dict[str, str] = Field(default_factory=dict)


class SupportReportAttachmentUploadTarget(SupportReportUploadTarget):
    client_file_id: str = Field(alias="clientFileId")


class SupportReportUploadResponse(BaseModel):
    report_id: str = Field(alias="reportId")
    diagnostics: SupportReportUploadTarget | None = None
    attachments: list[SupportReportAttachmentUploadTarget] = Field(default_factory=list)


class SupportReportCompletedObject(BaseModel):
    object_key: str = Field(alias="objectKey")
    sha256: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(alias="sizeBytes", ge=0)


class SupportReportCompleteRequest(BaseModel):
    diagnostics: SupportReportCompletedObject | None = None
    attachments: list[SupportReportCompletedObject] = Field(default_factory=list, max_length=20)
    package_manifest: dict[str, object] = Field(default_factory=dict, alias="packageManifest")


class SupportReportCompleteResponse(BaseModel):
    ok: bool = True
    report_id: str = Field(alias="reportId")


class SupportReportTrackerResponse(BaseModel):
    ok: bool = True
    report_id: str = Field(alias="reportId")
    tracker_status: str = Field(alias="trackerStatus")
    github_issue_url: str | None = Field(default=None, alias="githubIssueUrl")
    linear_issue_url: str | None = Field(default=None, alias="linearIssueUrl")


def support_report_create_response(
    report: SupportReportSnapshot,
) -> SupportReportCreateResponse:
    return SupportReportCreateResponse(
        reportId=report.id,
        clientJobId=report.client_job_id,
        status=report.status,
        serverCorrelation=SupportReportServerCorrelation(
            reportId=report.id,
            requestId=report.request_id,
            ownerUserId=str(report.owner_user_id),
            primaryOrganizationId=(
                str(report.primary_organization_id) if report.primary_organization_id else None
            ),
            primaryTenantId=report.primary_tenant_id,
            tenantIds=list(report.tenant_ids),
            cloudWorkspaceIds=sorted(
                {
                    str(ref.get("cloudWorkspaceId"))
                    for ref in report.workspace_refs
                    if ref.get("cloudWorkspaceId")
                }
            ),
            cloudTargetIds=sorted(
                {
                    str(ref.get("cloudTargetId"))
                    for ref in report.workspace_refs
                    if ref.get("cloudTargetId")
                }
            ),
            anyharnessWorkspaceIds=sorted(
                {
                    str(ref.get("anyharnessWorkspaceId"))
                    for ref in report.workspace_refs
                    if ref.get("anyharnessWorkspaceId")
                }
            ),
            sessionIds=sorted(
                {
                    str(session_id)
                    for ref in report.workspace_refs
                    for session_id in (
                        ref.get("sessionIds") if isinstance(ref.get("sessionIds"), list) else []
                    )
                }
            ),
        ),
        cloudDiagnosticsStatus=report.cloud_diagnostics_status,
    )


def support_report_correlation_record(report: SupportReportSnapshot) -> dict[str, object]:
    response = support_report_create_response(report).server_correlation
    return response.model_dump(by_alias=True, exclude_none=True)


def support_report_tracker_response(
    report: SupportReportSnapshot,
) -> SupportReportTrackerResponse:
    return SupportReportTrackerResponse(
        reportId=report.id,
        trackerStatus=report.tracker_status,
        githubIssueUrl=report.github_issue_url,
        linearIssueUrl=report.linear_issue_url,
    )
