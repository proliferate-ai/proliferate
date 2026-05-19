from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.models.cloud.credentials import CloudCredential
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _create_user_and_get_tokens(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email: str,
    link_github: bool = True,
) -> dict[str, str]:
    user = User(
        email=email,
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Cloud Credential Tester",
    )
    db_session.add(user)
    await db_session.flush()
    if link_github:
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

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user.id,
        state_prefix="credentials-state",
    )
    return {
        "user_id": str(user.id),
        "access_token": str(token_data["access_token"]),
    }


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.asyncio
async def test_cloud_credential_sync_list_and_delete_thread_request_db(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="cloud-credential-sync@example.com",
    )
    headers = _headers(tokens)

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=headers,
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        },
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "changed": True}

    response = await client.get("/v1/cloud/credentials", headers=headers)
    assert response.status_code == 200
    claude_status = next(item for item in response.json() if item["provider"] == "claude")
    assert claude_status["synced"] is True

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=headers,
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        },
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "changed": False}

    records = (
        (
            await db_session.execute(
                select(CloudCredential).where(
                    CloudCredential.user_id == uuid.UUID(tokens["user_id"]),
                    CloudCredential.provider == "claude",
                    CloudCredential.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(records) == 1

    response = await client.delete("/v1/cloud/credentials/claude", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "changed": True}

    response = await client.get("/v1/cloud/credentials", headers=headers)
    assert response.status_code == 200
    claude_status = next(item for item in response.json() if item["provider"] == "claude")
    assert claude_status["synced"] is False


@pytest.mark.asyncio
async def test_cloud_credential_sync_requires_github_identity(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="cloud-credential-limited@example.com",
        link_github=False,
    )

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "github_link_required"


@pytest.mark.asyncio
async def test_cloud_credential_sync_invalid_payload_uses_product_error_handler(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="cloud-credential-invalid@example.com",
    )

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {},
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": {
            "code": "invalid_payload",
            "message": "Claude cloud sync requires at least one env var.",
        },
    }
