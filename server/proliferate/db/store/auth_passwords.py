"""Password-auth credential and throttling stores."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.auth import (
    PASSWORD_LOGIN_BLOCK_SECONDS,
    PASSWORD_LOGIN_FAILURE_LIMIT,
    PASSWORD_LOGIN_WINDOW_SECONDS,
)
from proliferate.db.models.auth import PasswordLoginAttempt, User


@dataclass(frozen=True)
class PasswordLoginBucket:
    kind: str
    key: str


@dataclass(frozen=True)
class PasswordLoginBlock:
    bucket_kind: str
    blocked_until: datetime


async def get_user_by_normalized_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.email) == email).limit(1)
    )
    return result.scalar_one_or_none()


async def update_user_password_hash(
    db: AsyncSession,
    *,
    user_id: UUID,
    hashed_password: str,
    password_set_at: datetime,
) -> User | None:
    user = await db.get(User, user_id)
    if user is None:
        return None
    user.hashed_password = hashed_password
    user.password_set_at = password_set_at
    await db.flush()
    return user


async def active_password_login_blocks(
    db: AsyncSession,
    *,
    buckets: Iterable[PasswordLoginBucket],
    now: datetime,
) -> tuple[PasswordLoginBlock, ...]:
    blocks: list[PasswordLoginBlock] = []
    for bucket in buckets:
        attempt = await _get_attempt(db, bucket)
        if attempt is None or attempt.blocked_until is None:
            continue
        blocked_until = _aware(attempt.blocked_until)
        if blocked_until > now:
            blocks.append(
                PasswordLoginBlock(
                    bucket_kind=attempt.bucket_kind,
                    blocked_until=blocked_until,
                )
            )
    return tuple(blocks)


async def record_password_login_failure(
    db: AsyncSession,
    *,
    buckets: Iterable[PasswordLoginBucket],
    now: datetime,
) -> None:
    window_cutoff = now - timedelta(seconds=PASSWORD_LOGIN_WINDOW_SECONDS)
    blocked_until = now + timedelta(seconds=PASSWORD_LOGIN_BLOCK_SECONDS)
    for bucket in buckets:
        window_expired = PasswordLoginAttempt.window_started_at < window_cutoff
        next_failure_count = case(
            (window_expired, 1),
            else_=PasswordLoginAttempt.failure_count + 1,
        )
        insert_statement = postgresql_insert(PasswordLoginAttempt).values(
            id=uuid.uuid4(),
            bucket_kind=bucket.kind,
            bucket_key=bucket.key,
            failure_count=1,
            window_started_at=now,
            last_attempt_at=now,
            created_at=now,
            updated_at=now,
        )
        await db.execute(
            insert_statement.on_conflict_do_update(
                index_elements=[
                    PasswordLoginAttempt.bucket_kind,
                    PasswordLoginAttempt.bucket_key,
                ],
                set_={
                    "failure_count": next_failure_count,
                    "window_started_at": case(
                        (window_expired, now),
                        else_=PasswordLoginAttempt.window_started_at,
                    ),
                    "blocked_until": case(
                        (window_expired, None),
                        (
                            PasswordLoginAttempt.failure_count + 1 >= PASSWORD_LOGIN_FAILURE_LIMIT,
                            blocked_until,
                        ),
                        else_=PasswordLoginAttempt.blocked_until,
                    ),
                    "last_attempt_at": now,
                    "updated_at": now,
                },
            )
        )
    await db.flush()


async def clear_password_login_failures(
    db: AsyncSession,
    *,
    buckets: Iterable[PasswordLoginBucket],
) -> None:
    bucket_tuple = tuple(buckets)
    for bucket in bucket_tuple:
        await db.execute(
            delete(PasswordLoginAttempt).where(
                PasswordLoginAttempt.bucket_kind == bucket.kind,
                PasswordLoginAttempt.bucket_key == bucket.key,
            )
        )
    if bucket_tuple:
        await db.flush()


async def _get_attempt(
    db: AsyncSession,
    bucket: PasswordLoginBucket,
) -> PasswordLoginAttempt | None:
    result = await db.execute(
        select(PasswordLoginAttempt)
        .where(
            PasswordLoginAttempt.bucket_kind == bucket.kind,
            PasswordLoginAttempt.bucket_key == bucket.key,
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
