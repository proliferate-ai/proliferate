"""Wire models for personal workflow definitions."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.alias_generators import to_camel

from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot


class WorkflowWireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
    )


class WorkflowInputDefinition(WorkflowWireModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    type: Literal["string", "number", "boolean"]
    required: bool


class WorkflowGoalDefinition(WorkflowWireModel):
    objective: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000),
    ]


class WorkflowPromptStep(WorkflowWireModel):
    kind: Literal["agent.prompt"]
    prompt: Annotated[str, StringConstraints(min_length=1, max_length=100_000)]
    goal: WorkflowGoalDefinition | None = None

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt is required.")
        return value


class WorkflowHarnessConfig(WorkflowWireModel):
    agent_kind: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=32),
    ]
    model_id: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
        ]
        | None
    ) = None
    effort: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
        ]
        | None
    ) = None


class WorkflowStageDefinition(WorkflowWireModel):
    harness_config: WorkflowHarnessConfig
    steps: list[WorkflowPromptStep] = Field(min_length=1, max_length=64)


class WorkflowDefinitionDocument(WorkflowWireModel):
    inputs: list[WorkflowInputDefinition] = Field(default_factory=list, max_length=64)
    stages: list[WorkflowStageDefinition] = Field(min_length=1, max_length=64)


class WorkflowDefinitionCreateRequest(WorkflowDefinitionDocument):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    description: Annotated[str, StringConstraints(max_length=20_000)] = ""
    default_repo_config_id: UUID | None = None


class WorkflowDefinitionUpdateRequest(WorkflowDefinitionCreateRequest):
    expected_revision: int = Field(ge=1)


class WorkflowDefinitionResponse(WorkflowDefinitionDocument):
    id: UUID
    user_id: UUID
    title: str
    description: str
    schema_version: Literal[1]
    revision: int
    validated_catalog_version: str
    default_repo_config_id: UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class WorkflowDefinitionListResponse(WorkflowWireModel):
    workflows: list[WorkflowDefinitionResponse]


def workflow_definition_response(
    value: WorkflowDefinitionSnapshot,
) -> WorkflowDefinitionResponse:
    return WorkflowDefinitionResponse.model_validate(
        {
            "id": value.id,
            "userId": value.user_id,
            "title": value.title,
            "description": value.description,
            "schemaVersion": value.schema_version,
            "revision": value.revision,
            "validatedCatalogVersion": value.validated_catalog_version,
            "defaultRepoConfigId": value.default_repo_config_id,
            "inputs": list(value.inputs_json),
            "stages": list(value.stages_json),
            "createdAt": value.created_at,
            "updatedAt": value.updated_at,
            "deletedAt": value.deleted_at,
        }
    )
