"""Cloud agent-auth usage store operations."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_router import (
    AgentGatewayLlmUsageEvent,
    AgentGatewayUsageImportCursor,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _llm_usage_event_record,
    _usage_import_cursor_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayLlmUsageEventRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayRouterMaterializationRecord,
    AgentGatewayUsageImportCursorRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def get_usage_import_cursor(
    db: AsyncSession,
    *,
    router_kind: str,
) -> AgentGatewayUsageImportCursorRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayUsageImportCursor).where(
                AgentGatewayUsageImportCursor.router_kind == router_kind
            )
        )
    ).scalar_one_or_none()
    return _usage_import_cursor_record(row) if row is not None else None


async def upsert_usage_import_cursor(
    db: AsyncSession,
    *,
    router_kind: str,
    last_seen_at: datetime | None,
    last_seen_router_log_id: str | None,
) -> AgentGatewayUsageImportCursorRecord:
    row = (
        await db.execute(
            select(AgentGatewayUsageImportCursor)
            .where(AgentGatewayUsageImportCursor.router_kind == router_kind)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayUsageImportCursor(
            router_kind=router_kind,
            last_seen_at=last_seen_at,
            last_seen_router_log_id=last_seen_router_log_id,
            updated_at=now,
        )
        db.add(row)
    else:
        row.last_seen_at = last_seen_at
        row.last_seen_router_log_id = last_seen_router_log_id
        row.updated_at = now
    await db.flush()
    return _usage_import_cursor_record(row)


async def insert_llm_usage_event_once(
    db: AsyncSession,
    *,
    router_kind: str,
    router_log_id: str,
    router_virtual_key_id: str | None,
    router_provider_key_id: str | None,
    materialization: AgentGatewayRouterMaterializationRecord | None,
    policy: AgentGatewayPolicyRecord | None,
    budget: AgentGatewayBudgetSubjectRecord | None,
    provider: str | None,
    model: str | None,
    status: str | None,
    cost_usd: str,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None,
    occurred_at: datetime | None,
    raw_usage_json: str,
) -> AgentGatewayLlmUsageEventRecord | None:
    existing = (
        await db.execute(
            select(AgentGatewayLlmUsageEvent).where(
                AgentGatewayLlmUsageEvent.router_kind == router_kind,
                AgentGatewayLlmUsageEvent.router_log_id == router_log_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return None
    row = AgentGatewayLlmUsageEvent(
        router_kind=router_kind,
        router_log_id=router_log_id,
        router_virtual_key_id=router_virtual_key_id,
        router_provider_key_id=router_provider_key_id,
        materialization_id=materialization.id if materialization is not None else None,
        policy_id=policy.id if policy is not None else None,
        budget_subject_id=budget.id if budget is not None else None,
        owner_scope=policy.owner_scope if policy is not None else None,
        owner_user_id=policy.owner_user_id if policy is not None else None,
        organization_id=policy.organization_id if policy is not None else None,
        agent_kind=materialization.agent_kind if materialization is not None else None,
        protocol_facade=materialization.protocol_facade if materialization is not None else None,
        provider=provider,
        model=model,
        status=status,
        cost_usd=cost_usd,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        occurred_at=occurred_at,
        imported_at=utcnow(),
        raw_usage_json=raw_usage_json,
    )
    db.add(row)
    await db.flush()
    return _llm_usage_event_record(row)


async def sum_llm_usage_cost_for_budget_subject(
    db: AsyncSession,
    *,
    budget_subject_id: UUID,
) -> Decimal:
    values = (
        (
            await db.execute(
                select(AgentGatewayLlmUsageEvent.cost_usd).where(
                    AgentGatewayLlmUsageEvent.budget_subject_id == budget_subject_id
                )
            )
        )
        .scalars()
        .all()
    )
    total = Decimal("0")
    for value in values:
        try:
            total += Decimal(value)
        except InvalidOperation:
            continue
    return total
