import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount, User


async def _create_user_and_get_token(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email: str,
) -> tuple[str, str]:
    user = User(
        email=email,
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Auth Viewer Tester",
    )
    db_session.add(user)
    await db_session.commit()

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    authorize = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": str(user.id)},
        json={
            "state": f"viewer-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert authorize.status_code == 201

    token = await client.post(
        "/auth/desktop/token",
        json={
            "code": authorize.json()["code"],
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert token.status_code == 200
    return str(user.id), token.json()["access_token"]


async def _link_provider(
    db_session: AsyncSession,
    user_id: str,
    provider: str,
) -> None:
    db_session.add(
        OAuthAccount(
            user_id=uuid.UUID(user_id),
            oauth_name=provider,
            access_token=f"{provider}-access-token",
            account_id=f"{provider}-account-id",
            account_email=f"{provider}@example.com",
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_auth_viewer_marks_google_only_user_as_needing_github(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-google@example.com",
    )
    await _link_provider(db_session, user_id, "google")

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is False
    assert payload["onboardingState"] == "needs_github"
    linked = {provider["provider"]: provider for provider in payload["linkedProviders"]}
    assert linked["google"]["connected"] is True
    assert linked["github"]["connected"] is False


@pytest.mark.asyncio
async def test_auth_viewer_marks_github_user_as_active(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-github@example.com",
    )
    await _link_provider(db_session, user_id, "github")

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is True
    assert payload["onboardingState"] == "active"
    providers = {provider["provider"] for provider in payload["providerAvailability"]}
    assert providers == {"github", "google", "apple"}


@pytest.mark.asyncio
async def test_auth_viewer_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/v1/auth/viewer")

    assert response.status_code == 401
