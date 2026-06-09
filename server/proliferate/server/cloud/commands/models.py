"""Request and response models for cloud commands."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.cloud_sync.command_records import CloudCommandSnapshot


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class CreateCloudCommandRequest(BaseModel):
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=255)
    target_id: UUID = Field(alias="targetId")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    cloud_workspace_id: UUID | None = Field(default=None, alias="cloudWorkspaceId")
    session_id: str | None = Field(default=None, alias="sessionId")
    kind: str
    payload: dict[str, object] = Field(default_factory=dict)
    observed_event_seq: int | None = Field(default=None, alias="observedEventSeq")
    preconditions: dict[str, object] | None = None
    source: str | None = None


class MaterializeWorkspaceExistingPathPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["existing_path"]
    path: str = Field(min_length=1)
    display_name: str | None = Field(default=None, alias="displayName")
    origin: dict[str, object] | None = None
    creator_context: dict[str, object] | None = Field(default=None, alias="creatorContext")


class MaterializeWorkspaceWorktreePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["worktree"]
    repo_root_id: str = Field(alias="repoRootId", min_length=1)
    target_path: str = Field(alias="targetPath", min_length=1)
    new_branch_name: str = Field(alias="newBranchName", min_length=1)
    base_branch: str | None = Field(default=None, alias="baseBranch")
    checkout_mode: Literal["new_branch", "detached_ref"] | None = Field(
        default=None,
        alias="checkoutMode",
    )
    setup_script: str | None = Field(default=None, alias="setupScript")
    name_conflict_policy: (
        Literal[
            "fail",
            "suffix_path",
        ]
        | None
    ) = Field(default=None, alias="nameConflictPolicy")
    origin: dict[str, object] | None = None
    creator_context: dict[str, object] | None = Field(default=None, alias="creatorContext")


MaterializeWorkspacePayload = (
    MaterializeWorkspaceExistingPathPayload | MaterializeWorkspaceWorktreePayload
)


class CloudCommandResponse(BaseModel):
    command_id: str = Field(serialization_alias="commandId")
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    target_id: str = Field(serialization_alias="targetId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    cloud_workspace_id: str | None = Field(default=None, serialization_alias="cloudWorkspaceId")
    session_id: str | None = Field(default=None, serialization_alias="sessionId")
    kind: str
    source: str
    status: str
    lease_id: str | None = Field(default=None, serialization_alias="leaseId")
    lease_expires_at: str | None = Field(default=None, serialization_alias="leaseExpiresAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    delivered_at: str | None = Field(default=None, serialization_alias="deliveredAt")
    accepted_at: str | None = Field(default=None, serialization_alias="acceptedAt")
    rejected_at: str | None = Field(default=None, serialization_alias="rejectedAt")
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")
    result: dict[str, object] | None = None


def command_response_payload(value: CloudCommandSnapshot) -> CloudCommandResponse:
    return CloudCommandResponse(
        command_id=str(value.id),
        idempotency_key=value.idempotency_key,
        target_id=str(value.target_id),
        workspace_id=value.workspace_id,
        cloud_workspace_id=str(value.cloud_workspace_id) if value.cloud_workspace_id else None,
        session_id=value.session_id,
        kind=value.kind,
        source=value.source,
        status=value.status,
        lease_id=value.lease_id,
        lease_expires_at=_to_iso(value.lease_expires_at),
        created_at=_to_iso(value.created_at) or "",
        updated_at=_to_iso(value.updated_at) or "",
        delivered_at=_to_iso(value.delivered_at),
        accepted_at=_to_iso(value.accepted_at),
        rejected_at=_to_iso(value.rejected_at),
        error_code=value.error_code,
        error_message=value.error_message,
        result=_parse_result_json(value.kind, value.result_json),
    )


def _parse_result_json(kind: str, value: str | None) -> dict[str, object] | None:
    if kind not in {
        CloudCommandKind.materialize_workspace.value,
        CloudCommandKind.ensure_repo_checkout.value,
        CloudCommandKind.configure_git_identity.value,
        CloudCommandKind.refresh_agent_auth_config.value,
        CloudCommandKind.start_session.value,
    }:
        return None
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None
