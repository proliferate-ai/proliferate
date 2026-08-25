"""Persistence helpers for personal workflow definitions."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowDefinition
from proliferate.lib.infra.time.wall_clock import utcnow


@dataclass(frozen=True)
class WorkflowDefinitionSnapshot:
    id: UUID
    user_id: UUID
    title: str
    description: str
    schema_version: int
    revision: int
    validated_catalog_version: str
    default_repo_config_id: UUID | None
    inputs_json: tuple[dict[str, object], ...]
    stages_json: tuple[dict[str, object], ...]
    definition_json: dict[str, object] | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


def _snapshot(row: WorkflowDefinition) -> WorkflowDefinitionSnapshot:
    return WorkflowDefinitionSnapshot(
        id=row.id,
        user_id=row.user_id,
        title=row.title,
        description=row.description,
        schema_version=row.schema_version,
        revision=row.revision,
        validated_catalog_version=row.validated_catalog_version,
        default_repo_config_id=row.default_repo_config_id,
        inputs_json=tuple(deepcopy(row.inputs_json or [])),
        stages_json=tuple(deepcopy(row.stages_json or [])),
        definition_json=deepcopy(row.definition_json),
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


async def get_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
) -> WorkflowDefinitionSnapshot | None:
    row = (
        await db.execute(
            select(WorkflowDefinition).where(
                WorkflowDefinition.id == workflow_definition_id,
                WorkflowDefinition.user_id == user_id,
                WorkflowDefinition.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return None if row is None else _snapshot(row)


async def list_workflow_definitions(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[WorkflowDefinitionSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.user_id == user_id,
                    WorkflowDefinition.deleted_at.is_(None),
                )
                .order_by(
                    WorkflowDefinition.updated_at.desc(),
                    WorkflowDefinition.id.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)


async def create_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    description: str,
    validated_catalog_version: str,
    default_repo_config_id: UUID | None,
    inputs_json: list[dict[str, object]],
    stages_json: list[dict[str, object]],
    schema_version: int,
    definition_json: dict[str, object] | None = None,
) -> WorkflowDefinitionSnapshot:
    now = utcnow()
    row = WorkflowDefinition(
        user_id=user_id,
        title=title,
        description=description,
        schema_version=schema_version,
        revision=1,
        validated_catalog_version=validated_catalog_version,
        default_repo_config_id=default_repo_config_id,
        inputs_json=deepcopy(inputs_json),
        stages_json=deepcopy(stages_json),
        definition_json=deepcopy(definition_json),
        created_at=now,
        updated_at=now,
        deleted_at=None,
    )
    db.add(row)
    await db.flush()
    return _snapshot(row)


async def update_workflow_definition_if_revision(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    expected_revision: int,
    title: str,
    description: str,
    validated_catalog_version: str,
    default_repo_config_id: UUID | None,
    inputs_json: list[dict[str, object]],
    stages_json: list[dict[str, object]],
    definition_json: dict[str, object] | None = None,
) -> WorkflowDefinitionSnapshot | None:
    values: dict[str, object] = {
        "title": title,
        "description": description,
        "validated_catalog_version": validated_catalog_version,
        "default_repo_config_id": default_repo_config_id,
        "inputs_json": deepcopy(inputs_json),
        "stages_json": deepcopy(stages_json),
        "revision": WorkflowDefinition.revision + 1,
        "updated_at": utcnow(),
    }
    # v1 callers never carry a document; leaving the column untouched here is
    # what keeps a v2 row's definition_json safe from a v1-shaped update.
    if definition_json is not None:
        values["definition_json"] = deepcopy(definition_json)
    result = await db.execute(
        update(WorkflowDefinition)
        .where(
            WorkflowDefinition.id == workflow_definition_id,
            WorkflowDefinition.user_id == user_id,
            WorkflowDefinition.revision == expected_revision,
            WorkflowDefinition.deleted_at.is_(None),
        )
        .values(**values)
        .returning(WorkflowDefinition)
    )
    row = result.scalar_one_or_none()
    return None if row is None else _snapshot(row)


async def soft_delete_workflow_definition_if_revision(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    expected_revision: int,
) -> WorkflowDefinitionSnapshot | None:
    now = utcnow()
    result = await db.execute(
        update(WorkflowDefinition)
        .where(
            WorkflowDefinition.id == workflow_definition_id,
            WorkflowDefinition.user_id == user_id,
            WorkflowDefinition.revision == expected_revision,
            WorkflowDefinition.deleted_at.is_(None),
        )
        .values(
            revision=WorkflowDefinition.revision + 1,
            updated_at=now,
            deleted_at=now,
        )
        .returning(WorkflowDefinition)
    )
    row = result.scalar_one_or_none()
    return None if row is None else _snapshot(row)
