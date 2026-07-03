"""Request/response schemas for the workspace_move API.

See specs/tbd/workspace-migration-v2.md section 2.2 for the data model and
section 2.3 for the two flows these endpoints implement.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.workspace_moves import WorkspaceMoveValue

MoveRuntimeKind = Literal["local", "cloud", "ssh"]
MovePhase = Literal["started", "destination_ready", "installed", "cutover", "completed", "failed"]
CanonicalSide = Literal["source", "destination"]


class WorkspaceMoveEndpointRef(BaseModel):
    """One side (source or destination) of a move, as the caller sees it.

    Only the fields relevant to ``kind`` are meaningful; the rest are ignored.
    Stored verbatim (camelCase keys) into ``workspace_move.source_ref`` /
    ``destination_ref`` -- see the JSONB shape documented in
    ``db/models/cloud/workspace_moves.py``.
    """

    model_config = ConfigDict(populate_by_name=True)

    kind: MoveRuntimeKind
    desktop_install_id: str | None = Field(default=None, alias="desktopInstallId")
    cloud_workspace_id: UUID | None = Field(default=None, alias="cloudWorkspaceId")
    target_id: str | None = Field(default=None, alias="targetId")
    anyharness_workspace_id: str | None = Field(default=None, alias="anyharnessWorkspaceId")


class StartWorkspaceMoveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    repo_config_id: UUID = Field(alias="repoConfigId")
    branch: str
    base_commit_sha: str = Field(alias="baseCommitSha")
    source: WorkspaceMoveEndpointRef
    destination: WorkspaceMoveEndpointRef
    idempotency_key: str = Field(alias="idempotencyKey")


class InstallWorkspaceMoveRequest(BaseModel):
    """Body for POST .../install.

    ``archive`` is the opaque ``WorkspaceMobilityArchive`` produced by the source
    runtime's export call (local->cloud direction: the server forwards it to the
    destination sandbox's AnyHarness install endpoint). It is unused -- and may be
    omitted -- for the cloud->local direction, where install runs entirely on
    Desktop's own local AnyHarness and this call is just the durable "installed"
    acknowledgement.
    """

    model_config = ConfigDict(populate_by_name=True)

    archive: dict[str, object] | None = None


class FailWorkspaceMoveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    failure_code: str = Field(alias="failureCode")
    failure_detail: str | None = Field(default=None, alias="failureDetail")


class WorkspaceMoveResponse(BaseModel):
    id: str
    repo_config_id: str = Field(serialization_alias="repoConfigId")
    branch: str
    source_kind: MoveRuntimeKind = Field(serialization_alias="sourceKind")
    destination_kind: MoveRuntimeKind = Field(serialization_alias="destinationKind")
    source_ref: dict[str, object] = Field(serialization_alias="sourceRef")
    destination_ref: dict[str, object] = Field(serialization_alias="destinationRef")
    base_commit_sha: str = Field(serialization_alias="baseCommitSha")
    phase: MovePhase
    canonical_side: CanonicalSide = Field(serialization_alias="canonicalSide")
    failure_code: str | None = Field(default=None, serialization_alias="failureCode")
    failure_detail: str | None = Field(default=None, serialization_alias="failureDetail")
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    cutover_at: str | None = Field(default=None, serialization_alias="cutoverAt")
    completed_at: str | None = Field(default=None, serialization_alias="completedAt")


class ExportWorkspaceMoveResponse(BaseModel):
    """Response for POST .../export (cloud->local direction only)."""

    move_id: str = Field(serialization_alias="moveId")
    archive: dict[str, object]


def workspace_move_payload(value: WorkspaceMoveValue) -> WorkspaceMoveResponse:
    return WorkspaceMoveResponse(
        id=str(value.id),
        repo_config_id=str(value.repo_config_id),
        branch=value.branch,
        source_kind=value.source_kind,
        destination_kind=value.destination_kind,
        source_ref=value.source_ref,
        destination_ref=value.destination_ref,
        base_commit_sha=value.base_commit_sha,
        phase=value.phase,
        canonical_side=value.canonical_side,
        failure_code=value.failure_code,
        failure_detail=value.failure_detail,
        idempotency_key=value.idempotency_key,
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
        cutover_at=value.cutover_at.isoformat() if value.cutover_at is not None else None,
        completed_at=value.completed_at.isoformat() if value.completed_at is not None else None,
    )
