"""Desktop executor claim-plane request and response models."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from proliferate.server.cloud.workflows.models import (
    WorkflowBaseModel,
    WorkflowRunResponse,
)


class LocalWorkflowClaimRequest(WorkflowBaseModel):
    executor_id: str = Field(alias="executorId")
    workspace_id: str = Field(alias="workspaceId", min_length=1, max_length=255)
    workspace_generation: int = Field(alias="workspaceGeneration", gt=0)
    limit: int = 5


class LocalWorkflowClaimActionRequest(WorkflowBaseModel):
    executor_id: str = Field(alias="executorId")
    claim_id: UUID = Field(alias="claimId")


class LocalWorkflowClaimListResponse(WorkflowBaseModel):
    runs: list[WorkflowRunResponse]


class LocalWorkflowClaimMutationResponse(WorkflowBaseModel):
    run: WorkflowRunResponse | None = None
    accepted: bool
