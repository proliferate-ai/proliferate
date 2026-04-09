"""DB operations for auth-related tables."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.auth import AUTH_CODE_LIFETIME_SECONDS
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import DesktopAuthCode


async def create_auth_code(
    db: AsyncSession,
    *,
    user_id: UUID,
    code_challenge: str,
    code_challenge_method: str,
    state: str,
    redirect_uri: str,
) -> DesktopAuthCode:
    """Create a short-lived auth code for the desktop PKCE exchange."""
    code = secrets.token_urlsafe(48)
    auth_code = DesktopAuthCode(
        code=code,
        user_id=user_id,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        state=state,
        redirect_uri=redirect_uri,
    )
    db.add(auth_code)
    await db.commit()
    return auth_code


def _is_auth_code_expired(auth_code: DesktopAuthCode) -> bool:
    created = auth_code.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    expiry = created + timedelta(seconds=AUTH_CODE_LIFETIME_SECONDS)
    return datetime.now(UTC) > expiry


async def _get_active_auth_code(
    db: AsyncSession,
    *conditions: object,
) -> DesktopAuthCode | None:
    result = await db.execute(
        select(DesktopAuthCode)
        .where(
            *conditions,  # type: ignore[arg-type]  # SQLAlchemy mypy plugin limitation
            DesktopAuthCode.consumed == False,  # noqa: E712
        )
        .order_by(desc(DesktopAuthCode.created_at))
        .limit(1)
    )
    auth_code = result.scalar_one_or_none()
    if auth_code is None or _is_auth_code_expired(auth_code):
        return None
    return auth_code


async def consume_auth_code(
    db: AsyncSession,
    *,
    code: str,
) -> DesktopAuthCode | None:
    """Fetch and mark an auth code as consumed. Returns None if invalid or expired."""
    auth_code = await _get_active_auth_code(
        db,
        DesktopAuthCode.code == code,
    )
    if auth_code is None:
        return None

    auth_code.consumed = True
    await db.commit()
    return auth_code


async def consume_auth_code_for_state(
    db: AsyncSession,
    *,
    state: str,
    code_challenge: str,
    code_challenge_method: str = "S256",
) -> DesktopAuthCode | None:
    """Consume the newest valid auth code for a desktop browser flow."""
    auth_code = await _get_active_auth_code(
        db,
        DesktopAuthCode.state == state,
        DesktopAuthCode.code_challenge == code_challenge,
        DesktopAuthCode.code_challenge_method == code_challenge_method,
    )
    if auth_code is None:
        return None

    auth_code.consumed = True
    await db.commit()
    return auth_code


async def create_auth_code_for_user(
    *,
    user_id: UUID,
    code_challenge: str,
    code_challenge_method: str,
    state: str,
    redirect_uri: str,
) -> DesktopAuthCode:
    async with db_engine.async_session_factory() as db:
        return await create_auth_code(
            db,
            user_id=user_id,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            state=state,
            redirect_uri=redirect_uri,
        )


async def consume_auth_code_value(
    *,
    code: str,
) -> DesktopAuthCode | None:
    async with db_engine.async_session_factory() as db:
        return await consume_auth_code(db, code=code)


async def consume_auth_code_for_state_value(
    *,
    state: str,
    code_challenge: str,
    code_challenge_method: str = "S256",
) -> DesktopAuthCode | None:
    async with db_engine.async_session_factory() as db:
        return await consume_auth_code_for_state(
            db,
            state=state,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
        )
