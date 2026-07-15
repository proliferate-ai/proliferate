"""Application service for personal workflow definitions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import repositories as repository_store
from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot
from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.workflows.domain.invocation import (
    EligibilityBlocker,
    ScalarValue,
    build_portable_definition,
    canonical_json,
    collect_run_eligibility_blockers,
    validate_invocation_arguments,
)
from proliferate.server.workflows.domain.validation import (
    DefinitionIssue,
    ValidatedDefinitionDocument,
    validate_definition_document,
)
from proliferate.server.workflows.errors import (
    InvalidWorkflowDefinition,
    InvalidWorkflowInvocation,
    UnavailableWorkflowCatalogSelection,
    WorkflowDefinitionNotFound,
    WorkflowDefinitionRevisionConflict,
    WorkflowInvocationConflict,
    WorkflowInvocationIneligible,
    WorkflowInvocationNotFound,
)
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionUpdateRequest,
    WorkflowInvocationCreateRequest,
    workflow_invocation_response,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class WorkflowInvocationPutResult:
    value: WorkflowInvocationSnapshot
    created: bool


async def list_workflow_definitions(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[WorkflowDefinitionSnapshot, ...]:
    return await workflow_store.list_workflow_definitions(db, user_id=user_id)


async def create_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    body: WorkflowDefinitionCreateRequest,
) -> WorkflowDefinitionSnapshot:
    await _validate_default_repository(
        db,
        user_id=user_id,
        repo_config_id=body.default_repo_config_id,
    )
    catalog = read_agent_catalog().catalog
    document = _validate_document(catalog, body)
    return await workflow_store.create_workflow_definition(
        db,
        user_id=user_id,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version=catalog.catalogVersion,
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=document.inputs,
        stages_json=document.stages,
    )


async def update_workflow_definition(
    db: AsyncSession,
    *,
    current: WorkflowDefinitionSnapshot,
    body: WorkflowDefinitionUpdateRequest,
) -> WorkflowDefinitionSnapshot:
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
    catalog = read_agent_catalog().catalog
    document = _validate_document(catalog, body)
    updated = await workflow_store.update_workflow_definition_if_revision(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
        expected_revision=body.expected_revision,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version=catalog.catalogVersion,
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=document.inputs,
        stages_json=document.stages,
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


async def delete_workflow_definition(
    db: AsyncSession,
    *,
    current: WorkflowDefinitionSnapshot,
    expected_revision: int,
) -> None:
    deleted = await workflow_store.soft_delete_workflow_definition_if_revision(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
        expected_revision=expected_revision,
    )
    if deleted is not None:
        return
    latest = await workflow_store.get_workflow_definition(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
    )
    raise WorkflowDefinitionRevisionConflict(
        expected_revision=expected_revision,
        current_revision=None if latest is None else latest.revision,
    )


async def workflow_run_eligibility(
    db: AsyncSession,
    *,
    definition: WorkflowDefinitionSnapshot,
) -> tuple[EligibilityBlocker, ...]:
    return await _workflow_run_eligibility(
        db,
        definition=definition,
        catalog=read_agent_catalog().catalog,
    )


async def _workflow_run_eligibility(
    db: AsyncSession,
    *,
    definition: WorkflowDefinitionSnapshot,
    catalog: AgentCatalogResponse,
) -> tuple[EligibilityBlocker, ...]:
    default_repository_available = True
    if definition.default_repo_config_id is not None:
        default_repository_available = (
            await repository_store.get_repo_config_by_id_for_user(
                db,
                user_id=definition.user_id,
                repo_config_id=definition.default_repo_config_id,
            )
            is not None
        )
    return collect_run_eligibility_blockers(
        catalog,
        stages=definition.stages_json,
        default_repo_config_id=definition.default_repo_config_id,
        default_repository_available=default_repository_available,
    )


async def put_workflow_invocation(
    db: AsyncSession,
    *,
    invocation_id_text: str,
    user_id: UUID,
    body: WorkflowInvocationCreateRequest,
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
            stored = WorkflowInvocationCreateRequest.model_validate(existing.creation_request_json)
            stored_identity = canonical_json(stored.model_dump(by_alias=True, mode="json"))
        except ValueError as error:
            raise InvalidWorkflowInvocation("Stored workflow invocation is invalid.") from error
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
    if definition.revision != body.expected_revision:
        raise WorkflowDefinitionRevisionConflict(
            expected_revision=body.expected_revision,
            current_revision=definition.revision,
        )

    catalog = read_agent_catalog().catalog
    blockers = await _workflow_run_eligibility(
        db,
        definition=definition,
        catalog=catalog,
    )
    if blockers:
        raise WorkflowInvocationIneligible(
            [
                {"code": blocker.code, "path": blocker.path, "message": blocker.message}
                for blocker in blockers
            ]
        )

    portable_definition = build_portable_definition(
        catalog,
        inputs=definition.inputs_json,
        stages=definition.stages_json,
    )
    arguments: dict[str, ScalarValue] = dict(body.arguments)
    try:
        validate_invocation_arguments(portable_definition, arguments)
        canonical_json(arguments)
    except ValueError as error:
        raise InvalidWorkflowInvocation(str(error)) from error

    placement: dict[str, object]
    if definition.default_repo_config_id is None:
        placement = {"kind": "scratch"}
    else:
        placement = {
            "kind": "repositoryWorktree",
            "repoConfigId": str(definition.default_repo_config_id),
        }

    created_at = utcnow()
    invocation_json: dict[str, object] = {
        "id": str(invocation_id),
        "schemaVersion": 1,
        "workflowDefinitionId": str(definition.id),
        "definitionRevision": definition.revision,
        "title": definition.title,
        "description": definition.description,
        "definition": portable_definition,
        "arguments": arguments,
        "placement": placement,
        "target": {"kind": "managedCloud"},
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
    }
    try:
        # Validate the immutable response before persistence. The parsed model
        # also rejects any accidental widening of the snapshot shape.
        response = workflow_invocation_response(
            WorkflowInvocationSnapshot(
                id=invocation_id,
                user_id=user_id,
                workflow_definition_id=definition.id,
                definition_revision=definition.revision,
                title_snapshot=definition.title,
                description_snapshot=definition.description,
                schema_version=1,
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
    )
    return WorkflowInvocationPutResult(value=created, created=True)


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


def _validate_document(
    catalog: AgentCatalogResponse,
    body: WorkflowDefinitionCreateRequest,
) -> ValidatedDefinitionDocument:
    result = validate_definition_document(
        catalog,
        inputs=cast(
            list[dict[str, object]],
            body.model_dump(by_alias=True, exclude_none=True)["inputs"],
        ),
        stages=cast(
            list[dict[str, object]],
            body.model_dump(by_alias=True, exclude_none=True)["stages"],
        ),
    )
    if isinstance(result, DefinitionIssue):
        error_type = (
            UnavailableWorkflowCatalogSelection
            if result.kind == "catalog_selection_unavailable"
            else InvalidWorkflowDefinition
        )
        raise error_type(result.message, path=result.path)
    return result


def _normalized_description(value: str) -> str:
    return value if value.strip() else ""
