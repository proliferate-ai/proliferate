from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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
