"""Wire models for gen-2 (schema_version 2) workflow definitions.

The v2 document is one JSON blob — nodes, edges, inputs, docTemplates — with
no catalog coupling: the identical validation must be implementable on the
runtime plane, which has no CP catalog. Node ``model`` is a pass-through
config, and placement never appears in the DSL (it is a trigger-time binding
frozen into the invocation).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import ConfigDict, Field, StringConstraints, field_validator
from pydantic.alias_generators import to_camel

from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot
from proliferate.server.workflows.models import (
    WorkflowDefinitionWireModel,
    WorkflowInvocationRequestWireModel,
    WorkflowInvocationScalar,
    WorkflowInvocationWireModel,
    WorkflowWireModel,
)

NODE_ID_CONSTRAINTS = StringConstraints(
    strip_whitespace=True,
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z][A-Za-z0-9_-]*$",
)
DOC_SLUG_CONSTRAINTS = StringConstraints(
    min_length=1,
    max_length=64,
    pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
)
INPUT_NAME_CONSTRAINTS = StringConstraints(
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z][A-Za-z0-9_]*$",
)


class WorkflowNodeModelConfigV2(WorkflowDefinitionWireModel):
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
    control_values: dict[str, str] = Field(default_factory=dict)


class WorkflowNodeV2(WorkflowDefinitionWireModel):
    id: Annotated[str, NODE_ID_CONSTRAINTS]
    type: Literal["agent", "human_in_loop"]
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    prompt: Annotated[str, StringConstraints(min_length=1, max_length=100_000)]
    model: WorkflowNodeModelConfigV2 | None = None

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt is required.")
        return value


class WorkflowEdgeV2(WorkflowDefinitionWireModel):
    from_node: Annotated[str, NODE_ID_CONSTRAINTS] = Field(alias="from")
    to_node: Annotated[str, NODE_ID_CONSTRAINTS] = Field(alias="to")


class WorkflowInputV2(WorkflowDefinitionWireModel):
    name: Annotated[str, INPUT_NAME_CONSTRAINTS]
    description: Annotated[str, StringConstraints(max_length=20_000)] = ""
    required: bool


class WorkflowDocTemplateV2(WorkflowDefinitionWireModel):
    slug: Annotated[str, DOC_SLUG_CONSTRAINTS]
    producing_node_id: Annotated[str, NODE_ID_CONSTRAINTS]
    body: Annotated[str, StringConstraints(max_length=200_000)] = ""


class WorkflowDefinitionDocumentV2(WorkflowDefinitionWireModel):
    schema_version: Literal[2]
    nodes: list[WorkflowNodeV2] = Field(min_length=1, max_length=64)
    edges: list[WorkflowEdgeV2] = Field(default_factory=list, max_length=64)
    inputs: list[WorkflowInputV2] = Field(default_factory=list, max_length=64)
    doc_templates: list[WorkflowDocTemplateV2] = Field(default_factory=list, max_length=64)

    @field_validator("schema_version", mode="before")
    @classmethod
    def schema_version_is_an_exact_integer(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schemaVersion must be the integer 2.")
        return value

    def document_json(self) -> dict[str, object]:
        """The normalized stored/frozen form of this document.

        Omitted model/control values stay omitted: an empty map serializes as
        absent, matching the runtime serializer's ``skip_serializing_if`` —
        installed runtimes reject definition fields they do not know yet, so
        the document must never grow a field the author left out.
        """

        data = self.model_dump(by_alias=True, mode="json", exclude_none=True)
        for node, dumped in zip(self.nodes, data["nodes"], strict=True):
            if node.model is not None and not node.model.control_values:
                dumped["model"].pop("controlValues")
        return data


class WorkflowDefinitionCreateRequestV2(WorkflowDefinitionWireModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    description: Annotated[str, StringConstraints(max_length=20_000)] = ""
    # Shape-only (Ruling A): the id lives in the RUNTIME repo-root id space
    # (GET /v1/repo-roots), not the CP repo-config table — the CP stores it
    # opaquely and never resolves it. Resolution is the engine plane's job.
    default_repo_config_id: UUID | None = None
    definition: WorkflowDefinitionDocumentV2


class WorkflowDefinitionUpdateRequestV2(WorkflowDefinitionCreateRequestV2):
    expected_revision: int = Field(ge=1)


class WorkflowDefinitionResponseV2(WorkflowDefinitionWireModel):
    # Response construction remains name-friendly for internal Python callers,
    # mirroring the v1 response model.
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
    schema_version: Literal[2]
    revision: int
    default_repo_config_id: UUID | None
    definition: WorkflowDefinitionDocumentV2
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class WorkflowDefinitionListResponseV2(WorkflowWireModel):
    workflows: list[WorkflowDefinitionResponseV2]


class WorkflowInvocationPlacementV2(WorkflowInvocationWireModel):
    # Shape-only (Ruling A): the CP freezes placement verbatim and never
    # resolves it — for local v1 this carries a RUNTIME repo-root id, which is
    # not a CP repo-config id at all. Resolution is the engine plane's job.
    repo_config_id: Annotated[str, StringConstraints(min_length=1)]
    mode: Literal["worktree", "repo_root"]


class WorkflowInvocationCreateRequestV2(WorkflowInvocationRequestWireModel):
    schema_version: Literal[2]
    workflow_definition_id: UUID
    arguments: dict[str, WorkflowInvocationScalar]
    placement: WorkflowInvocationPlacementV2

    @field_validator("schema_version", mode="before")
    @classmethod
    def schema_version_is_an_exact_integer(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schemaVersion must be the integer 2.")
        return value


class WorkflowInvocationResponseV2(WorkflowInvocationWireModel):
    id: UUID
    schema_version: Literal[2]
    workflow_definition_id: UUID
    definition_revision: int
    title: str
    description: str
    definition: WorkflowDefinitionDocumentV2
    arguments: dict[str, WorkflowInvocationScalar]
    placement: WorkflowInvocationPlacementV2
    created_at: datetime

    def frozen_json(self) -> dict[str, object]:
        """The stored/delivered form of this invocation: the wire dump with
        the definition in its normalized ``document_json`` form, so the
        courier never hands the runtime a model field the author left empty
        — including definitions frozen before that rule existed."""

        data: dict[str, object] = self.model_dump(by_alias=True, mode="json", exclude_none=True)
        data["definition"] = self.definition.document_json()
        return data


def workflow_definition_response_v2(
    value: WorkflowDefinitionSnapshot,
) -> WorkflowDefinitionResponseV2:
    return WorkflowDefinitionResponseV2.model_validate(
        {
            "id": value.id,
            "userId": value.user_id,
            "title": value.title,
            "description": value.description,
            "schemaVersion": value.schema_version,
            "revision": value.revision,
            "defaultRepoConfigId": value.default_repo_config_id,
            "definition": value.definition_json,
            "createdAt": value.created_at,
            "updatedAt": value.updated_at,
            "deletedAt": value.deleted_at,
        }
    )


def workflow_invocation_response_v2(
    value: WorkflowInvocationSnapshot,
) -> WorkflowInvocationResponseV2:
    return WorkflowInvocationResponseV2.model_validate(value.invocation_json)
