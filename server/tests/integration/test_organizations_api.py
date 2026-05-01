from __future__ import annotations

import base64
import hashlib
import uuid
from collections.abc import Iterator

import pytest
from httpx import AsyncClient

from proliferate.server.organizations import service as organization_service

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
    from proliferate.db.models.auth import User

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
        await session.commit()
        user_id = str(user.id)

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    response = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"org-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert response.status_code == 201
    code = response.json()["code"]

    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert response.status_code == 200
    token_data = response.json()
    return {
        "user_id": user_id,
        "access_token": token_data["access_token"],
    }


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _default_organization(client: AsyncClient, tokens: dict[str, str]) -> dict[str, object]:
    response = await client.get("/v1/organizations", headers=_headers(tokens))
    assert response.status_code == 200
    organizations = response.json()["organizations"]
    assert len(organizations) == 1
    return organizations[0]


def _token_sequence(tokens: list[str]) -> Iterator[str]:
    yield from tokens


@pytest.mark.asyncio
async def test_default_organization_member_list_and_last_owner_protection(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(
        client,
        email="owner@acme.dev",
        display_name="Owner User",
    )

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
async def test_admin_cannot_modify_existing_owner(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    admin = await _create_user_and_get_tokens(client, email="admin@acme.dev")

    generated_tokens = _token_sequence(["raw-invite-token", "handoff-token"])
    monkeypatch.setattr(organization_service, "_new_token", lambda: next(generated_tokens))

    organization = await _default_organization(client, owner)
    organization_id = organization["id"]
    owner_membership_id = organization["membership"]["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "admin@acme.dev", "role": "admin"},
    )
    assert response.status_code == 201

    response = await client.get(
        "/v1/organizations/invitations/landing",
        params={"token": "raw-invite-token"},
    )
    assert response.status_code == 200

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(admin),
        json={"inviteHandoff": "handoff-token"},
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_owner = await _create_user_and_get_tokens(client, email="first@acme.dev")
    second_owner = await _create_user_and_get_tokens(client, email="second@acme.dev")

    generated_tokens = _token_sequence(["raw-invite-token", "handoff-token"])
    monkeypatch.setattr(organization_service, "_new_token", lambda: next(generated_tokens))

    organization = await _default_organization(client, first_owner)
    organization_id = organization["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(first_owner),
        json={"email": "second@acme.dev", "role": "owner"},
    )
    assert response.status_code == 201

    response = await client.get(
        "/v1/organizations/invitations/landing",
        params={"token": "raw-invite-token"},
    )
    assert response.status_code == 200

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(second_owner),
        json={"inviteHandoff": "handoff-token"},
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
async def test_invitation_handoff_accepts_matching_email_and_rejects_replay(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    invited = await _create_user_and_get_tokens(client, email="member@acme.dev")

    generated_tokens = _token_sequence(["raw-invite-token", "handoff-token"])
    monkeypatch.setattr(organization_service, "_new_token", lambda: next(generated_tokens))

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
        "/v1/organizations/invitations/landing",
        params={"token": "raw-invite-token"},
    )
    assert response.status_code == 200
    assert "handoff-token" in response.text
    assert "raw-invite-token" not in response.text

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(invited),
        json={"inviteHandoff": "handoff-token"},
    )
    assert response.status_code == 200
    accepted = response.json()["organization"]
    assert accepted["id"] == organization_id
    assert accepted["membership"]["role"] == "member"

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(invited),
        json={"inviteHandoff": "handoff-token"},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "invalid_invitation"


@pytest.mark.asyncio
async def test_invitation_accept_requires_matching_authenticated_email(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="owner@acme.dev")
    wrong_user = await _create_user_and_get_tokens(client, email="wrong@acme.dev")

    generated_tokens = _token_sequence(["raw-invite-token", "handoff-token"])
    monkeypatch.setattr(organization_service, "_new_token", lambda: next(generated_tokens))

    organization_id = (await _default_organization(client, owner))["id"]

    response = await client.post(
        f"/v1/organizations/{organization_id}/invitations",
        headers=_headers(owner),
        json={"email": "member@acme.dev", "role": "member"},
    )
    assert response.status_code == 201

    response = await client.get(
        "/v1/organizations/invitations/landing",
        params={"token": "raw-invite-token"},
    )
    assert response.status_code == 200

    response = await client.post(
        "/v1/organizations/invitations/accept",
        headers=_headers(wrong_user),
        json={"inviteHandoff": "handoff-token"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "invitation_email_mismatch"
