"""Worker revoked-JTI control helpers."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.models import (
    WorkerRevokedJtiEntry,
    WorkerRevokedJtisResponse,
)
from proliferate.utils.time import utcnow

_REVOKED_JTI_PAGE_SIZE = 500
_REVOKED_JTI_CURSOR_ZERO_ID = UUID("00000000-0000-0000-0000-000000000000")


async def mark_revoked_jtis_changed(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime | None = None,
) -> None:
    await worker_control_store.bump_revoked_jti_revision(
        db,
        target_id=target_id,
        now=now,
    )
    await publish_worker_control_after_commit(
        db,
        target_id=target_id,
        reason="revoked_jtis",
    )


async def list_revoked_jtis(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    cursor: str | None,
) -> WorkerRevokedJtisResponse:
    return await list_revoked_jtis_for_target(
        db,
        target_id=auth.target_id,
        cursor=cursor,
    )


async def list_revoked_jtis_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    cursor: str | None,
    until: datetime | None = None,
) -> WorkerRevokedJtisResponse:
    after_revoked_at, after_token_id = _parse_revoked_jti_cursor(cursor)
    until = until or utcnow()
    rows = await claim_tokens_store.list_revoked_token_hashes_for_target_window(
        db,
        target_id=target_id,
        after_revoked_at=after_revoked_at,
        after_token_id=after_token_id,
        until_revoked_at=until,
        limit=_REVOKED_JTI_PAGE_SIZE + 1,
    )
    has_more = len(rows) > _REVOKED_JTI_PAGE_SIZE
    tokens = rows[:_REVOKED_JTI_PAGE_SIZE]
    next_cursor = (
        _revoked_jti_cursor(tokens[-1].revoked_at, tokens[-1].id)
        if tokens and tokens[-1].revoked_at is not None
        else (cursor.strip() if cursor else "")
    )
    return WorkerRevokedJtisResponse(
        revoked_jtis=[
            WorkerRevokedJtiEntry(
                jti_hash=token.token_jti_hash,
                hash_key_id=token.hash_key_id,
                expires_at=token.expires_at.isoformat(),
                revoked_at=token.revoked_at.isoformat() if token.revoked_at else "",
            )
            for token in tokens
            if token.revoked_at is not None
        ],
        server_time=until.isoformat(),
        next_cursor=next_cursor,
        has_more=has_more,
    )


def _parse_revoked_jti_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
    if cursor is None or not cursor.strip():
        return None, None
    raw_timestamp, separator, raw_id = cursor.partition("|")
    try:
        revoked_at = datetime.fromisoformat(raw_timestamp)
    except ValueError:
        return None, None
    if not separator:
        return revoked_at, _REVOKED_JTI_CURSOR_ZERO_ID
    try:
        token_id = UUID(raw_id)
    except ValueError:
        token_id = _REVOKED_JTI_CURSOR_ZERO_ID
    return revoked_at, token_id


def _revoked_jti_cursor(revoked_at: datetime, token_id: UUID) -> str:
    return f"{revoked_at.isoformat()}|{token_id}"
