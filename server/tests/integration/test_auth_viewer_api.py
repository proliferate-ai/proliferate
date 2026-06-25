import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_account_readiness
from proliferate.db.models.auth import AuthIdentity, OAuthAccount, ProviderGrant, SsoIdentity, User
from proliferate.utils.crypto import encrypt_text
from tests.helpers.desktop_auth import mint_desktop_token_payload


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

    token_payload = await mint_desktop_token_payload(
        client,
        user_id=user.id,
        state_prefix="viewer-state",
    )
    return str(user.id), str(token_payload["access_token"])


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


async def _link_ready_github_identity(
    db_session: AsyncSession,
    user_id: str,
    *,
    expires_at: datetime | None = None,
    scopes_json: str = '["repo","user","user:email"]',
) -> uuid.UUID:
    identity = AuthIdentity(
        user_id=uuid.UUID(user_id),
        provider="github",
        provider_subject="github-account-id",
        email="github@example.com",
        email_verified=True,
    )
    db_session.add(identity)
    await db_session.flush()
    grant = ProviderGrant(
        user_id=uuid.UUID(user_id),
        auth_identity_id=identity.id,
        provider="github",
        access_token_ciphertext=encrypt_text("github-access-token"),
        scopes_json=scopes_json,
        status="ready",
        expires_at=expires_at,
    )
    db_session.add(grant)
    await db_session.commit()
    return grant.id


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
async def test_account_readiness_uses_legacy_github_without_backfill(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, _access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-legacy-github@example.com",
    )
    await _link_provider(db_session, user_id, "github")

    readiness = await get_account_readiness(db_session, user_id=uuid.UUID(user_id))

    assert readiness.product_ready is True
    assert readiness.missing_requirements == ()
    assert readiness.github_grant_status == "ready"
    canonical_identity = (
        await db_session.execute(
            select(AuthIdentity).where(AuthIdentity.user_id == uuid.UUID(user_id))
        )
    ).scalar_one_or_none()
    canonical_grant = (
        await db_session.execute(
            select(ProviderGrant).where(ProviderGrant.user_id == uuid.UUID(user_id))
        )
    ).scalar_one_or_none()
    assert canonical_identity is None
    assert canonical_grant is None


@pytest.mark.asyncio
async def test_auth_viewer_allows_multiple_google_identities_for_one_user(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-multiple-google@example.com",
    )
    for index in range(2):
        db_session.add(
            AuthIdentity(
                user_id=uuid.UUID(user_id),
                provider="google",
                provider_subject=f"google-account-id-{index}",
                email=f"google-{index}@example.com",
                email_verified=True,
            )
        )
    await db_session.commit()

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    google_rows = [
        provider for provider in payload["linkedProviders"] if provider["provider"] == "google"
    ]
    assert [row["accountEmail"] for row in google_rows] == [
        "google-0@example.com",
        "google-1@example.com",
    ]


@pytest.mark.asyncio
async def test_auth_viewer_includes_sso_identity(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-sso@example.com",
    )
    db_session.add(
        SsoIdentity(
            user_id=uuid.UUID(user_id),
            organization_id=None,
            connection_id=None,
            connection_key="deployment",
            protocol="oidc",
            provider_subject="sso-subject",
            email="viewer-sso@example.com",
            email_verified=True,
            display_name="Viewer SSO",
            linked_at=datetime.now(UTC),
            last_login_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    sso_rows = [
        provider for provider in payload["linkedProviders"] if provider["provider"] == "sso"
    ]
    assert sso_rows == [
        {
            "provider": "sso",
            "connected": True,
            "accountEmail": "viewer-sso@example.com",
            "accountId": "sso-subject",
            "displayName": "SSO",
            "brandLabel": None,
        }
    ]


@pytest.mark.asyncio
async def test_google_only_user_is_rejected_from_product_surface(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-product-gate@example.com",
    )
    await _link_provider(db_session, user_id, "google")

    response = await client.get(
        "/v1/cloud/workspaces",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 403
    assert response.json() == {
        "detail": {
            "code": "github_link_required",
            "message": "Connect GitHub before using Proliferate Cloud product surfaces.",
        }
    }


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
    await _link_ready_github_identity(db_session, user_id)

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
async def test_legacy_github_oauth_account_backfills_as_ready(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-legacy-github@example.com",
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
    linked = {provider["provider"]: provider for provider in payload["linkedProviders"]}
    assert linked["github"]["connected"] is True

    allowed = await client.get(
        "/v1/cloud/workspaces",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_github_grant_without_required_scopes_requires_reauth(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-github-missing-scopes@example.com",
    )
    await _link_ready_github_identity(db_session, user_id, scopes_json="[]")

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is False
    assert payload["onboardingState"] == "needs_github"

    blocked = await client.get(
        "/v1/cloud/workspaces",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "github_link_required"


@pytest.mark.asyncio
async def test_github_grant_with_user_scope_satisfies_email_requirement(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-github-user-scope@example.com",
    )
    grant_id = await _link_ready_github_identity(
        db_session,
        user_id,
        scopes_json='["repo","user"]',
    )

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is True
    assert payload["onboardingState"] == "active"

    grant = await db_session.get(ProviderGrant, grant_id)
    assert grant is not None
    assert grant.status == "ready"


@pytest.mark.asyncio
async def test_legacy_github_needs_reauth_grant_is_repaired_when_scopes_are_sufficient(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-github-legacy-scope@example.com",
    )
    grant_id = await _link_ready_github_identity(
        db_session,
        user_id,
        scopes_json='["repo","user"]',
    )
    grant = await db_session.get(ProviderGrant, grant_id)
    assert grant is not None
    grant.status = "needs_reauth"
    await db_session.commit()

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is True
    assert payload["onboardingState"] == "active"

    await db_session.refresh(grant)
    assert grant.status == "ready"


@pytest.mark.asyncio
async def test_expired_github_grant_requires_reauth(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user_id, access_token = await _create_user_and_get_token(
        client,
        db_session,
        email="viewer-expired-github@example.com",
    )
    grant_id = await _link_ready_github_identity(
        db_session,
        user_id,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )

    response = await client.get(
        "/v1/auth/viewer",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["githubConnected"] is False
    assert payload["onboardingState"] == "needs_github"
    refreshed_grant = await db_session.get(ProviderGrant, grant_id, populate_existing=True)
    assert refreshed_grant is not None
    assert refreshed_grant.status == "expired"


@pytest.mark.asyncio
async def test_auth_viewer_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/v1/auth/viewer")

    assert response.status_code == 401
