"""User-scoped keyset history for managed Workflow invocations."""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocation, WorkflowManagedExecution
from proliferate.db.store.workflow_managed_execution import (
    WorkflowManagedExecutionSnapshot,
    snapshot_managed_execution,
)


@dataclass(frozen=True)
class WorkflowHistoryItem:
    invocation_id: UUID
    workflow_definition_id: UUID
    definition_revision: int
    title: str
    placement_kind: str
    target_kind: str
    created_at: datetime
    managed: WorkflowManagedExecutionSnapshot


@dataclass(frozen=True)
class WorkflowHistoryPage:
    items: tuple[WorkflowHistoryItem, ...]
    next_cursor: str | None


def _encode_cursor(created_at: datetime, invocation_id: UUID) -> str:
    raw = json.dumps(
        [created_at.isoformat(), str(invocation_id)],
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.b64decode(padded.encode(), altchars=b"-_", validate=True)
        value = json.loads(raw)
        if (
            not isinstance(value, list)
            or len(value) != 2
            or not isinstance(value[0], str)
            or not isinstance(value[1], str)
        ):
            raise ValueError
        created_at = datetime.fromisoformat(value[0])
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            raise ValueError
        return created_at, UUID(value[1])
    except (
        ValueError,
        TypeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as error:
        raise ValueError("Invalid workflow history cursor.") from error


async def list_definition_history(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    cursor: tuple[datetime, UUID] | None,
    limit: int,
) -> WorkflowHistoryPage:
    statement = (
        select(WorkflowInvocation, WorkflowManagedExecution)
        .join(
            WorkflowManagedExecution,
            WorkflowManagedExecution.invocation_id == WorkflowInvocation.id,
        )
        .where(
            WorkflowInvocation.user_id == user_id,
            WorkflowInvocation.workflow_definition_id == workflow_definition_id,
        )
    )
    if cursor is not None:
        created_at, invocation_id = cursor
        statement = statement.where(
            or_(
                WorkflowInvocation.created_at < created_at,
                and_(
                    WorkflowInvocation.created_at == created_at,
                    WorkflowInvocation.id < invocation_id,
                ),
            )
        )
    rows = (
        await db.execute(
            statement.order_by(
                WorkflowInvocation.created_at.desc(), WorkflowInvocation.id.desc()
            ).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    items = tuple(
        WorkflowHistoryItem(
            invocation_id=invocation.id,
            workflow_definition_id=invocation.workflow_definition_id,
            definition_revision=invocation.definition_revision,
            title=invocation.title_snapshot,
            placement_kind=str(invocation.invocation_json["placement"]["kind"]),
            target_kind=str(invocation.invocation_json["target"]["kind"]),
            created_at=invocation.created_at,
            managed=snapshot_managed_execution(managed),
        )
        for invocation, managed in page_rows
    )
    next_cursor = None
    if len(rows) > limit and page_rows:
        invocation = page_rows[-1][0]
        next_cursor = _encode_cursor(invocation.created_at, invocation.id)
    return WorkflowHistoryPage(items=items, next_cursor=next_cursor)
