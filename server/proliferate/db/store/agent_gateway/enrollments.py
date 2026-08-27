"""LiteLLM enrollment row persistence."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
    AGENT_GATEWAY_SUBJECT_KIND_USER,
    AGENT_GATEWAY_SYNC_STATUS_FAILED,
    AGENT_GATEWAY_SYNC_STATUS_PENDING,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.models.agent_gateway import AgentGatewayEnrollment, LlmCreditGrant
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.agent_gateway.enrollment_keys import revoke_enrollment_keys
from proliferate.db.store.agent_gateway.mappers import enrollment_record
from proliferate.db.store.agent_gateway.records import AgentGatewayEnrollmentRecord
from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.lib.infra.time.wall_clock import utcnow

# The per-(org, member) LiteLLM user id prefix. A pre-migration row whose
# stored LiteLLM user does not carry it was provisioned under the old shared
# `user-<uuid>` identity and still needs its keys re-minted (D-3).
_ORG_SCOPED_LITELLM_USER_PREFIX = "org-%"


async def ensure_enrollment_row(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    organization_id: UUID,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    """Idempotently create the pending (org, member) enrollment row.

    Org-only (model-gateway.md §Account model): there is no personal
    (``subject_kind='user'``) insert path — the only remaining personal rows
    are retired pre-migration residue, kept for spend attribution.
    """
    now = utcnow()
    await db.execute(
        pg_insert(AgentGatewayEnrollment)
        .values(
            subject_kind=AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
            user_id=user_id,
            organization_id=organization_id,
            billing_subject_id=billing_subject_id,
            sync_status=AGENT_GATEWAY_SYNC_STATUS_PENDING,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                AgentGatewayEnrollment.organization_id,
                AgentGatewayEnrollment.user_id,
            ],
            index_where=(
                AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION
            )
            & AgentGatewayEnrollment.revoked_at.is_(None),
        )
    )
    row = await _load_active_org_row(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    if row is None:
        raise RuntimeError("Agent gateway enrollment disappeared after creation.")
    return enrollment_record(row)


async def _load_active_org_row(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> AgentGatewayEnrollment | None:
    query = select(AgentGatewayEnrollment).where(
        AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
        AgentGatewayEnrollment.revoked_at.is_(None),
        AgentGatewayEnrollment.organization_id == organization_id,
        AgentGatewayEnrollment.user_id == user_id,
    )
    return (await db.execute(query)).scalar_one_or_none()


async def get_enrollment_by_id(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    """Fetch an enrollment row directly by primary key, active or not.

    Used to resolve the parent enrollment from a per-harness child key row
    (``AgentGatewayEnrollmentKeyRecord.enrollment_id``); unlike the
    ``get_enrollment_for_*`` lookups this doesn't require the row to be
    active, since a revoked enrollment's billing subject is still needed for
    usage-import attribution of spend that happened before revocation.
    """
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    return enrollment_record(row) if row is not None else None


async def get_enrollment_for_organization(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord | None:
    """Fetch a single member's org enrollment (one virtual key per member)."""
    row = await _load_active_org_row(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    return enrollment_record(row) if row is not None else None


async def list_active_personal_enrollments(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[AgentGatewayEnrollmentRecord]:
    """Pre-migration ``subject_kind='user'`` rows not yet retired.

    Feed for the D-3 migration only: no other read path resolves personal
    enrollments anymore, and no write path creates them. Regardless of sync
    status — a personal row is converted, never re-synced.
    """
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment)
                .where(
                    AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER,
                    AgentGatewayEnrollment.revoked_at.is_(None),
                )
                .order_by(AgentGatewayEnrollment.created_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_record(row) for row in rows]


async def list_stale_identity_org_enrollments(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[AgentGatewayEnrollmentRecord]:
    """Synced org rows still provisioned under the shared ``user-<uuid>`` id.

    Feed for the D-3 migration's org sweep: these rows were minted before the
    per-(org, member) LiteLLM identity (``org-<org>-user-<id>``) existed, so
    their key-set fingerprint can never match today's expected material —
    running them through ``ensure_org_enrollment`` reopens them and re-mints
    their keys. Pending/failed rows are excluded: the ordinary backfill pass
    already re-syncs those.
    """
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment)
                .where(
                    AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
                    AgentGatewayEnrollment.revoked_at.is_(None),
                    AgentGatewayEnrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED,
                    AgentGatewayEnrollment.litellm_user_id.is_not(None),
                    AgentGatewayEnrollment.litellm_user_id.not_like(
                        _ORG_SCOPED_LITELLM_USER_PREFIX
                    ),
                )
                .order_by(AgentGatewayEnrollment.created_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_record(row) for row in rows]


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
        row.virtual_key_ciphertext = encrypt_text(virtual_key, secret=settings.cloud_secret_key)
        row.virtual_key_ciphertext_key_id = AGENT_GATEWAY_CIPHERTEXT_KEY_ID
    elif virtual_key_id is None:
        # Post-B2: per-harness keys live on the child table, not here. An
        # explicit (None, None) call means "this enrollment no longer carries
        # its own key material" — clear the parent's stale ciphertext too, not
        # just the id, so no decryptable-but-orphaned secret lingers.
        row.virtual_key_ciphertext = None
        row.virtual_key_ciphertext_key_id = None
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


async def mark_enrollment_pending(
    db: AsyncSession,
    *,
    enrollment_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    """Flip a synced enrollment back to ``pending`` so the sync path re-runs.

    Used by the drift check in ``enrollment.ensure_*_enrollment``: when the
    stored ``sync_fingerprint`` no longer matches the currently-expected key
    set (e.g. a new gateway-capable harness kind was added), the row must
    re-enter the sync path, which short-circuits on ``synced``. Key material,
    team, and budget are untouched — ``pending`` alone disables nothing.
    """
    row = await db.get(AgentGatewayEnrollment, enrollment_id)
    if row is None:
        raise RuntimeError("Agent gateway enrollment not found.")
    row.sync_status = AGENT_GATEWAY_SYNC_STATUS_PENDING
    row.updated_at = utcnow()
    await db.flush()
    return enrollment_record(row)


async def list_enrollments_needing_sync(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[AgentGatewayEnrollmentRecord]:
    """Org rows awaiting (re-)sync.

    Restricted to ``subject_kind='organization'``: the backfill worker has no
    sync path for personal residue — an unconverted personal row (e.g. its
    user still lacks a default org) must not consume the sync budget every
    tick; the D-3 migration pass owns it.
    """
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment)
                .where(
                    AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
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


async def list_org_memberships_missing_enrollment(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> list[tuple[UUID, UUID]]:
    """(organization_id, user_id) pairs for active memberships lacking a row.

    The backfill worker's only discovery source (org-only account model):
    recovers members whose signup/org-join hook was lost so per-member
    virtual keys are still minted.
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


async def list_active_org_enrollments_with_zero_grants(
    db: AsyncSession,
    *,
    older_than: datetime,
    limit: int = 50,
) -> list[AgentGatewayEnrollmentRecord]:
    """Aged active org enrollments whose billing subject holds NO credit grant.

    Feed for the zero-grant guard (ai_gateway spec, slice 5): a SYNCED
    enrollment is never revisited by the backfill, so a signup whose
    free-credit grant silently failed to land (e.g. the allocation stranded
    on a deleted account's orphaned org subject) stays unfunded forever
    without this sweep. ``older_than`` keeps the in-flight signup path (the
    enrollment row lands in the same flow as the grant) out of the feed, and
    zero ``llm_credit_grant`` rows of ANY source — free_signup, topup, admin,
    seat_pool — is what distinguishes "never funded" from merely exhausted.
    Newest first: old rows the guard classifies as unhealable must never
    starve fresh breakage out of the ``limit`` window.
    """
    has_any_grant = (
        select(LlmCreditGrant.id)
        .where(LlmCreditGrant.billing_subject_id == AgentGatewayEnrollment.billing_subject_id)
        .exists()
    )
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment)
                .where(
                    AgentGatewayEnrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
                    AgentGatewayEnrollment.revoked_at.is_(None),
                    AgentGatewayEnrollment.created_at < older_than,
                    ~has_any_grant,
                )
                .order_by(AgentGatewayEnrollment.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_record(row) for row in rows]


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


async def list_active_enrollments_for_subject(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
) -> list[AgentGatewayEnrollmentRecord]:
    """Active (non-revoked) enrollments billed to a subject."""
    rows = (
        (
            await db.execute(
                select(AgentGatewayEnrollment).where(
                    AgentGatewayEnrollment.billing_subject_id == billing_subject_id,
                    AgentGatewayEnrollment.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return [enrollment_record(row) for row in rows]


async def list_billing_subject_ids_with_active_enrollments(
    db: AsyncSession,
    *,
    limit: int = 1000,
    after: UUID | None = None,
) -> list[UUID]:
    """Distinct billing subjects that hold at least one active enrollment.

    The top-up worker scans these and filters to overage-enabled subjects;
    the join to ``billing_subject`` happens in the service layer so this
    store stays inside the agent-gateway table family.

    Ordered by ``billing_subject_id`` and keyset-paginated via ``after`` so
    callers can walk *every* subject (not just the first page) without offset
    drift: pass the last id from the previous page to fetch the next.
    """
    query = select(AgentGatewayEnrollment.billing_subject_id).where(
        AgentGatewayEnrollment.revoked_at.is_(None)
    )
    if after is not None:
        query = query.where(AgentGatewayEnrollment.billing_subject_id > after)
    rows = (
        (
            await db.execute(
                query.distinct().order_by(AgentGatewayEnrollment.billing_subject_id).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def list_organizations_with_limit_reached_enrollments(
    db: AsyncSession,
    *,
    limit: int = 500,
    after: UUID | None = None,
) -> list[tuple[UUID, UUID]]:
    """(organization_id, billing_subject_id) pairs holding a ``limit_reached`` member.

    The org-cap enforcement pass only re-evaluates orgs with *new* spend in the
    imported batch (see ``_enforce_org_llm_limits`` callers). If an org-wide cap
    disabled every member's key, the org stops producing new spend entirely, so
    a later cap raise or limit-disable would never be re-applied without this
    sweep: it finds every org still holding a ``limit_reached`` enrollment so
    the importer can re-check its cap each tick regardless of fresh spend.

    Keyset-paginated by ``organization_id`` so callers can walk every such org
    across pages, mirroring ``list_billing_subject_ids_with_active_enrollments``.
    """
    query = select(
        AgentGatewayEnrollment.organization_id,
        AgentGatewayEnrollment.billing_subject_id,
    ).where(
        AgentGatewayEnrollment.revoked_at.is_(None),
        AgentGatewayEnrollment.organization_id.is_not(None),
        AgentGatewayEnrollment.budget_status == AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
    )
    if after is not None:
        query = query.where(AgentGatewayEnrollment.organization_id > after)
    rows = await db.execute(
        query.distinct().order_by(AgentGatewayEnrollment.organization_id).limit(limit)
    )
    return [(organization_id, billing_subject_id) for organization_id, billing_subject_id in rows]


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
    return decrypt_text(row.virtual_key_ciphertext, secret=settings.cloud_secret_key)


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
        # Cascade: an enrollment's per-harness child keys are meaningless once
        # the parent (team/subject) is revoked.
        await revoke_enrollment_keys(db, enrollment_id=enrollment_id)
        await db.flush()
    return enrollment_record(row)
