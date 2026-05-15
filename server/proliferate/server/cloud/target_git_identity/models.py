"""Request/response models for target-level Git identity materialization."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_sync.target_git_identity import (
    CloudTargetGitIdentitySnapshot,
)
from proliferate.server.cloud.commands.models import CloudCommandResponse


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json_dict(value: str) -> dict[str, object]:
    parsed = cast(object, json.loads(value))
    return parsed if isinstance(parsed, dict) else {"value": parsed}


class TargetGitIdentityMaterializationPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_git_identity_id: str = Field(alias="targetGitIdentityId")
    target_id: str = Field(alias="targetId")
    config_version: int = Field(alias="configVersion")
    provider: Literal["github"] = "github"
    access_token: str = Field(alias="accessToken", repr=False)
    username: str | None = None
    email: str | None = None


class TargetGitIdentitySummaryModel(BaseModel):
    provider: str
    username_present: bool = Field(serialization_alias="usernamePresent")
    email_present: bool = Field(serialization_alias="emailPresent")


class CloudTargetGitIdentityResponse(BaseModel):
    id: str
    target_id: str = Field(serialization_alias="targetId")
    provider: str
    config_version: int = Field(serialization_alias="configVersion")
    materialization_status: str = Field(serialization_alias="materializationStatus")
    last_command_id: str | None = Field(default=None, serialization_alias="lastCommandId")
    last_materialized_at: str | None = Field(
        default=None,
        serialization_alias="lastMaterializedAt",
    )
    last_error_code: str | None = Field(default=None, serialization_alias="lastErrorCode")
    last_error_message: str | None = Field(default=None, serialization_alias="lastErrorMessage")
    summary: TargetGitIdentitySummaryModel
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class MaterializeTargetGitIdentityResponse(BaseModel):
    target_git_identity: CloudTargetGitIdentityResponse = Field(
        serialization_alias="targetGitIdentity"
    )
    command: CloudCommandResponse


class WorkerTargetGitIdentityStatusRequest(BaseModel):
    status: Literal["materializing", "applied", "failed"]
    command_id: UUID = Field(alias="commandId")
    config_version: int = Field(alias="configVersion")
    lease_id: str = Field(alias="leaseId")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WorkerTargetGitIdentityStatusResponse(BaseModel):
    target_git_identity_id: str = Field(serialization_alias="targetGitIdentityId")
    status: str
    updated: bool


def target_git_identity_payload(
    value: CloudTargetGitIdentitySnapshot,
) -> CloudTargetGitIdentityResponse:
    return CloudTargetGitIdentityResponse(
        id=str(value.id),
        target_id=str(value.target_id),
        provider=value.provider,
        config_version=value.config_version,
        materialization_status=value.materialization_status,
        last_command_id=str(value.last_command_id) if value.last_command_id else None,
        last_materialized_at=_to_iso(value.last_materialized_at),
        last_error_code=value.last_error_code,
        last_error_message=value.last_error_message,
        summary=TargetGitIdentitySummaryModel(**_json_dict(value.summary_json)),
        created_at=_to_iso(value.created_at) or "",
        updated_at=_to_iso(value.updated_at) or "",
    )
