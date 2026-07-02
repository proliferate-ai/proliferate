"""Tests for invite-as-allowlist self-registration (single-org mode)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import hash_password, verify_password
from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_INVITATION_STATUS_ACCEPTED,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import OrganizationInvitation, OrganizationMembership
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store.auth_passwords import update_user_password_hash
from proliferate.server.organizations.membership_policy import claim_instance_organization
from proliferate.utils.time import utcnow

# Real-shaped domains: the invitation API validates emails strictly (EmailStr)
# and rejects reserved TLDs like .test.
OWNER_EMAIL = "owner@example.com"
INVITED_EMAIL = "teammate@example.com"
PASSWORD = "a-strong-enough-password"
REGISTER_PATH = "/auth/password/register"


def _factory(test_engine):
    return async_sessionmaker(test_engine, expire_on_commit=False)


def _payload(*, email=INVITED_EMAIL, password=PASSWORD, invitation_token=None):
    return {
        "email": email,
        "password": password,
        "invitationToken": invitation_token if invitation_token is not None else str(uuid4()),
    }


@pytest_asyncio.fixture
async def single_org_client(test_engine, monkeypatch):
    """Test client with single-org mode on, mirroring the conftest client."""
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app

    monkeypatch.setattr(settings, "single_org_mode_override", True)

    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = _factory(test_engine)

    app = create_app()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    engine_module.engine = original_engine
    engine_module.async_session_factory = original_session_factory


async def _claim_instance(test_engine):
    """Seed the claimed state: an owner account plus THE instance organization."""
    async with _factory(test_engine)() as session:
        owner = await create_auth_user(
            session,
            email=OWNER_EMAIL,
            display_name=None,
            avatar_url=None,
        )
        organization = await claim_instance_organization(session, owner)
        await session.commit()
        return owner.id, organization.id


async def _invite(test_engine, organization_id, *, email=INVITED_EMAIL, role=None):
    async with _factory(test_engine)() as session:
        owner = (await session.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
        record = await invitation_store.create_or_rotate_organization_invitation(
            session,
            organization_id=organization_id,
            email=email,
            role=role or ORGANIZATION_ROLE_MEMBER,
            invited_by_user_id=owner.id,
            expires_at=utcnow() + timedelta(days=7),
        )
        await session.commit()
        assert record is not None
        return record.invitation.id


async def _count_users(test_engine) -> int:
    async with _factory(test_engine)() as session:
        return int((await session.execute(select(func.count(User.id)))).scalar_one())


# ---------------------------------------------------------------------------
# Route availability
# ---------------------------------------------------------------------------


async def test_registration_route_does_not_exist_in_hosted_mode(client):
    response = await client.post(REGISTER_PATH, json=_payload())
    assert response.status_code == 404


async def test_registration_closed_before_first_run_claim(single_org_client, test_engine):
    response = await single_org_client.post(REGISTER_PATH, json=_payload())
    assert response.status_code == 403
    assert await _count_users(test_engine) == 0


async def test_registration_respects_password_auth_kill_switch(
    single_org_client, test_engine, monkeypatch
):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)
    monkeypatch.setattr(settings, "password_auth_enabled", False)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 404
    assert await _count_users(test_engine) == 1  # only the owner


# ---------------------------------------------------------------------------
# The invitation token is the proof of invitation
# ---------------------------------------------------------------------------


async def test_invited_email_registers_into_instance_org(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["email"] == INVITED_EMAIL
    assert payload["organizationName"]

    async with _factory(test_engine)() as session:
        user = (
            await session.execute(select(User).where(User.email == INVITED_EMAIL))
        ).scalar_one()
        assert user.password_set_at is not None
        assert verify_password(PASSWORD, user.hashed_password).verified

        membership = (
            await session.execute(
                select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)
            )
        ).scalar_one()
        assert membership.organization_id == organization_id
        assert membership.role == ORGANIZATION_ROLE_MEMBER
        assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE

        invitation = await session.get(OrganizationInvitation, invitation_id)
        assert invitation is not None
        assert invitation.status == ORGANIZATION_INVITATION_STATUS_ACCEPTED
        assert invitation.accepted_by_user_id == user.id


async def test_registration_requires_invitation_token(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        json={"email": INVITED_EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 422
    assert await _count_users(test_engine) == 1


async def test_unknown_token_gets_uniform_403_even_for_invited_email(
    single_org_client, test_engine
):
    """Knowing an invited email is not enough: a wrong token gets the same
    response as an uninvited email, so nothing enumerates the allowlist."""
    _, organization_id = await _claim_instance(test_engine)
    await _invite(test_engine, organization_id)

    invited_wrong_token = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(uuid4())),
    )
    uninvited = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(email="stranger@example.com", invitation_token=str(uuid4())),
    )
    malformed = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token="not-a-token"),
    )

    for response in (invited_wrong_token, uninvited, malformed):
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "registration_not_invited"
    # Byte-identical bodies: nothing distinguishes the three cases.
    assert invited_wrong_token.json() == uninvited.json() == malformed.json()
    assert await _count_users(test_engine) == 1


async def test_token_email_mismatch_gets_uniform_403(single_org_client, test_engine):
    """A valid token cannot register a different email than it was issued for."""
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(email="somebody-else@example.com", invitation_token=str(invitation_id)),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "registration_not_invited"
    assert await _count_users(test_engine) == 1


async def test_revoked_invitation_cannot_register(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)
    async with _factory(test_engine)() as session:
        await invitation_store.revoke_organization_invitation(
            session,
            organization_id=organization_id,
            invitation_id=invitation_id,
        )
        await session.commit()

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 403
    assert await _count_users(test_engine) == 1


async def test_existing_account_registration_conflicts(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id, email=OWNER_EMAIL)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(email=OWNER_EMAIL, invitation_token=str(invitation_id)),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_already_exists"


async def test_registration_validates_password(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(password="short", invitation_token=str(invitation_id)),
    )
    assert response.status_code == 400
    assert await _count_users(test_engine) == 1


# ---------------------------------------------------------------------------
# ALLOWED_EMAIL_DOMAINS gate
# ---------------------------------------------------------------------------


async def test_domain_gate_blocks_other_domains(single_org_client, test_engine, monkeypatch):
    _, organization_id = await _claim_instance(test_engine)
    outsider = "contractor@outsider.org"
    invitation_id = await _invite(test_engine, organization_id, email=outsider)
    monkeypatch.setattr(settings, "allowed_email_domains", "example.com")

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(email=outsider, invitation_token=str(invitation_id)),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "registration_domain_not_allowed"
    assert await _count_users(test_engine) == 1


async def test_domain_gate_admits_listed_domains(single_org_client, test_engine, monkeypatch):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)
    monkeypatch.setattr(settings, "allowed_email_domains", "example.com, extra.example")

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 201


async def test_domain_gate_is_not_a_grant(single_org_client, test_engine, monkeypatch):
    """A matching domain admits nobody without an invitation."""
    await _claim_instance(test_engine)
    monkeypatch.setattr(settings, "allowed_email_domains", "example.com")

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(email="uninvited@example.com"),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "registration_not_invited"


# ---------------------------------------------------------------------------
# End to end through the invitation API
# ---------------------------------------------------------------------------


async def test_password_owner_invites_and_invitee_registers(single_org_client, test_engine):
    """The whole self-host loop: password-only owner invites via the API and
    the invitee self-registers with the invitation token; both end up in the
    one instance org."""
    owner_id, organization_id = await _claim_instance(test_engine)
    async with _factory(test_engine)() as session:
        await update_user_password_hash(
            session,
            user_id=owner_id,
            hashed_password=hash_password(PASSWORD),
            password_set_at=datetime.now(UTC),
        )
        await session.commit()

    login = await single_org_client.post(
        "/auth/desktop/password/login",
        json={"email": OWNER_EMAIL, "password": PASSWORD},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    # A password-only owner (no GitHub identity) can invite in single-org mode.
    invite = await single_org_client.post(
        f"/v1/organizations/{organization_id}/invitations",
        json={"email": INVITED_EMAIL, "role": "member"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert invite.status_code == 201
    # The invitation id doubles as the registration token the admin shares.
    invitation_token = invite.json()["id"]

    register = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=invitation_token),
    )
    assert register.status_code == 201

    members = await single_org_client.get(
        f"/v1/organizations/{organization_id}/members",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert members.status_code == 200
    emails = sorted(member["email"] for member in members.json()["members"])
    assert emails == [OWNER_EMAIL, INVITED_EMAIL]


# ---------------------------------------------------------------------------
# Roles at registration: invited role, ADMIN_EMAILS floor
# ---------------------------------------------------------------------------


async def test_invited_admin_role_is_honored(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id, role=ORGANIZATION_ROLE_ADMIN)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 201

    async with _factory(test_engine)() as session:
        user = (
            await session.execute(select(User).where(User.email == INVITED_EMAIL))
        ).scalar_one()
        membership = (
            await session.execute(
                select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)
            )
        ).scalar_one()
        assert membership.role == ORGANIZATION_ROLE_ADMIN


async def test_admin_listed_registrant_starts_as_admin(
    single_org_client, test_engine, monkeypatch
):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)
    monkeypatch.setattr(settings, "admin_emails", INVITED_EMAIL)

    response = await single_org_client.post(
        REGISTER_PATH,
        json=_payload(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 201

    async with _factory(test_engine)() as session:
        user = (
            await session.execute(select(User).where(User.email == INVITED_EMAIL))
        ).scalar_one()
        membership = (
            await session.execute(
                select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)
            )
        ).scalar_one()
        assert membership.role == ORGANIZATION_ROLE_ADMIN
