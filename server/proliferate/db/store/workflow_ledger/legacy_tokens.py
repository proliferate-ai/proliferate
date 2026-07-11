"""Read-only legacy per-run gateway-token lookup.

WF-ID keeps lookup support only so pre-cutover credentials fail closed after
the migration revokes them. New execution remains hard-disabled until the
final-envelope producer and credential cutovers land together.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE
from proliferate.db.models.cloud.workflow_gateway_models import WorkflowRunGatewayToken


@dataclass(frozen=True)
class RunGatewayTokenRecord:
    id: UUID
    workflow_run_id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    scope_json: dict[str, dict[str, object]]
    status: str
    expires_at: datetime


def _record(row: WorkflowRunGatewayToken) -> RunGatewayTokenRecord:
    scope = row.scope_json if isinstance(row.scope_json, dict) else {}
    return RunGatewayTokenRecord(
        id=row.id,
        workflow_run_id=row.workflow_run_id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        scope_json=dict(scope),
        status=row.status,
        expires_at=row.expires_at,
    )


async def get_active_run_gateway_token_by_hash(
    db: AsyncSession, *, token_hash: str, now: datetime
) -> RunGatewayTokenRecord | None:
    row = (
        await db.execute(
            select(WorkflowRunGatewayToken).where(
                WorkflowRunGatewayToken.token_hash == token_hash,
                WorkflowRunGatewayToken.status == WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE,
                WorkflowRunGatewayToken.expires_at > now,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.last_used_at = now
    await db.flush()
    return _record(row)
