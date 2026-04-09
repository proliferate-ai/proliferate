from __future__ import annotations

import base64
import hashlib
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.models import UserCreate
from proliferate.auth.users import UserManager
from tests.e2e.cloud.helpers.shared import AuthSession, CloudE2ETestError

PKCE_VERIFIER = "cloud-e2e-code-verifier-that-is-long-enough-for-pkce"


async def create_user_and_login(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    *,
    email_prefix: str,
) -> AuthSession:
    from proliferate.db.store.users import get_user_db

    user_id: str | None = None
    async for user_db in get_user_db(db_session):
        manager = UserManager(user_db)
        user = await manager.create(
            UserCreate(
                email=f"{email_prefix}-{uuid.uuid4().hex[:8]}@example.com",
                password=uuid.uuid4().hex + uuid.uuid4().hex,
                display_name="Cloud E2E",
            )
        )
        await db_session.commit()
        user_id = str(user.id)
        break

    if user_id is None:
        raise CloudE2ETestError("Failed to create a test user for cloud E2E auth.")
    return await mint_auth_session(client, user_id=user_id)


async def mint_auth_session(
    client: httpx.AsyncClient,
    *,
    user_id: str,
) -> AuthSession:
    digest = hashlib.sha256(PKCE_VERIFIER.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    authorize = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"cloud-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    authorize.raise_for_status()
    code = authorize.json()["code"]

    token = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": PKCE_VERIFIER,
            "grant_type": "authorization_code",
        },
    )
    token.raise_for_status()
    token_payload = token.json()
    return AuthSession(
        user_id=user_id,
        access_token=token_payload["access_token"],
        refresh_token=token_payload["refresh_token"],
    )


async def refresh_auth_session(
    client: httpx.AsyncClient,
    *,
    auth: AuthSession,
) -> AuthSession:
    token = await client.post(
        "/auth/desktop/refresh",
        json={
            "refresh_token": auth.refresh_token,
            "grant_type": "refresh_token",
        },
    )
    token.raise_for_status()
    token_payload = token.json()
    auth.access_token = token_payload["access_token"]
    auth.refresh_token = token_payload["refresh_token"]
    return auth
