"""Wire models for personal workflow definitions."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    StringConstraints,
    field_validator,
)
from pydantic.alias_generators import to_camel

from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot


class WorkflowWireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class WorkflowDefinitionWireModel(WorkflowWireModel):
    """Definition JSON accepts only its canonical camel-case wire aliases."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
    )


class WorkflowInputDefinition(WorkflowDefinitionWireModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    type: Literal["string", "number", "boolean"]
    required: bool


class WorkflowGoalDefinition(WorkflowDefinitionWireModel):
    objective: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000),
    ]


class WorkflowPromptStep(WorkflowDefinitionWireModel):
    kind: Literal["agent.prompt"]
    prompt: Annotated[str, StringConstraints(min_length=1, max_length=100_000)]
    goal: WorkflowGoalDefinition | None = None

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt is required.")
        return value


class WorkflowHarnessConfig(WorkflowDefinitionWireModel):
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


class WorkflowStageDefinition(WorkflowDefinitionWireModel):
    harness_config: WorkflowHarnessConfig
    steps: list[WorkflowPromptStep] = Field(min_length=1, max_length=64)


class WorkflowDefinitionDocument(WorkflowDefinitionWireModel):
    inputs: list[WorkflowInputDefinition] = Field(default_factory=list, max_length=64)
    stages: list[WorkflowStageDefinition] = Field(min_length=1, max_length=64)


class WorkflowDefinitionCreateRequest(WorkflowDefinitionDocument):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    description: Annotated[str, StringConstraints(max_length=20_000)] = ""
    default_repo_config_id: UUID | None = None


class WorkflowDefinitionUpdateRequest(WorkflowDefinitionCreateRequest):
    expected_revision: int = Field(ge=1)


class WorkflowDefinitionResponse(WorkflowDefinitionDocument):
    # Response construction remains name-friendly for internal Python callers;
    # only the HTTP request models reject non-canonical snake-case wire keys.
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
        validate_by_alias=True,
        validate_by_name=True,
    )

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


class WorkflowRunEligibilityBlocker(WorkflowWireModel):
    code: Literal[
        "stage_count_not_supported",
        "step_count_not_supported",
        "goal_not_supported",
        "agent_catalog_selection_unavailable",
        "model_catalog_selection_unavailable",
        "effort_catalog_selection_unavailable",
        "default_repository_unavailable",
    ]
    path: str
    message: str


class WorkflowRunEligibilityResponse(WorkflowWireModel):
    eligible: bool
    blockers: list[WorkflowRunEligibilityBlocker]


class WorkflowInvocationWireModel(WorkflowWireModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class WorkflowInvocationRequestWireModel(WorkflowInvocationWireModel):
    """Invocation requests accept only canonical camel-case wire aliases."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
    )


WorkflowInvocationScalar = StrictBool | StrictInt | StrictFloat | StrictStr


class ManagedCloudWorkflowTarget(WorkflowInvocationWireModel):
    kind: Literal["managedCloud"]


class WorkflowInvocationCreateRequest(WorkflowInvocationRequestWireModel):
    schema_version: Literal[1]
    workflow_definition_id: UUID
    expected_revision: StrictInt = Field(ge=1)
    arguments: dict[str, WorkflowInvocationScalar]
    target: ManagedCloudWorkflowTarget

    @field_validator("schema_version", mode="before")
    @classmethod
    def schema_version_is_an_exact_integer(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schemaVersion must be the integer 1.")
        return value


class WorkflowTargetDefaultModelSelection(WorkflowInvocationWireModel):
    kind: Literal["targetDefault"]


class WorkflowExactModelSelection(WorkflowInvocationWireModel):
    kind: Literal["exact"]
    model_id: str


WorkflowModelSelection = Annotated[
    WorkflowTargetDefaultModelSelection | WorkflowExactModelSelection,
    Field(discriminator="kind"),
]


class PortableWorkflowHarnessConfig(WorkflowInvocationWireModel):
    agent_kind: str
    model_selection: WorkflowModelSelection
    effort: str | None = None
    permission_policy: Literal["workflowDefault"]


class PortableWorkflowPromptStep(WorkflowInvocationWireModel):
    kind: Literal["agent.prompt"]
    prompt: str


class PortableWorkflowStage(WorkflowInvocationWireModel):
    harness_config: PortableWorkflowHarnessConfig
    steps: list[PortableWorkflowPromptStep]


class PortableWorkflowDefinition(WorkflowInvocationWireModel):
    inputs: list[WorkflowInputDefinition]
    stages: list[PortableWorkflowStage]


class RepositoryWorktreePlacement(WorkflowInvocationWireModel):
    kind: Literal["repositoryWorktree"]
    repo_config_id: UUID


class ScratchPlacement(WorkflowInvocationWireModel):
    kind: Literal["scratch"]


WorkflowInvocationPlacement = Annotated[
    RepositoryWorktreePlacement | ScratchPlacement,
    Field(discriminator="kind"),
]


class WorkflowInvocationResponse(WorkflowInvocationWireModel):
    id: UUID
    schema_version: Literal[1]
    workflow_definition_id: UUID
    definition_revision: int
    title: str
    description: str
    definition: PortableWorkflowDefinition
    arguments: dict[str, WorkflowInvocationScalar]
    placement: WorkflowInvocationPlacement
    target: ManagedCloudWorkflowTarget
    created_at: datetime


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


def workflow_invocation_response(
    value: WorkflowInvocationSnapshot,
) -> WorkflowInvocationResponse:
    return WorkflowInvocationResponse.model_validate(value.invocation_json)
