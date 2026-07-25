"""Wire models for personal workflow definitions and invocations."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    Strict,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_delivery_custody import (
    WorkflowDeliverySnapshot,
    WorkflowInvocationSnapshot,
)
from proliferate.server.workflows.domain.invocation import (
    validate_request_canonicalizable,
)
from proliferate.server.workflows.errors import InvalidWorkflowInvocation


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


# Strict scalar arguments (PR2 design §6.2): no cross-type coercion — a JSON
# string "3" is not a number, 1/0 are not booleans.
WorkflowArgumentWire = (
    Annotated[bool, Strict()]
    | Annotated[int, Strict()]
    | Annotated[float, Strict()]
    | Annotated[str, Strict(), StringConstraints(max_length=100_000)]
)


class WorkflowManagedCloudTarget(WorkflowWireModel):
    kind: Literal["managedCloud"]


class WorkflowDesktopTarget(WorkflowWireModel):
    kind: Literal["desktop"]
    desktop_install_id: Annotated[str, StringConstraints(min_length=1, max_length=255)]


WorkflowExecutionTargetRequest = Annotated[
    WorkflowManagedCloudTarget | WorkflowDesktopTarget,
    Field(discriminator="kind"),
]


class WorkflowRepositoryDefinitionDefaultChoice(WorkflowWireModel):
    kind: Literal["definitionDefault"]


class WorkflowRepositoryNoneChoice(WorkflowWireModel):
    kind: Literal["none"]


class WorkflowRepositoryEnvironmentChoice(WorkflowWireModel):
    kind: Literal["environment"]
    repo_environment_id: UUID


WorkflowRepositoryChoice = Annotated[
    WorkflowRepositoryDefinitionDefaultChoice
    | WorkflowRepositoryNoneChoice
    | WorkflowRepositoryEnvironmentChoice,
    Field(discriminator="kind"),
]


class WorkflowNewWorkspacePlacement(WorkflowWireModel):
    kind: Literal["newWorkspace"]
    repository: WorkflowRepositoryChoice
    base_ref: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
        | None
    ) = None


class WorkflowSessionBindingRequest(WorkflowWireModel):
    # Strict for the same raw-before-coercion reason as expected_revision.
    stage_index: Annotated[int, Strict()] = Field(ge=0, le=63)
    session_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
    ]


class WorkflowExistingWorkspacePlacement(WorkflowWireModel):
    kind: Literal["existingWorkspace"]
    workspace_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
    ]
    session_bindings: list[WorkflowSessionBindingRequest] = Field(
        default_factory=list, max_length=64
    )


WorkflowInvocationPlacementRequest = Annotated[
    WorkflowNewWorkspacePlacement | WorkflowExistingWorkspacePlacement,
    Field(discriminator="kind"),
]


class WorkflowInvocationCreateRequest(WorkflowWireModel):
    # Strict: lax coercion ("3", true -> 3, 1) would collapse distinct raw
    # requests into one normalized request hash (PR2 design §6.3).
    expected_revision: Annotated[int, Strict()] = Field(ge=1)
    inputs: dict[str, WorkflowArgumentWire] = Field(default_factory=dict)
    target: WorkflowExecutionTargetRequest
    placement: WorkflowInvocationPlacementRequest

    @model_validator(mode="before")
    @classmethod
    def _reject_non_canonical_raw(cls, data: object) -> object:
        # Coercion destroys the evidence: pydantic replaces lone surrogates
        # with U+FFFD during serialization, so the service-layer scan can no
        # longer see them. Scan the raw parsed body before any field
        # validation and raise the typed 400 directly (a ProliferateError is
        # not a ValueError, so pydantic lets it propagate to the app handler).
        if isinstance(data, dict):
            issue = validate_request_canonicalizable(data)
            if issue is not None:
                raise InvalidWorkflowInvocation(
                    issue.message, code=issue.code, path=issue.path
                )
        return data


class WorkflowDeliveryResponse(WorkflowWireModel):
    status: Literal["queued", "delivering", "accepted", "failed", "cancelled"]
    attempt_count: int
    handoff_started_at: datetime | None
    cancel_requested_at: datetime | None
    accepted_at: datetime | None
    finished_at: datetime | None
    error_code: str | None
    error_message: str | None
    anyharness_run_id: str | None
    anyharness_workspace_id: str | None
    runtime_revision: int | None
    runtime_observed_at: datetime | None
    control_plane_runtime_outcome: Literal["runtime_lost"] | None
    control_plane_runtime_outcome_at: datetime | None
    updated_at: datetime


class WorkflowInvocationResponse(WorkflowWireModel):
    id: UUID
    workflow_definition_id: UUID | None
    definition_revision: int
    definition_schema_version: int
    title_snapshot: str
    validated_catalog_version: str
    idempotency_key: str
    request_hash: str
    bundle_digest: str
    arguments: dict[str, object]
    target_kind: Literal["managedCloud", "desktop"]
    desktop_install_id: str | None
    logical_placement: dict[str, object]
    resolved_placement: dict[str, object]
    created_at: datetime
    delivery: WorkflowDeliveryResponse


class WorkflowInvocationDetailResponse(WorkflowInvocationResponse):
    resolved_bundle: dict[str, object]
    runtime_observation: dict[str, object] | None


class WorkflowInvocationListResponse(WorkflowWireModel):
    invocations: list[WorkflowInvocationResponse]


def _delivery_response(delivery: WorkflowDeliverySnapshot) -> WorkflowDeliveryResponse:
    return WorkflowDeliveryResponse.model_validate(
        {
            "status": delivery.status,
            "attemptCount": delivery.attempt_count,
            "handoffStartedAt": delivery.handoff_started_at,
            "cancelRequestedAt": delivery.cancel_requested_at,
            "acceptedAt": delivery.accepted_at,
            "finishedAt": delivery.finished_at,
            "errorCode": delivery.error_code,
            "errorMessage": delivery.error_message,
            "anyharnessRunId": delivery.anyharness_run_id,
            "anyharnessWorkspaceId": delivery.anyharness_workspace_id,
            "runtimeRevision": delivery.runtime_revision,
            "runtimeObservedAt": delivery.runtime_observed_at,
            "controlPlaneRuntimeOutcome": delivery.control_plane_runtime_outcome,
            "controlPlaneRuntimeOutcomeAt": delivery.control_plane_runtime_outcome_at,
            "updatedAt": delivery.updated_at,
        }
    )


def _invocation_fields(
    invocation: WorkflowInvocationSnapshot,
    delivery: WorkflowDeliverySnapshot,
) -> dict[str, object]:
    return {
        "id": invocation.id,
        "workflowDefinitionId": invocation.workflow_definition_id,
        "definitionRevision": invocation.definition_revision,
        "definitionSchemaVersion": invocation.definition_schema_version,
        "titleSnapshot": invocation.title_snapshot,
        "validatedCatalogVersion": invocation.validated_catalog_version,
        "idempotencyKey": invocation.idempotency_key,
        "requestHash": invocation.request_hash,
        "bundleDigest": invocation.bundle_digest,
        "arguments": dict(invocation.arguments_json),
        "targetKind": invocation.target_kind,
        "desktopInstallId": invocation.desktop_install_id,
        "logicalPlacement": dict(invocation.logical_placement_json),
        "resolvedPlacement": dict(invocation.resolved_placement_json),
        "createdAt": invocation.created_at,
        "delivery": _delivery_response(delivery),
    }


def workflow_invocation_response(
    invocation: WorkflowInvocationSnapshot,
    delivery: WorkflowDeliverySnapshot,
) -> WorkflowInvocationResponse:
    return WorkflowInvocationResponse.model_validate(_invocation_fields(invocation, delivery))


def workflow_invocation_detail_response(
    invocation: WorkflowInvocationSnapshot,
    delivery: WorkflowDeliverySnapshot,
) -> WorkflowInvocationDetailResponse:
    return WorkflowInvocationDetailResponse.model_validate(
        {
            **_invocation_fields(invocation, delivery),
            "resolvedBundle": dict(invocation.resolved_bundle_json),
            "runtimeObservation": (
                None
                if delivery.runtime_observation_json is None
                else dict(delivery.runtime_observation_json)
            ),
        }
    )


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
