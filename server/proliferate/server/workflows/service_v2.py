"""Application service for gen-2 (schema_version 2) workflow definitions.

The v1 service is untouched; gen-2 rides beside it until PR7. Gen-2
invocations freeze the definition verbatim with a caller-chosen placement and
never enter the managed-execution lane — delivery to the local runtime is the
client courier's job.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import repositories as repository_store
from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.workflows.domain.invocation import (
    ScalarValue,
    canonical_json,
)
from proliferate.server.workflows.domain.validation_v2 import (
    INPUT_REFERENCE_PATTERN,
    validate_definition_v2_document,
)
from proliferate.server.workflows.errors import (
    InvalidWorkflowDefinition,
    InvalidWorkflowInvocation,
    WorkflowDefinitionNotFound,
    WorkflowDefinitionRevisionConflict,
    WorkflowInvocationConflict,
    WorkflowInvocationNotFound,
)
from proliferate.server.workflows.models_v2 import (
    WorkflowDefinitionCreateRequestV2,
    WorkflowDefinitionDocumentV2,
    WorkflowDefinitionUpdateRequestV2,
    WorkflowInvocationCreateRequestV2,
    workflow_invocation_response_v2,
)
from proliferate.server.workflows.service import WorkflowInvocationPutResult

__all__ = [
    "create_workflow_definition_v2",
    "update_workflow_definition_v2",
    "put_workflow_invocation_v2",
]


async def create_workflow_definition_v2(
    db: AsyncSession,
    *,
    user_id: UUID,
    body: WorkflowDefinitionCreateRequestV2,
) -> WorkflowDefinitionSnapshot:
    await _validate_default_repository(
        db,
        user_id=user_id,
        repo_config_id=body.default_repo_config_id,
    )
    _validate_document(body.definition)
    return await workflow_store.create_workflow_definition(
        db,
        user_id=user_id,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version="",
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=[],
        stages_json=[],
        schema_version=2,
        definition_json=body.definition.document_json(),
    )


async def update_workflow_definition_v2(
    db: AsyncSession,
    *,
    current: WorkflowDefinitionSnapshot,
    body: WorkflowDefinitionUpdateRequestV2,
) -> WorkflowDefinitionSnapshot:
    if current.schema_version != 2:
        raise InvalidWorkflowDefinition(
            "A schema version 1 definition cannot be updated with a version 2 document.",
            path="definition.schemaVersion",
        )
    if body.expected_revision != current.revision:
        raise WorkflowDefinitionRevisionConflict(
            expected_revision=body.expected_revision,
            current_revision=current.revision,
        )
    await _validate_default_repository(
        db,
        user_id=current.user_id,
        repo_config_id=body.default_repo_config_id,
    )
    _validate_document(body.definition)
    updated = await workflow_store.update_workflow_definition_if_revision(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
        expected_revision=body.expected_revision,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version="",
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=[],
        stages_json=[],
        definition_json=body.definition.document_json(),
    )
    if updated is not None:
        return updated
    latest = await workflow_store.get_workflow_definition(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
    )
    raise WorkflowDefinitionRevisionConflict(
        expected_revision=body.expected_revision,
        current_revision=None if latest is None else latest.revision,
    )


async def put_workflow_invocation_v2(
    db: AsyncSession,
    *,
    invocation_id_text: str,
    user_id: UUID,
    body: WorkflowInvocationCreateRequestV2,
) -> WorkflowInvocationPutResult:
    invocation_id = _canonical_uuid(invocation_id_text)
    request_json = cast(
        dict[str, object],
        body.model_dump(by_alias=True, mode="json"),
    )
    try:
        request_identity = canonical_json(request_json)
    except ValueError as error:
        raise InvalidWorkflowInvocation("Workflow invocation is not portable JSON.") from error

    await invocation_store.acquire_workflow_invocation_acceptance_lock(
        db,
        invocation_id=invocation_id,
    )
    existing = await invocation_store.get_workflow_invocation_global(
        db,
        invocation_id=invocation_id,
    )
    if existing is not None:
        if existing.user_id != user_id:
            raise WorkflowInvocationNotFound()
        try:
            stored = WorkflowInvocationCreateRequestV2.model_validate(
                existing.creation_request_json
            )
            stored_identity = canonical_json(stored.model_dump(by_alias=True, mode="json"))
        except ValueError as error:
            raise WorkflowInvocationConflict() from error
        if stored_identity != request_identity:
            raise WorkflowInvocationConflict()
        return WorkflowInvocationPutResult(value=existing, created=False)

    definition = await workflow_store.get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=body.workflow_definition_id,
    )
    if definition is None:
        raise WorkflowDefinitionNotFound()
    if definition.schema_version != 2 or definition.definition_json is None:
        raise InvalidWorkflowInvocation(
            "A schema version 2 invocation requires a schema version 2 definition."
        )

    placement_repo = await repository_store.get_repo_config_by_id_for_user(
        db,
        user_id=user_id,
        repo_config_id=body.placement.repo_config_id,
    )
    if placement_repo is None:
        raise InvalidWorkflowInvocation("Placement repository was not found.")

    document = WorkflowDefinitionDocumentV2.model_validate(definition.definition_json)
    arguments: dict[str, ScalarValue] = dict(body.arguments)
    try:
        _validate_v2_arguments(document, arguments)
        canonical_json(arguments)
    except ValueError as error:
        raise InvalidWorkflowInvocation(str(error)) from error

    created_at = utcnow()
    invocation_json: dict[str, object] = {
        "id": str(invocation_id),
        "schemaVersion": 2,
        "workflowDefinitionId": str(definition.id),
        "definitionRevision": definition.revision,
        "title": definition.title,
        "description": definition.description,
        "definition": definition.definition_json,
        "arguments": arguments,
        "placement": {
            "repoConfigId": str(body.placement.repo_config_id),
            "mode": body.placement.mode,
        },
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
    }
    try:
        response = workflow_invocation_response_v2(
            invocation_store.WorkflowInvocationSnapshot(
                id=invocation_id,
                user_id=user_id,
                workflow_definition_id=definition.id,
                definition_revision=definition.revision,
                title_snapshot=definition.title,
                description_snapshot=definition.description,
                schema_version=2,
                creation_request_json=request_json,
                invocation_json=invocation_json,
                created_at=created_at,
                updated_at=created_at,
            )
        )
        normalized_invocation_json = cast(
            dict[str, object],
            response.model_dump(by_alias=True, mode="json", exclude_none=True),
        )
        canonical_json(normalized_invocation_json)
    except ValueError as error:
        raise InvalidWorkflowInvocation("Workflow invocation could not be normalized.") from error

    created = await invocation_store.create_workflow_invocation(
        db,
        invocation_id=invocation_id,
        user_id=user_id,
        workflow_definition_id=definition.id,
        definition_revision=definition.revision,
        title_snapshot=definition.title,
        description_snapshot=definition.description,
        creation_request_json=request_json,
        invocation_json=normalized_invocation_json,
        created_at=created_at,
        schema_version=2,
    )
    return WorkflowInvocationPutResult(value=created, created=True)


def _validate_v2_arguments(
    document: WorkflowDefinitionDocumentV2,
    arguments: dict[str, ScalarValue],
) -> None:
    """Arguments must name declared inputs and cover every input any prompt references."""

    declared = {input_definition.name for input_definition in document.inputs}
    for name in arguments:
        if name not in declared:
            raise ValueError(f"argument '{name}' is not a declared input")
    for input_definition in document.inputs:
        if input_definition.required and input_definition.name not in arguments:
            raise ValueError(f"required input '{input_definition.name}' has no argument")
    for node in document.nodes:
        for name in INPUT_REFERENCE_PATTERN.findall(node.prompt):
            if name not in arguments:
                raise ValueError(f"prompt input '{name}' has no argument")


def _validate_document(document: WorkflowDefinitionDocumentV2) -> None:
    issue = validate_definition_v2_document(document)
    if issue is not None:
        raise InvalidWorkflowDefinition(issue.message, path=f"definition.{issue.path}")


def _canonical_uuid(value: str) -> UUID:
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise InvalidWorkflowInvocation(
            "invocationId must be a canonical lowercase UUID."
        ) from error
    if str(parsed) != value:
        raise InvalidWorkflowInvocation("invocationId must be a canonical lowercase UUID.")
    return parsed


async def _validate_default_repository(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_config_id: UUID | None,
) -> None:
    if repo_config_id is None:
        return
    repo = await repository_store.get_repo_config_by_id_for_user(
        db,
        user_id=user_id,
        repo_config_id=repo_config_id,
    )
    if repo is None:
        raise InvalidWorkflowDefinition(
            "Default repository was not found.",
            path="defaultRepoConfigId",
        )


def _normalized_description(value: str) -> str:
    return value if value.strip() else ""
