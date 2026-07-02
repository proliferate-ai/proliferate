"""LiteLLM enrollment row persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ColumnElement, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
    AGENT_GATEWAY_SUBJECT_KIND_USER,
    AGENT_GATEWAY_SYNC_STATUS_FAILED,
    AGENT_GATEWAY_SYNC_STATUS_PENDING,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import AgentGatewayEnrollment
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.agent_gateway.mappers import enrollment_record
from proliferate.db.store.agent_gateway.records import AgentGatewayEnrollmentRecord
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow


async def ensure_enrollment_row(
    db: AsyncSession,
    *,
    subject_kind: str,
    billing_subject_id: UUID,
    user_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> AgentGatewayEnrollmentRecord:
    """Idempotently create the pending enrollment row for a subject."""
    index_elements: list[InstrumentedAttribute[UUID | None]]
    index_where: ColumnElement[bool]
    if subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER:
        if user_id is None or organization_id is not None:
            raise ValueError("A user enrollment requires user_id and no organization_id.")
        index_elements = [AgentGatewayEnrollment.user_id]
        index_where = (
            AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER
        ) & AgentGatewayEnrollment.revoked_at.is_(None)
    elif subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION:
        if organization_id is None or user_id is None:
            raise ValueError(
                "An organization enrollment requires organization_id and user_id "
                "(one virtual key per member, spec §2.3)."
            )
        index_elements = [
            AgentGatewayEnrollment.organization_id,
            AgentGatewayEnrollment.user_id,
        ]
        index_where = (
            AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION
        ) & AgentGatewayEnrollment.revoked_at.is_(None)
    else:
        raise ValueError(f"Unknown enrollment subject kind: {subject_kind}")

    now = utcnow()
    await db.execute(
        pg_insert(AgentGatewayEnrollment)
        .values(
            subject_kind=subject_kind,
            user_id=user_id,
            organization_id=organization_id,
            billing_subject_id=billing_subject_id,
            sync_status=AGENT_GATEWAY_SYNC_STATUS_PENDING,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=index_elements, index_where=index_where)
    )
    row = await _load_active_row(
        db,
        subject_kind=subject_kind,
        user_id=user_id,
        organization_id=organization_id,
    )
    if row is None:
        raise RuntimeError("Agent gateway enrollment disappeared after creation.")
    return enrollment_record(row)


async def _load_active_row(
    db: AsyncSession,
    *,
    subject_kind: str,
    user_id: UUID | None,
    organization_id: UUID | None,
) -> AgentGatewayEnrollment | None:
    query = select(AgentGatewayEnrollment).where(
        AgentGatewayEnrollment.subject_kind == subject_kind,
        AgentGatewayEnrollment.revoked_at.is_(None),
    )
    if subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER:
        query = query.where(AgentGatewayEnrollment.user_id == user_id)
    else:
        query = query.where(
            AgentGatewayEnrollment.organization_id == organization_id,
            AgentGatewayEnrollment.user_id == user_id,
        )
    return (await db.execute(query)).scalar_one_or_none()


async def get_enrollment_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    row = await _load_active_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_USER,
        user_id=user_id,
        organization_id=None,
    )
    return enrollment_record(row) if row is not None else None


async def get_enrollment_for_organization(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    """Fetch a single member's org enrollment (one virtual key per member)."""
    row = await _load_active_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
        user_id=user_id,
        organization_id=organization_id,
    )
    return enrollment_record(row) if row is not None else None


async def mark_enrollment_synced(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
    litellm_team_id: str,
    litellm_user_id: str | None,
    virtual_key_id: str | None,
    virtual_key: str | None,
    sync_fingerprint: str | None,
) -> AgentGatewayEnrollmentRecord:
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None:
        raise RuntimeError("Agent gateway enrollment not found.")
    row.litellm_team_id = litellm_team_id
    row.litellm_user_id = litellm_user_id
    row.virtual_key_id = virtual_key_id
    if virtual_key is not None:
        row.virtual_key_ciphertext = encrypt_text(virtual_key)
        row.virtual_key_ciphertext_key_id = AGENT_GATEWAY_CIPHERTEXT_KEY_ID
    row.sync_status = AGENT_GATEWAY_SYNC_STATUS_SYNCED
    row.sync_fingerprint = sync_fingerprint
    row.last_error_code = None
    row.last_error_message = None
    row.updated_at = utcnow()
    await db.flush()
    return enrollment_record(row)


async def mark_enrollment_failed(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
    error_code: str,
    error_message: str,
) -> AgentGatewayEnrollmentRecord:
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None:
        raise RuntimeError("Agent gateway enrollment not found.")
    row.sync_status = AGENT_GATEWAY_SYNC_STATUS_FAILED
    row.last_error_code = error_code
    row.last_error_message = error_message
    row.updated_at = utcnow()
    await db.flush()
    return enrollment_record(row)


async def list_enrollments_needing_sync(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[AgentGatewayEnrollmentRecord]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment)
                .where(
                    AgentGatewayEnrollment.revoked_at.is_(None),
                    AgentGatewayEnrollment.sync_status.in_(
                        [
                            AGENT_GATEWAY_SYNC_STATUS_PENDING,
                            AGENT_GATEWAY_SYNC_STATUS_FAILED,
                        ]
                    ),
                )
                .order_by(AgentGatewayEnrollment.updated_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_record(row) for row in rows]


async def list_user_ids_missing_enrollment(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[UUID]:
    """Users with no active personal enrollment row (backfill discovery)."""
    active_user_enrollment = (
        select(AgentGatewayEnrollment.id)
        .where(
            AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER,
            AgentGatewayEnrollment.user_id == User.id,
            AgentGatewayEnrollment.revoked_at.is_(None),
        )
        .exists()
    )
    rows = (
        await db.execute(
            select(User.id).where(~active_user_enrollment).order_by(User.created_at).limit(limit)
        )
    ).scalars()
    return list(rows.all())


async def list_org_memberships_missing_enrollment(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[tuple[UUID, UUID]]:
    """(organization_id, user_id) pairs for active memberships lacking a row.

    Symmetric to :func:`list_user_ids_missing_enrollment`: recovers org members
    whose join hook was lost so a per-member virtual key is still minted.
    """
    active_org_enrollment = (
        select(AgentGatewayEnrollment.id)
        .where(
            AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
            AgentGatewayEnrollment.organization_id == OrganizationMembership.organization_id,
            AgentGatewayEnrollment.user_id == OrganizationMembership.user_id,
            AgentGatewayEnrollment.revoked_at.is_(None),
        )
        .exists()
    )
    rows = await db.execute(
        select(
            OrganizationMembership.organization_id,
            OrganizationMembership.user_id,
        )
        .where(
            OrganizationMembership.status == "active",
            ~active_org_enrollment,
        )
        .order_by(OrganizationMembership.created_at)
        .limit(limit)
    )
    return [(org_id, user_id) for org_id, user_id in rows.all()]


async def get_enrollment_by_virtual_key_id(
    db: AsyncSession,
    *,
    virtual_key_id: str,
) -> AgentGatewayEnrollmentRecord | None:
    """Resolve an active enrollment from a LiteLLM key token hash.

    The importer keys off the spend-log ``api_key`` field, which equals the
    ``token_id`` stored as ``virtual_key_id`` at mint time.
    """
    row = (
        await db.execute(
            select(AgentGatewayEnrollment).where(
                AgentGatewayEnrollment.virtual_key_id == virtual_key_id,
                AgentGatewayEnrollment.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return enrollment_record(row) if row is not None else None


async def set_enrollment_budget_status(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
    budget_status: str,
) -> AgentGatewayEnrollmentRecord:
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None:
        raise RuntimeError("Agent gateway enrollment not found.")
    if row.budget_status != budget_status:
        row.budget_status = budget_status
        row.updated_at = utcnow()
        await db.flush()
    return enrollment_record(row)


async def get_enrollment_virtual_key_decrypted(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> str | None:
    """Internal-use fetch of the raw virtual key for materialization."""
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None or row.virtual_key_ciphertext is None:
        return None
    return decrypt_text(row.virtual_key_ciphertext)


async def revoke_enrollment(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None:
        return None
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        row.updated_at = row.revoked_at
        await db.flush()
    return enrollment_record(row)
