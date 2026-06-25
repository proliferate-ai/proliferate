from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount, SsoConnection, SsoIdentity, User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _create_user_and_get_tokens(
    client: AsyncClient,
    *,
    email: str,
    display_name: str = "Organization SSO Tester",
) -> dict[str, str]:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name=display_name,
            avatar_url="https://example.com/avatar.png",
        )
        session.add(user)
        await session.flush()
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

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="org-sso-state",
    )
    return {
        "user_id": user_id,
        "access_token": str(token_data["access_token"]),
    }


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _create_organization_for_user(
    *,
    user_id: str,
    name: str = "Acme",
    logo_domain: str | None = "acme.dev",
) -> dict[str, str]:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        now = datetime.now(UTC)
        organization = Organization(
            name=name,
            logo_domain=logo_domain,
            status=ORGANIZATION_STATUS_ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(organization)
        await session.flush()
        membership = OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(membership)
        await session.commit()
        return {
            "organization_id": str(organization.id),
            "membership_id": str(membership.id),
        }


@pytest.mark.asyncio
async def test_organization_member_auth_methods_exclude_other_org_sso(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = uuid.UUID(organization["organization_id"])

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        now = datetime.now(UTC)
        sso_user = User(
            email="sso@acme.dev",
            hashed_password="unused-sso-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="SSO User",
        )
        session.add(sso_user)
        await session.flush()

        other_organization = Organization(
            name="Other Org",
            logo_domain="other.dev",
            status=ORGANIZATION_STATUS_ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(other_organization)
        await session.flush()

        other_connection = SsoConnection(
            scope="organization",
            organization_id=other_organization.id,
            protocol="oidc",
            status="enabled",
            display_name="Other Org SSO",
            login_policy="optional",
            jit_policy="create_member",
            default_role=ORGANIZATION_ROLE_MEMBER,
            allowed_domains_json='["other.dev"]',
            oidc_issuer_url="https://accounts.google.com",
            oidc_client_id="other-client-id",
            created_at=now,
            updated_at=now,
        )
        session.add(other_connection)
        await session.flush()

        session.add(
            SsoIdentity(
                user_id=sso_user.id,
                organization_id=None,
                connection_id=None,
                connection_key="deployment",
                protocol="oidc",
                provider_subject="105348973383490238728",
                email="sso@acme.dev",
                email_verified=True,
                display_name="SSO User",
                linked_at=now,
                last_login_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            SsoIdentity(
                user_id=sso_user.id,
                organization_id=other_organization.id,
                connection_id=other_connection.id,
                connection_key=f"organization:{other_connection.id}",
                protocol="oidc",
                provider_subject="auth0|cross-org-subject",
                email="sso@acme.dev",
                email_verified=True,
                display_name="SSO User",
                linked_at=now,
                last_login_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            OrganizationMembership(
                organization_id=organization_id,
                user_id=sso_user.id,
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    response = await client.get(
        f"/v1/organizations/{organization_id}/members",
        headers=_headers(owner),
    )
    assert response.status_code == 200
    sso_member = next(
        member for member in response.json()["members"] if member["email"] == "sso@acme.dev"
    )
    assert sso_member["authMethods"] == [
        {"provider": "sso", "label": "SSO", "brandLabel": "Google SSO"}
    ]


@pytest.mark.asyncio
async def test_organization_member_auth_methods_include_password(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner-password@acme.dev")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = uuid.UUID(organization["organization_id"])

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        now = datetime.now(UTC)
        password_user = User(
            email="password@acme.dev",
            hashed_password="hashed-password",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Password User",
            password_set_at=now,
        )
        session.add(password_user)
        await session.flush()
        session.add(
            OrganizationMembership(
                organization_id=organization_id,
                user_id=password_user.id,
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    response = await client.get(
        f"/v1/organizations/{organization_id}/members",
        headers=_headers(owner),
    )
    assert response.status_code == 200
    password_member = next(
        member for member in response.json()["members"] if member["email"] == "password@acme.dev"
    )
    assert password_member["authMethods"] == [
        {"provider": "password", "label": "Email/password", "brandLabel": None}
    ]


@pytest.mark.asyncio
async def test_sso_jit_membership_allows_existing_user_with_another_active_org(
    client: AsyncClient,
) -> None:
    user = await _create_user_and_get_tokens(client, email="multi-org-sso@acme.dev")
    await _create_organization_for_user(user_id=user["user_id"], name="Personal Org")

    from proliferate.db import engine as engine_module
    from proliferate.db.store import auth_sso as sso_store

    async with engine_module.async_session_factory() as session:
        now = datetime.now(UTC)
        target_org = Organization(
            name="Target Org",
            logo_domain="target.dev",
            status=ORGANIZATION_STATUS_ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(target_org)
        await session.flush()

        await sso_store.ensure_sso_organization_membership(
            session,
            organization_id=target_org.id,
            user_id=uuid.UUID(user["user_id"]),
            role=ORGANIZATION_ROLE_MEMBER,
        )
        await session.commit()

    async with engine_module.async_session_factory() as session:
        active_memberships = (
            (
                await session.execute(
                    select(OrganizationMembership).where(
                        OrganizationMembership.user_id == uuid.UUID(user["user_id"]),
                        OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    )
                )
            )
            .scalars()
            .all()
        )

    assert len(active_memberships) == 2
