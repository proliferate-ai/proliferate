"""Application service for personal workflow definitions."""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import repositories as repository_store
from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.workflows.domain.validation import (
    DefinitionIssue,
    ValidatedDefinitionDocument,
    validate_definition_document,
)
from proliferate.server.workflows.errors import (
    InvalidWorkflowDefinition,
    UnavailableWorkflowCatalogSelection,
    WorkflowDefinitionRevisionConflict,
)
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionUpdateRequest,
)


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
