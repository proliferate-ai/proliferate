"""Cloud agent-auth budgets store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import AGENT_GATEWAY_BUDGET_DURATION_V1
from proliferate.db.models.cloud.agent_auth_gateway import (
    AgentGatewayBudgetSubject,
    AgentGatewayFreeCreditEntitlement,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _budget_subject_record,
    _free_credit_entitlement_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def ensure_managed_budget_subject(
    db: AsyncSession,
    *,
    organization_id: UUID,
    included_budget_usd: str,
    litellm_team_id: str | None,
    litellm_sync_status: str,
    litellm_sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayBudgetSubjectRecord:
    return await ensure_managed_budget_subject_for_owner(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        included_budget_usd=included_budget_usd,
        budget_duration=AGENT_GATEWAY_BUDGET_DURATION_V1,
        entitlement_source=None,
        entitlement_period_key=None,
        litellm_team_id=litellm_team_id,
        litellm_sync_status=litellm_sync_status,
        litellm_sync_fingerprint=litellm_sync_fingerprint,
        status=status,
        last_error_code=last_error_code,
        last_error_message=last_error_message,
    )


async def ensure_managed_budget_subject_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    included_budget_usd: str,
    budget_duration: str | None,
    entitlement_source: str | None,
    entitlement_period_key: str | None,
    litellm_team_id: str | None,
    litellm_sync_status: str,
    litellm_sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayBudgetSubjectRecord:
    owner_filters = [
        AgentGatewayBudgetSubject.owner_scope == owner_scope,
        AgentGatewayBudgetSubject.budget_kind == "proliferate_managed",
        AgentGatewayBudgetSubject.status != "revoked",
    ]
    if owner_scope == "personal":
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.owner_user_id == owner_user_id,
                AgentGatewayBudgetSubject.organization_id.is_(None),
            ]
        )
    else:
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.organization_id == organization_id,
                AgentGatewayBudgetSubject.owner_user_id.is_(None),
            ]
        )
    row = (
        await db.execute(select(AgentGatewayBudgetSubject).where(*owner_filters).with_for_update())
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayBudgetSubject(
            budget_kind="proliferate_managed",
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            litellm_team_id=litellm_team_id,
            included_budget_usd=included_budget_usd,
            budget_duration=budget_duration,
            entitlement_source=entitlement_source,
            entitlement_period_key=entitlement_period_key,
            litellm_sync_status=litellm_sync_status,
            litellm_sync_fingerprint=litellm_sync_fingerprint,
            status=status,
            revision=1,
            last_provisioned_at=now if litellm_sync_status == "synced" else None,
            last_litellm_reconciled_at=now if litellm_sync_status == "synced" else None,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        changed = (
            row.litellm_team_id != litellm_team_id
            or row.included_budget_usd != included_budget_usd
            or row.budget_duration != budget_duration
            or row.entitlement_source != entitlement_source
            or row.entitlement_period_key != entitlement_period_key
            or row.litellm_sync_status != litellm_sync_status
            or row.litellm_sync_fingerprint != litellm_sync_fingerprint
            or row.status != status
            or row.last_error_code != last_error_code
            or row.last_error_message != last_error_message
        )
        row.litellm_team_id = litellm_team_id
        row.included_budget_usd = included_budget_usd
        row.budget_duration = budget_duration
        row.entitlement_source = entitlement_source
        row.entitlement_period_key = entitlement_period_key
        row.litellm_sync_status = litellm_sync_status
        row.litellm_sync_fingerprint = litellm_sync_fingerprint
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if litellm_sync_status == "synced":
            row.last_provisioned_at = now
            row.last_litellm_reconciled_at = now
        if changed:
            row.revision += 1
        row.updated_at = now
    await db.flush()
    return _budget_subject_record(row)


async def get_managed_budget_subject(
    db: AsyncSession,
    organization_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    return await get_managed_budget_subject_for_owner(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
    )


async def get_managed_budget_subject_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
) -> AgentGatewayBudgetSubjectRecord | None:
    owner_filters = [
        AgentGatewayBudgetSubject.owner_scope == owner_scope,
        AgentGatewayBudgetSubject.budget_kind == "proliferate_managed",
        AgentGatewayBudgetSubject.status != "revoked",
    ]
    if owner_scope == "personal":
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.owner_user_id == owner_user_id,
                AgentGatewayBudgetSubject.organization_id.is_(None),
            ]
        )
    else:
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.organization_id == organization_id,
                AgentGatewayBudgetSubject.owner_user_id.is_(None),
            ]
        )
    row = (
        await db.execute(select(AgentGatewayBudgetSubject).where(*owner_filters))
    ).scalar_one_or_none()
    return _budget_subject_record(row) if row is not None else None


async def get_user_managed_budget_subject(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    return await get_managed_budget_subject_for_owner(
        db,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
    )


async def ensure_free_credit_entitlement(
    db: AsyncSession,
    *,
    user_id: UUID,
    source: str,
    period_key: str,
    included_budget_usd: str,
    status: str,
    budget_subject_id: UUID | None = None,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayFreeCreditEntitlementRecord:
    row = (
        await db.execute(
            select(AgentGatewayFreeCreditEntitlement)
            .where(
                AgentGatewayFreeCreditEntitlement.user_id == user_id,
                AgentGatewayFreeCreditEntitlement.source == source,
                AgentGatewayFreeCreditEntitlement.period_key == period_key,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayFreeCreditEntitlement(
            user_id=user_id,
            budget_subject_id=budget_subject_id,
            source=source,
            period_key=period_key,
            included_budget_usd=included_budget_usd,
            status=status,
            activated_at=now if status == "active" else None,
            exhausted_at=now if status == "exhausted" else None,
            revoked_at=now if status == "revoked" else None,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        changed = (
            row.budget_subject_id != budget_subject_id
            or row.included_budget_usd != included_budget_usd
            or row.status != status
            or row.last_error_code != last_error_code
            or row.last_error_message != last_error_message
        )
        row.budget_subject_id = budget_subject_id
        row.included_budget_usd = included_budget_usd
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if status == "active" and row.activated_at is None:
            row.activated_at = now
        if status == "exhausted" and row.exhausted_at is None:
            row.exhausted_at = now
        if status == "revoked" and row.revoked_at is None:
            row.revoked_at = now
        if changed:
            row.updated_at = now
    await db.flush()
    return _free_credit_entitlement_record(row)


async def get_free_credit_entitlement(
    db: AsyncSession,
    *,
    user_id: UUID,
    source: str,
    period_key: str,
) -> AgentGatewayFreeCreditEntitlementRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayFreeCreditEntitlement).where(
                AgentGatewayFreeCreditEntitlement.user_id == user_id,
                AgentGatewayFreeCreditEntitlement.source == source,
                AgentGatewayFreeCreditEntitlement.period_key == period_key,
            )
        )
    ).scalar_one_or_none()
    return _free_credit_entitlement_record(row) if row is not None else None


async def get_free_credit_entitlement_for_budget(
    db: AsyncSession,
    budget_subject_id: UUID,
    *,
    source: str | None = None,
    period_key: str | None = None,
) -> AgentGatewayFreeCreditEntitlementRecord | None:
    filters = [
        AgentGatewayFreeCreditEntitlement.budget_subject_id == budget_subject_id,
        AgentGatewayFreeCreditEntitlement.status != "revoked",
    ]
    if source is not None:
        filters.append(AgentGatewayFreeCreditEntitlement.source == source)
    if period_key is not None:
        filters.append(AgentGatewayFreeCreditEntitlement.period_key == period_key)
    row = (
        (
            await db.execute(
                select(AgentGatewayFreeCreditEntitlement)
                .where(*filters)
                .order_by(AgentGatewayFreeCreditEntitlement.updated_at.desc())
            )
        )
        .scalars()
        .first()
    )
    return _free_credit_entitlement_record(row) if row is not None else None


async def get_budget_subject(
    db: AsyncSession,
    budget_subject_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    row = await db.get(AgentGatewayBudgetSubject, budget_subject_id)
    return _budget_subject_record(row) if row is not None else None


async def list_managed_budget_subjects_for_reconciliation(
    db: AsyncSession,
    *,
    limit: int,
) -> tuple[AgentGatewayBudgetSubjectRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayBudgetSubject)
                .where(
                    AgentGatewayBudgetSubject.status != "revoked",
                    or_(
                        AgentGatewayBudgetSubject.litellm_sync_status != "synced",
                        AgentGatewayBudgetSubject.last_litellm_reconciled_at.is_(None),
                    ),
                )
                .order_by(
                    AgentGatewayBudgetSubject.last_litellm_reconciled_at.asc().nullsfirst(),
                    AgentGatewayBudgetSubject.updated_at.asc(),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_budget_subject_record(row) for row in rows)
