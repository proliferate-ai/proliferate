"""Shared helpers for worker enrollment and heartbeat tests.

Enrolling a worker and driving one heartbeat is the setup for several suites
(runtime-worker enrollment and the snapshot-upload
eligibility boundary). The helpers live here once so those suites share one
definition of "a desktop worker".
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from tests.helpers.auth_session import create_user_and_login
from tests.helpers.github_identity import seed_linked_github_account


async def seed_owner(db_session: AsyncSession, *, prefix: str) -> User:
    user = User(
        email=f"{prefix}-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def heartbeat(client: AsyncClient, worker_token: str) -> dict:
    response = await client.post(
        "/v1/cloud/worker/heartbeat",
        headers={"Authorization": f"Bearer {worker_token}"},
        json={},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ── Desktop workers ────────────────────────────────────────────────────────


async def authed_user(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{prefix}",
    )
    return auth


async def desktop_enrollment_token(
    client: AsyncClient,
    auth,
    *,
    install_id: str,
) -> str:
    response = await client.post(
        "/v1/cloud/workers/desktop/enrollment",
        headers=auth.headers,
        json={"desktopInstallId": install_id},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["expiresAt"]
    assert body["pendingTicketPolicy"] == "newest_wins"
    return body["enrollmentToken"]


async def enroll_worker(client: AsyncClient, auth, *, install_id: str) -> dict:
    token = await desktop_enrollment_token(client, auth, install_id=install_id)
    enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
    assert enroll.status_code == 200, enroll.text
    return enroll.json()
