from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.analytics import ClientDailyActivity
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session
    from proliferate.db.models.auth import OAuthAccount

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Analytics Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="analytics-state",
    )
    return {
        "access_token": str(token_data["access_token"]),
        "user_id": user_id,
    }


@pytest.mark.asyncio
async def test_client_daily_activity_records_anonymous_install_once_per_day(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    install_uuid = uuid.uuid4()
    payload = {
        "surface": "desktop",
        "anonymousInstallUuid": str(install_uuid),
        "telemetryMode": "self_managed",
        "appVersion": "0.1.29",
        "platform": "darwin",
        "routeOrScreen": "startup",
    }

    first = await client.post("/v1/analytics/client-daily-activity", json=payload)
    second = await client.post("/v1/analytics/client-daily-activity", json=payload)

    assert first.status_code == 202
    assert second.status_code == 202

    rows = (
        (
            await db_session.execute(
                select(ClientDailyActivity).where(
                    ClientDailyActivity.anonymous_install_uuid == install_uuid
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].surface == "desktop"
    assert rows[0].actor_user_id is None
    assert rows[0].received_count == 2


@pytest.mark.asyncio
async def test_client_daily_activity_derives_authenticated_user_from_token(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    session = await _register_and_login(client, "analytics-user@example.com")
    attacker_user_id = uuid.uuid4()

    response = await client.post(
        "/v1/analytics/client-daily-activity",
        headers={"Authorization": f"Bearer {session['access_token']}"},
        json={
            "surface": "web",
            "actorUserId": str(attacker_user_id),
            "routeOrScreen": "home",
            "platform": "web",
        },
    )

    assert response.status_code == 202

    row = (
        await db_session.execute(
            select(ClientDailyActivity).where(ClientDailyActivity.surface == "web")
        )
    ).scalar_one()
    assert row.actor_user_id == uuid.UUID(session["user_id"])
    assert row.actor_user_id != attacker_user_id
    assert row.anonymous_install_uuid is None
    assert row.route_or_screen == "home"


@pytest.mark.asyncio
async def test_client_daily_activity_requires_anonymous_identity_when_unauthenticated(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/v1/analytics/client-daily-activity",
        json={"surface": "mobile", "routeOrScreen": "home"},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "anonymous_install_uuid_required"


@pytest.mark.asyncio
async def test_client_daily_activity_sanitizes_route_or_screen(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    install_uuid = uuid.uuid4()

    response = await client.post(
        "/v1/analytics/client-daily-activity",
        json={
            "surface": "desktop",
            "anonymousInstallUuid": str(install_uuid),
            "routeOrScreen": "/workspaces/proliferate-ai/proliferate?raw=true",
        },
    )

    assert response.status_code == 202
    row = (
        await db_session.execute(
            select(ClientDailyActivity).where(
                ClientDailyActivity.anonymous_install_uuid == install_uuid
            )
        )
    ).scalar_one()
    assert row.route_or_screen == "unknown"
