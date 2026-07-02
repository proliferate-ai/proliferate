"""Persistence for the first-run claim: setup token hash and claim-time queries."""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import InstanceSetupToken, User
from proliferate.utils.time import utcnow

_SETUP_TOKEN_ROW_ID = 1
_FIRST_RUN_CLAIM_LOCK_KEY = "proliferate-first-run-claim"


async def acquire_first_run_claim_lock(db: AsyncSession) -> None:
    """Serialize first-run claim attempts (and boot-time token minting).

    Transaction-scoped advisory lock: released automatically at commit or
    rollback, so a crashed claimer can never wedge the instance.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": _FIRST_RUN_CLAIM_LOCK_KEY},
    )


async def count_users(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count(User.id))) or 0)


async def get_setup_token_hash(db: AsyncSession) -> str | None:
    row = await db.get(InstanceSetupToken, _SETUP_TOKEN_ROW_ID)
    return row.token_hash if row is not None else None


async def save_setup_token_hash(db: AsyncSession, token_hash: str) -> None:
    now = utcnow()
    row = await db.get(InstanceSetupToken, _SETUP_TOKEN_ROW_ID)
    if row is None:
        db.add(
            InstanceSetupToken(
                id=_SETUP_TOKEN_ROW_ID,
                token_hash=token_hash,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        row.token_hash = token_hash
        row.updated_at = now
    await db.flush()


async def delete_setup_token(db: AsyncSession) -> None:
    row = await db.get(InstanceSetupToken, _SETUP_TOKEN_ROW_ID)
    if row is not None:
        await db.delete(row)
        await db.flush()
