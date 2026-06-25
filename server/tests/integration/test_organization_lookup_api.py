from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from proliferate.auth.authorization import OwnerSelection
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.server.organizations import service as organization_service
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _create_user_and_get_tokens(
    client: AsyncClient,
    *,
    email: str,
    display_name: str = "Organization Tester",
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
        state_prefix="org-lookup-state",
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


async def _default_organization(client: AsyncClient, tokens: dict[str, str]) -> dict[str, object]:
    response = await client.get("/v1/organizations", headers=_headers(tokens))
    assert response.status_code == 200
    organizations = response.json()["organizations"]
    assert len(organizations) == 1
    return organizations[0]


@pytest.mark.asyncio
async def test_list_organizations_ensures_default_owned_organization(
    client: AsyncClient,
) -> None:
    user = await _create_user_and_get_tokens(client, email="no-team@acme.dev")

    response = await client.get("/v1/organizations", headers=_headers(user))

    assert response.status_code == 200
    organizations = response.json()["organizations"]
    assert len(organizations) == 1
    assert organizations[0]["name"] == "Acme"
    assert organizations[0]["logoDomain"] == "acme.dev"
    assert organizations[0]["membership"]["role"] == "owner"

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        organization_count = await session.scalar(select(Organization).limit(1))
    assert organization_count is not None


@pytest.mark.asyncio
async def test_resolve_owner_context_uses_threaded_db(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(
        client,
        email="owner@acme.dev",
        display_name="Owner User",
    )
    await _create_organization_for_user(user_id=owner["user_id"])
    organization = await _default_organization(client, owner)
    organization_id = uuid.UUID(str(organization["id"]))

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        user = await session.get(User, uuid.UUID(owner["user_id"]))
        assert user is not None
        context = await organization_service.resolve_owner_context(
            user,
            OwnerSelection(
                owner_scope="organization",
                organization_id=organization_id,
            ),
            db=session,
        )

    assert context.owner_scope == "organization"
    assert context.organization_id == organization_id
    assert context.membership_role == "owner"
