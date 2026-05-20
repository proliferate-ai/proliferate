from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_runtime_config.revisions import (
    SandboxProfileRuntimeConfigRevisionSnapshot,
)


class RefreshRuntimeConfigRequest(BaseModel):
    reason: str = "manual_refresh"


class RuntimeConfigRevisionModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    revision_id: str = Field(alias="revisionId")
    sandbox_profile_id: str = Field(alias="sandboxProfileId")
    sequence: int
    content_hash: str = Field(alias="contentHash")
    created_at: str = Field(alias="createdAt")


class RuntimeConfigStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sandbox_profile_id: str = Field(alias="sandboxProfileId")
    current_revision: RuntimeConfigRevisionModel | None = Field(
        default=None,
        alias="currentRevision",
    )
    manifest: dict[str, object] | None = None
    warnings: dict[str, object] | None = None


class RuntimeConfigArtifactRefModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    hash: str
    content_type: str = Field(alias="contentType")
    byte_size: int = Field(alias="byteSize")
    source_ref: str | None = Field(default=None, alias="sourceRef")


class RuntimeConfigMaterializationFragment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    revision_id: str = Field(alias="revisionId")
    sandbox_profile_id: str = Field(alias="sandboxProfileId")
    target_id: str | None = Field(default=None, alias="targetId")
    sequence: int
    content_hash: str = Field(alias="contentHash")
    manifest: dict[str, object]
    artifact_refs: list[RuntimeConfigArtifactRefModel] = Field(
        default_factory=list,
        alias="artifactRefs",
    )
    credential_refs: list[dict[str, object]] = Field(
        default_factory=list,
        alias="credentialRefs",
    )


class WorkerRuntimeConfigStatusRequest(BaseModel):
    status: Literal["materializing", "applied", "failed"]
    missing_artifacts: list[str] = Field(default_factory=list, alias="missingArtifacts")
    missing_credentials: list[str] = Field(default_factory=list, alias="missingCredentials")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WorkerRuntimeConfigStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    revision_id: str = Field(alias="revisionId")
    status: str
    updated: bool


class RuntimeConfigArtifactResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    hash: str
    content_type: str = Field(alias="contentType")
    byte_size: int = Field(alias="byteSize")
    source_ref: str | None = Field(default=None, alias="sourceRef")
    content: str


class WorkerRuntimeConfigCredentialMaterializationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    credential_refs: list[str] = Field(default_factory=list, alias="credentialRefs")


class RuntimeConfigCredentialValueModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    credential_ref: str = Field(alias="credentialRef")
    value: str = Field(repr=False)


class WorkerRuntimeConfigCredentialMaterializationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    credentials: list[RuntimeConfigCredentialValueModel] = Field(default_factory=list)
    missing_credential_refs: list[str] = Field(
        default_factory=list,
        alias="missingCredentialRefs",
    )


def runtime_config_revision_model(
    revision: SandboxProfileRuntimeConfigRevisionSnapshot,
) -> RuntimeConfigRevisionModel:
    return RuntimeConfigRevisionModel(
        revision_id=str(revision.id),
        sandbox_profile_id=str(revision.sandbox_profile_id),
        sequence=revision.sequence,
        content_hash=revision.content_hash,
        created_at=revision.created_at.isoformat(),
    )


def parse_json_dict(value: str | None) -> dict[str, object] | None:
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else {"value": parsed}
