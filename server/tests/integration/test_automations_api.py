from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount, User
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _create_user_and_get_tokens(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email: str,
) -> dict[str, str]:
    user = User(
        email=email,
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Automation Tester",
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        OAuthAccount(
            user_id=user.id,
            oauth_name="github",
            access_token="github-access-token",
            account_id=f"github-{user.id}",
            account_email=email,
        )
    )
    await db_session.commit()

    token_payload = await mint_desktop_token_payload(
        client,
        user_id=user.id,
        state_prefix="automations-state",
    )
    return {"access_token": str(token_payload["access_token"])}


@pytest.mark.asyncio
async def test_automation_not_found_uses_global_error_handler(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="automation-error@example.com",
    )

    response = await client.get(
        f"/v1/automations/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "automation_not_found",
            "message": "Automation not found.",
        }
    }
