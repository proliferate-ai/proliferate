from __future__ import annotations

import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud import CloudCredential


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
        display_name="Cloud Credential Tester",
    )
    db_session.add(user)
    await db_session.commit()

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    response = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": str(user.id)},
        json={
            "state": f"credentials-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert response.status_code == 201

    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": response.json()["code"],
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert response.status_code == 200
    token_data = response.json()
    return {
        "user_id": str(user.id),
        "access_token": token_data["access_token"],
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
    claude_status = next(
        item for item in response.json() if item["provider"] == "claude"
    )
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
        await db_session.execute(
            select(CloudCredential).where(
                CloudCredential.user_id == uuid.UUID(tokens["user_id"]),
                CloudCredential.provider == "claude",
                CloudCredential.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    assert len(records) == 1

    response = await client.delete("/v1/cloud/credentials/claude", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "changed": True}

    response = await client.get("/v1/cloud/credentials", headers=headers)
    assert response.status_code == 200
    claude_status = next(
        item for item in response.json() if item["provider"] == "claude"
    )
    assert claude_status["synced"] is False
