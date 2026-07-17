"""Persistence and atomic transitions for integration action approvals."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integration_approvals import (
    CloudIntegrationActionApproval,
    CloudIntegrationActionApprovalEvent,
)

ACTIVE_STATUSES = ("pending", "approved")


@dataclass(frozen=True)
class ActionApprovalRecord:
    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    integration_account_id: UUID
    integration_account_auth_version: int
    runtime_worker_id: UUID
    gateway_session_id: UUID
    provider: str
    tool: str
    payload_digest: str
    binding_digest: str
    idempotency_key: str
    safe_summary: str
    safe_account_label: str
    safe_source_label: str
    safe_target: str | None
    safe_content_preview: str | None
    safe_content_character_count: int | None
    status: str
    expires_at: datetime
    approved_at: datetime | None
    rejected_at: datetime | None
    revoked_at: datetime | None
    consumed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ActionApprovalStateTransition:
    approval: ActionApprovalRecord
    from_status: str


def _record(row: CloudIntegrationActionApproval) -> ActionApprovalRecord:
    return ActionApprovalRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        integration_account_id=row.integration_account_id,
        integration_account_auth_version=row.integration_account_auth_version,
        runtime_worker_id=row.runtime_worker_id,
        gateway_session_id=row.gateway_session_id,
        provider=row.provider_namespace,
        tool=row.tool_name,
        payload_digest=row.payload_digest,
        binding_digest=row.binding_digest,
        idempotency_key=row.idempotency_key,
        safe_summary=row.safe_action_summary,
        safe_account_label=row.safe_account_label,
        safe_source_label=row.safe_source_label,
        safe_target=row.safe_target,
        safe_content_preview=row.safe_content_preview,
        safe_content_character_count=row.safe_content_character_count,
        status=row.status,
        expires_at=row.expires_at,
        approved_at=row.approved_at,
        rejected_at=row.rejected_at,
        revoked_at=row.revoked_at,
        consumed_at=row.consumed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_approval(db: AsyncSession, approval_id: UUID) -> ActionApprovalRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationActionApproval)
            .where(CloudIntegrationActionApproval.id == approval_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def get_approval_for_user(
    db: AsyncSession, *, approval_id: UUID, user_id: UUID
) -> ActionApprovalRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationActionApproval)
            .where(
                CloudIntegrationActionApproval.id == approval_id,
                CloudIntegrationActionApproval.owner_user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def list_approvals_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    visible_organization_ids: frozenset[UUID],
    status: str | None,
    limit: int = 100,
) -> tuple[ActionApprovalRecord, ...]:
    visibility_conditions = [CloudIntegrationActionApproval.organization_id.is_(None)]
    if visible_organization_ids:
        visibility_conditions.append(
            CloudIntegrationActionApproval.organization_id.in_(visible_organization_ids)
        )
    statement = select(CloudIntegrationActionApproval).where(
        CloudIntegrationActionApproval.owner_user_id == user_id,
        or_(*visibility_conditions),
    )
    if status is not None:
        statement = statement.where(CloudIntegrationActionApproval.status == status)
    rows = (
        (
            await db.execute(
                statement.order_by(CloudIntegrationActionApproval.created_at.desc())
                .limit(limit)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(row) for row in rows)


async def create_or_get_pending(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    runtime_worker_id: UUID,
    gateway_session_id: UUID,
    provider: str,
    tool: str,
    payload_digest: str,
    binding_digest: str,
    idempotency_key: str,
    safe_summary: str,
    safe_account_label: str,
    safe_source_label: str,
    safe_target: str | None,
    safe_content_preview: str | None,
    safe_content_character_count: int | None,
    expires_at: datetime,
    now: datetime,
) -> tuple[ActionApprovalRecord, bool]:
    """Create or atomically return the active row for one idempotency key.

    A no-op ``DO UPDATE ... RETURNING`` keeps conflict resolution and the read
    in one statement. The returned conflicting row remains locked until this
    transaction ends, so it cannot become terminal between conflict detection
    and a follow-up SELECT.
    """
    candidate_id = uuid4()
    insert_statement = insert(CloudIntegrationActionApproval).values(
        id=candidate_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        runtime_worker_id=runtime_worker_id,
        gateway_session_id=gateway_session_id,
        provider_namespace=provider,
        tool_name=tool,
        payload_digest=payload_digest,
        binding_digest=binding_digest,
        idempotency_key=idempotency_key,
        safe_action_summary=safe_summary,
        safe_account_label=safe_account_label,
        safe_source_label=safe_source_label,
        safe_target=safe_target,
        safe_content_preview=safe_content_preview,
        safe_content_character_count=safe_content_character_count,
        status="pending",
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    upsert_statement = insert_statement.on_conflict_do_update(
        index_elements=[CloudIntegrationActionApproval.idempotency_key],
        index_where=text("status IN ('pending', 'approved')"),
        set_={"idempotency_key": CloudIntegrationActionApproval.idempotency_key},
    ).returning(CloudIntegrationActionApproval)
    row = (await db.execute(upsert_statement)).scalar_one()
    return _record(row), row.id == candidate_id


async def transition_if_current(
    db: AsyncSession,
    *,
    approval_id: UUID,
    current_statuses: tuple[str, ...],
    target_status: str,
    now: datetime,
) -> ActionApprovalStateTransition | None:
    values: dict[str, object] = {"status": target_status, "updated_at": now}
    timestamp_column = {
        "approved": "approved_at",
        "rejected": "rejected_at",
        "revoked": "revoked_at",
        "consumed": "consumed_at",
    }.get(target_status)
    if timestamp_column is not None:
        values[timestamp_column] = now
    for current_status in current_statuses:
        row = (
            await db.execute(
                update(CloudIntegrationActionApproval)
                .where(
                    CloudIntegrationActionApproval.id == approval_id,
                    CloudIntegrationActionApproval.status == current_status,
                    CloudIntegrationActionApproval.expires_at > now,
                )
                .values(**values)
                .returning(CloudIntegrationActionApproval)
            )
        ).scalar_one_or_none()
        if row is not None:
            return ActionApprovalStateTransition(
                approval=_record(row),
                from_status=current_status,
            )
    return None


async def mark_expired_if_due(
    db: AsyncSession, *, approval_id: UUID, now: datetime
) -> ActionApprovalStateTransition | None:
    for current_status in ACTIVE_STATUSES:
        row = (
            await db.execute(
                update(CloudIntegrationActionApproval)
                .where(
                    CloudIntegrationActionApproval.id == approval_id,
                    CloudIntegrationActionApproval.status == current_status,
                    CloudIntegrationActionApproval.expires_at <= now,
                )
                .values(status="expired", updated_at=now)
                .returning(CloudIntegrationActionApproval)
            )
        ).scalar_one_or_none()
        if row is not None:
            return ActionApprovalStateTransition(
                approval=_record(row),
                from_status=current_status,
            )
    return None


async def expire_due_for_user(
    db: AsyncSession, *, user_id: UUID, now: datetime
) -> tuple[ActionApprovalStateTransition, ...]:
    transitions: list[ActionApprovalStateTransition] = []
    for current_status in ACTIVE_STATUSES:
        rows = (
            (
                await db.execute(
                    update(CloudIntegrationActionApproval)
                    .where(
                        CloudIntegrationActionApproval.owner_user_id == user_id,
                        CloudIntegrationActionApproval.status == current_status,
                        CloudIntegrationActionApproval.expires_at <= now,
                    )
                    .values(status="expired", updated_at=now)
                    .returning(CloudIntegrationActionApproval)
                )
            )
            .scalars()
            .all()
        )
        transitions.extend(
            ActionApprovalStateTransition(
                approval=_record(row),
                from_status=current_status,
            )
            for row in rows
        )
    return tuple(transitions)


async def consume_approved_matching(
    db: AsyncSession,
    *,
    approval_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    runtime_worker_id: UUID,
    gateway_session_id: UUID,
    provider: str,
    tool: str,
    payload_digest: str,
    binding_digest: str,
    now: datetime,
) -> ActionApprovalStateTransition | None:
    row = (
        await db.execute(
            update(CloudIntegrationActionApproval)
            .where(
                CloudIntegrationActionApproval.id == approval_id,
                CloudIntegrationActionApproval.status == "approved",
                CloudIntegrationActionApproval.expires_at > now,
                CloudIntegrationActionApproval.owner_user_id == owner_user_id,
                CloudIntegrationActionApproval.organization_id == organization_id,
                CloudIntegrationActionApproval.integration_account_id == integration_account_id,
                CloudIntegrationActionApproval.integration_account_auth_version
                == integration_account_auth_version,
                CloudIntegrationActionApproval.runtime_worker_id == runtime_worker_id,
                CloudIntegrationActionApproval.gateway_session_id == gateway_session_id,
                CloudIntegrationActionApproval.provider_namespace == provider,
                CloudIntegrationActionApproval.tool_name == tool,
                CloudIntegrationActionApproval.payload_digest == payload_digest,
                CloudIntegrationActionApproval.binding_digest == binding_digest,
            )
            .values(status="consumed", consumed_at=now, updated_at=now)
            .returning(CloudIntegrationActionApproval)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return ActionApprovalStateTransition(approval=_record(row), from_status="approved")


async def record_event(
    db: AsyncSession,
    *,
    approval_id: UUID,
    event_type: str,
    from_status: str | None,
    to_status: str,
    actor_type: str,
    actor_user_id: UUID | None,
    actor_runtime_worker_id: UUID | None,
    safe_action_summary: str,
    created_at: datetime,
) -> None:
    db.add(
        CloudIntegrationActionApprovalEvent(
            approval_id=approval_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            actor_runtime_worker_id=actor_runtime_worker_id,
            safe_action_summary=safe_action_summary,
            created_at=created_at,
            updated_at=created_at,
        )
    )
    await db.flush()
