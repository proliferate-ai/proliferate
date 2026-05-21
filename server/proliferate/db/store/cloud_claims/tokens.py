"""Cloud workspace direct-attach token persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.claims import CloudWorkspaceClaimToken
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudWorkspaceClaimTokenSnapshot:
    id: UUID
    claim_id: UUID
    token_jti_hash: str
    hash_key_id: str
    token_jti_prefix: str | None
    issued_to_user_id: UUID
    target_id: UUID
    anyharness_workspace_id: str
    anyharness_session_id: str | None
    permissions: str
    status: str
    issued_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None


def _snapshot(row: CloudWorkspaceClaimToken) -> CloudWorkspaceClaimTokenSnapshot:
    return CloudWorkspaceClaimTokenSnapshot(
        id=row.id,
        claim_id=row.claim_id,
        token_jti_hash=row.token_jti_hash,
        hash_key_id=row.hash_key_id,
        token_jti_prefix=row.token_jti_prefix,
        issued_to_user_id=row.issued_to_user_id,
        target_id=row.target_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        anyharness_session_id=row.anyharness_session_id,
        permissions=row.permissions,
        status=row.status,
        issued_at=row.issued_at,
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
        revoked_reason=row.revoked_reason,
    )


async def insert_claim_token(
    db: AsyncSession,
    *,
    claim_id: UUID,
    token_jti_hash: str,
    hash_key_id: str,
    token_jti_prefix: str | None,
    issued_to_user_id: UUID,
    target_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str | None,
    permissions: str,
    issued_at: datetime,
    expires_at: datetime,
) -> CloudWorkspaceClaimTokenSnapshot:
    row = CloudWorkspaceClaimToken(
        claim_id=claim_id,
        token_jti_hash=token_jti_hash,
        hash_key_id=hash_key_id,
        token_jti_prefix=token_jti_prefix,
        issued_to_user_id=issued_to_user_id,
        target_id=target_id,
        anyharness_workspace_id=anyharness_workspace_id,
        anyharness_session_id=anyharness_session_id,
        permissions=permissions,
        status="active",
        issued_at=issued_at,
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return _snapshot(row)


async def list_active_tokens_for_claim(
    db: AsyncSession,
    *,
    claim_id: UUID,
) -> tuple[CloudWorkspaceClaimTokenSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudWorkspaceClaimToken)
            .where(CloudWorkspaceClaimToken.claim_id == claim_id)
            .where(CloudWorkspaceClaimToken.status == "active")
            .order_by(CloudWorkspaceClaimToken.issued_at.asc())
        )
    ).scalars()
    return tuple(_snapshot(row) for row in rows)


async def list_revoked_token_hashes_for_target_window(
    db: AsyncSession,
    *,
    target_id: UUID,
    after_revoked_at: datetime | None,
    after_token_id: UUID | None,
    until_revoked_at: datetime,
    limit: int = 500,
) -> tuple[CloudWorkspaceClaimTokenSnapshot, ...]:
    query = (
        select(CloudWorkspaceClaimToken)
        .where(CloudWorkspaceClaimToken.target_id == target_id)
        .where(CloudWorkspaceClaimToken.status == "revoked")
        .where(CloudWorkspaceClaimToken.revoked_at.is_not(None))
        .where(CloudWorkspaceClaimToken.revoked_at <= until_revoked_at)
        .order_by(CloudWorkspaceClaimToken.revoked_at.asc(), CloudWorkspaceClaimToken.id.asc())
        .limit(limit)
    )
    if after_revoked_at is not None:
        cursor_token_id = after_token_id or UUID("00000000-0000-0000-0000-000000000000")
        query = query.where(
            or_(
                CloudWorkspaceClaimToken.revoked_at > after_revoked_at,
                and_(
                    CloudWorkspaceClaimToken.revoked_at == after_revoked_at,
                    CloudWorkspaceClaimToken.id > cursor_token_id,
                ),
            )
        )
    rows = (await db.execute(query)).scalars()
    return tuple(_snapshot(row) for row in rows)


async def get_claim_token_by_id(
    db: AsyncSession,
    token_id: UUID,
) -> CloudWorkspaceClaimTokenSnapshot | None:
    row = await db.get(CloudWorkspaceClaimToken, token_id)
    return _snapshot(row) if row is not None else None


async def revoke_claim_token(
    db: AsyncSession,
    *,
    token_id: UUID,
    reason: str,
    revoked_at: datetime | None = None,
) -> CloudWorkspaceClaimTokenSnapshot | None:
    row = await db.get(CloudWorkspaceClaimToken, token_id)
    if row is None:
        return None
    if row.status == "active":
        now = revoked_at or utcnow()
        row.status = "revoked"
        row.revoked_at = now
        row.revoked_reason = reason
        await db.flush()
    return _snapshot(row)


async def revoke_oldest_active_tokens_for_claim(
    db: AsyncSession,
    *,
    claim_id: UUID,
    keep_latest: int,
    reason: str,
    revoked_at: datetime | None = None,
) -> int:
    active = list(await list_active_tokens_for_claim(db, claim_id=claim_id))
    overflow = max(0, len(active) - keep_latest)
    if overflow == 0:
        return 0
    now = revoked_at or utcnow()
    revoked_count = 0
    for token in active[:overflow]:
        row = await db.get(CloudWorkspaceClaimToken, token.id)
        if row is None or row.status != "active":
            continue
        row.status = "revoked"
        row.revoked_at = now
        row.revoked_reason = reason
        revoked_count += 1
    if revoked_count:
        await db.flush()
    return revoked_count


async def revoke_active_tokens_for_claim(
    db: AsyncSession,
    *,
    claim_id: UUID,
    reason: str,
    revoked_at: datetime | None = None,
) -> int:
    now = revoked_at or utcnow()
    rows = (
        await db.execute(
            select(CloudWorkspaceClaimToken)
            .where(CloudWorkspaceClaimToken.claim_id == claim_id)
            .where(CloudWorkspaceClaimToken.status == "active")
            .with_for_update()
        )
    ).scalars()
    count = 0
    for row in rows:
        row.status = "revoked"
        row.revoked_at = now
        row.revoked_reason = reason
        count += 1
    if count:
        await db.flush()
    return count


async def expire_claim_tokens(
    db: AsyncSession,
    *,
    now: datetime,
) -> int:
    rows = (
        await db.execute(
            select(CloudWorkspaceClaimToken)
            .where(CloudWorkspaceClaimToken.status == "active")
            .where(CloudWorkspaceClaimToken.expires_at <= now)
        )
    ).scalars()
    count = 0
    for row in rows:
        row.status = "expired"
        count += 1
    if count:
        await db.flush()
    return count


async def prune_expired_claim_tokens(
    db: AsyncSession,
    *,
    before: datetime,
    limit: int = 500,
) -> int:
    rows = (
        await db.execute(
            select(CloudWorkspaceClaimToken)
            .where(CloudWorkspaceClaimToken.status == "expired")
            .where(CloudWorkspaceClaimToken.expires_at < before)
            .order_by(CloudWorkspaceClaimToken.expires_at.asc())
            .limit(limit)
        )
    ).scalars()
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    if count:
        await db.flush()
    return count
