from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from proliferate.constants.organizations import (
    ORGANIZATION_INVITATION_DELIVERY_SKIPPED,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
)
from proliferate.integrations import resend
from proliferate.permissions import CurrentOrgUser
from proliferate.server.organizations import service as organization_service
from tests.helpers.desktop_auth import mint_desktop_token_payload

TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAD"
    "hgGAWjR9awAAAABJRU5ErkJggg=="
)


async def _create_user_and_get_tokens(
    client: AsyncClient,
    *,
    email: str,
    display_name: str = "Organization Tester",
) -> dict[str, str]:
    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import OAuthAccount, User

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
        state_prefix="org-state",
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
async def test_organization_member_list_and_last_owner_protection(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(
        client,
        email="owner@acme.dev",
        display_name="Owner User",
    )
    await _create_organization_for_user(user_id=owner["user_id"])

    created = await _default_organization(client, owner)
    assert created["name"] == "Acme"
    assert created["logoDomain"] == "acme.dev"
    assert created["membership"]["role"] == "owner"

    organization_id = created["id"]
    membership_id = created["membership"]["id"]

    response = await client.patch(
        f"/v1/organizations/{organization_id}",
        headers=_headers(owner),
        json={"name": "Acme Labs", "logoImage": TINY_PNG_DATA_URL},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Acme Labs"
    assert response.json()["logoImage"].startswith("data:image/png;base64,")

    response = await client.get("/v1/organizations", headers=_headers(owner))
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["organizations"]] == [organization_id]

    response = await client.get(
        f"/v1/organizations/{organization_id}/members",
        headers=_headers(owner),
    )
    assert response.status_code == 200
    members = response.json()["members"]
    assert len(members) == 1
    assert members[0]["email"] == "owner@acme.dev"
    assert members[0]["displayName"] == "Owner User"
    assert members[0]["avatarUrl"] == "https://example.com/avatar.png"
    assert members[0]["authMethods"] == [
        {"provider": "github", "label": "GitHub", "brandLabel": None}
    ]

    removed_user = await _create_user_and_get_tokens(client, email="removed@acme.dev")
    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import SsoIdentity

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
        session.add(
            SsoIdentity(
                user_id=sso_user.id,
                organization_id=uuid.UUID(organization_id),
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
            OrganizationMembership(
                organization_id=uuid.UUID(organization_id),
                user_id=sso_user.id,
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            OrganizationMembership(
                organization_id=uuid.UUID(organization_id),
                user_id=uuid.UUID(removed_user["user_id"]),
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
                joined_at=now,
                removed_at=now,
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
    active_members = response.json()["members"]
    assert {member["email"] for member in active_members} == {"owner@acme.dev", "sso@acme.dev"}
    sso_member = next(member for member in active_members if member["email"] == "sso@acme.dev")
    assert sso_member["authMethods"] == [
        {"provider": "sso", "label": "SSO", "brandLabel": "Google SSO"}
    ]

    response = await client.patch(
        f"/v1/organizations/{organization_id}/members/{membership_id}",
        headers=_headers(owner),
        json={"role": "member"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_modify_own_membership"


@pytest.mark.asyncio
async def test_authenticated_users_cannot_create_arbitrary_organizations(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")

    response = await client.post(
        "/v1/organizations",
        headers=_headers(owner),
        json={"name": "Second Org"},
    )
    assert response.status_code == 405


@pytest.mark.asyncio
async def test_invitation_is_durable_before_email_delivery(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="durable-owner@acme.dev")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = uuid.UUID(organization["organization_id"])
    sent_invites: list[dict[str, str]] = []

    async def fake_send_organization_invitation_email(
        **kwargs: str,
    ) -> resend.ResendEmailResult:
        sent_invites.append(dict(kwargs))
        return resend.ResendEmailResult(provider_message_id=None, skipped=True)

    monkeypatch.setattr(
        resend,
        "send_organization_invitation_email",
        fake_send_organization_invitation_email,
    )

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        actor = await session.get(User, uuid.UUID(owner["user_id"]))
        assert actor is not None
        org_user = CurrentOrgUser(
            actor_user_id=actor.id,
            organization_id=organization_id,
            membership_id=uuid.UUID(organization["membership_id"]),
            role=ORGANIZATION_ROLE_OWNER,
        )
        result = await organization_service.create_invitation(
            session,
            org_user,
            inviter_email=actor.email,
            email="durable-member@acme.dev",
            role=ORGANIZATION_ROLE_MEMBER,
        )
        await session.rollback()

    assert result.invitation.email == "durable-member@acme.dev"
    assert result.invitation.delivery_status == ORGANIZATION_INVITATION_DELIVERY_SKIPPED
    assert sent_invites and sent_invites[0]["to_email"] == "durable-member@acme.dev"
    assert sent_invites[0]["invite_url"].endswith(f"/join/{organization_id}")

    async with engine_module.async_session_factory() as session:
        invitation = (
            await session.execute(
                select(OrganizationInvitation).where(
                    OrganizationInvitation.organization_id == organization_id,
                    OrganizationInvitation.email == "durable-member@acme.dev",
                )
            )
        ).scalar_one()

    assert invitation.delivery_status == ORGANIZATION_INVITATION_DELIVERY_SKIPPED


@pytest.mark.asyncio
async def test_admin_cannot_modify_existing_owner(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    admin = await _create_user_and_get_tokens(client, email="admin@acme.dev")

    await _create_organization_for_user(user_id=owner["user_id"])
    organization = await _default_organization(client, owner)
    organization_id = organization["id"]
    owner_membership_id = organization["membership"]["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "admin@acme.dev", "role": "admin"},
    )
    assert response.status_code == 201

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(admin),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 200

    response = await client.patch(
        f"/v1/organizations/{organization_id}/members/{owner_membership_id}",
        headers=_headers(admin),
        json={"role": "member"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "owner_membership_requires_owner"


@pytest.mark.asyncio
async def test_user_cannot_modify_or_remove_own_membership(
    client: AsyncClient,
) -> None:
    first_owner = await _create_user_and_get_tokens(client, email="first@acme.dev")
    second_owner = await _create_user_and_get_tokens(client, email="second@acme.dev")

    await _create_organization_for_user(user_id=first_owner["user_id"])
    organization = await _default_organization(client, first_owner)
    organization_id = organization["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(first_owner),
        json={"email": "second@acme.dev", "role": "owner"},
    )
    assert response.status_code == 201

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(second_owner),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 200
    second_membership_id = response.json()["organization"]["membership"]["id"]

    response = await client.patch(
        f"/v1/organizations/{organization_id}/members/{second_membership_id}",
        headers=_headers(second_owner),
        json={"role": "member"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_modify_own_membership"

    response = await client.delete(
        f"/v1/organizations/{organization_id}/members/{second_membership_id}",
        headers=_headers(second_owner),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_modify_own_membership"


@pytest.mark.asyncio
async def test_invitation_accepts_join_for_matching_email_and_replays_current_membership(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    invited = await _create_user_and_get_tokens(client, email="member@acme.dev")

    await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = (await _default_organization(client, owner))["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "member@acme.dev", "role": "member"},
    )
    assert response.status_code == 201
    invitation = response.json()
    assert invitation["email"] == "member@acme.dev"
    assert invitation["deliveryStatus"] == "skipped"

    response = await client.get(
        f"/v1/organizations/{organization_id}/join-link",
        headers=_headers(owner),
    )
    assert response.status_code == 200
    assert response.json()["url"].endswith(f"/join/{organization_id}")

    response = await client.get(
        f"/join/{organization_id}",
    )
    assert response.status_code == 200
    assert f"proliferate://join/{organization_id}" in response.text

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(invited),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 200
    accepted = response.json()["organization"]
    assert accepted["id"] == organization_id
    assert accepted["membership"]["role"] == "member"

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(invited),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 200
    replayed = response.json()["organization"]
    assert replayed["id"] == organization_id
    assert replayed["membership"]["id"] == accepted["membership"]["id"]


@pytest.mark.asyncio
async def test_current_user_can_accept_pending_invitation(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner-current@acme.dev")
    invited = await _create_user_and_get_tokens(client, email="current-member@acme.dev")
    wrong_user = await _create_user_and_get_tokens(client, email="wrong-current@acme.dev")

    await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = (await _default_organization(client, owner))["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "current-member@acme.dev", "role": "member"},
    )
    assert response.status_code == 201
    invitation = response.json()

    response = await client.get(
        "/v1/organizations/invitations/current",
        headers=_headers(invited),
    )
    assert response.status_code == 200
    current_invitations = response.json()["invitations"]
    assert [item["id"] for item in current_invitations] == [invitation["id"]]
    assert current_invitations[0]["organizationName"] == "Acme"

    response = await client.post(
        f"/v1/organizations/invitations/current/{invitation['id']}/accept",
        headers=_headers(wrong_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "invalid_invitation"

    response = await client.post(
        f"/v1/organizations/invitations/current/{invitation['id']}/accept",
        headers=_headers(invited),
    )
    assert response.status_code == 200
    accepted = response.json()["organization"]
    assert accepted["id"] == organization_id
    assert accepted["membership"]["role"] == "member"

    response = await client.get(
        "/v1/organizations/invitations/current",
        headers=_headers(invited),
    )
    assert response.status_code == 200
    assert response.json()["invitations"] == []

    response = await client.post(
        f"/v1/organizations/invitations/current/{invitation['id']}/accept",
        headers=_headers(invited),
    )
    assert response.status_code == 200
    replayed = response.json()["organization"]
    assert replayed["id"] == organization_id
    assert replayed["membership"]["id"] == accepted["membership"]["id"]


@pytest.mark.asyncio
async def test_invitation_accept_adds_membership_when_user_already_has_team(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner-conflict@acme.dev")
    invited = await _create_user_and_get_tokens(client, email="already-in-team@acme.dev")

    await _create_organization_for_user(user_id=owner["user_id"], name="Inviting Team")
    await _create_organization_for_user(user_id=invited["user_id"], name="Existing Team")
    organization_id = (await _default_organization(client, owner))["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "already-in-team@acme.dev", "role": "member"},
    )
    assert response.status_code == 201

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(invited),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 200
    accepted = response.json()["organization"]
    assert accepted["id"] == organization_id
    assert accepted["membership"]["role"] == "member"

    response = await client.get("/v1/organizations", headers=_headers(invited))
    assert response.status_code == 200
    organization_names = sorted(item["name"] for item in response.json()["organizations"])
    assert organization_names == ["Existing Team", "Inviting Team"]

    response = await client.get(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
    )
    assert response.status_code == 200
    assert response.json()["invitations"][0]["status"] == "accepted"


@pytest.mark.asyncio
async def test_invitation_accept_requires_matching_authenticated_email(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    wrong_user = await _create_user_and_get_tokens(client, email="wrong@acme.dev")

    await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = (await _default_organization(client, owner))["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "member@acme.dev", "role": "member"},
    )
    assert response.status_code == 201

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(wrong_user),
        json={"organizationId": organization_id},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "invitation_email_mismatch"
