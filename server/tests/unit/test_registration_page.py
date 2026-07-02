"""Tests for the server-rendered /register page (invited self-registration)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import verify_password
from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_INVITATION_STATUS_ACCEPTED,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import OrganizationInvitation, OrganizationMembership
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.server.organizations.membership_policy import claim_instance_organization
from proliferate.utils.time import utcnow

OWNER_EMAIL = "owner@example.com"
INVITED_EMAIL = "teammate@example.com"
PASSWORD = "a-strong-enough-password"
REGISTER_PATH = "/register"

# The uniform invitation-failure message: it never confirms whether an email
# is invited (mirrors the JSON API's `registration_not_invited` behavior).
NOT_INVITED_MESSAGE = "Registration is invite-only"


def _factory(test_engine):
    return async_sessionmaker(test_engine, expire_on_commit=False)


def _form(*, email=INVITED_EMAIL, password=PASSWORD, invitation_token=None):
    return {
        "email": email,
        "password": password,
        "invitation_token": invitation_token if invitation_token is not None else str(uuid4()),
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


async def _invite(test_engine, organization_id, *, email=INVITED_EMAIL):
    async with _factory(test_engine)() as session:
        owner = (await session.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
        record = await invitation_store.create_or_rotate_organization_invitation(
            session,
            organization_id=organization_id,
            email=email,
            role=ORGANIZATION_ROLE_MEMBER,
            invited_by_user_id=owner.id,
            expires_at=utcnow() + timedelta(days=7),
        )
        await session.commit()
        assert record is not None
        return record.invitation.id


async def _count_users(test_engine) -> int:
    async with _factory(test_engine)() as session:
        return int((await session.execute(select(func.count(User.id)))).scalar_one())


def _error_block(page: str) -> str:
    start = page.index('<p class="error">')
    end = page.index("</p>", start)
    return page[start:end]


# ---------------------------------------------------------------------------
# Route availability
# ---------------------------------------------------------------------------


async def test_register_routes_do_not_exist_in_hosted_mode(client):
    assert (await client.get(REGISTER_PATH)).status_code == 404
    response = await client.post(REGISTER_PATH, data=_form())
    assert response.status_code == 404


async def test_register_routes_are_404_when_password_auth_disabled(
    single_org_client, test_engine, monkeypatch
):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)
    monkeypatch.setattr(settings, "password_auth_enabled", False)

    assert (await single_org_client.get(REGISTER_PATH)).status_code == 404
    response = await single_org_client.post(
        REGISTER_PATH,
        data=_form(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 404
    assert await _count_users(test_engine) == 1  # only the owner


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------


async def test_register_page_renders_with_prefill(single_org_client):
    token = str(uuid4())
    response = await single_org_client.get(
        REGISTER_PATH,
        params={"token": token, "email": INVITED_EMAIL},
    )
    assert response.status_code == 200
    assert 'name="email"' in response.text
    assert 'name="invitation_token"' in response.text
    assert 'name="password"' in response.text
    assert f'value="{INVITED_EMAIL}"' in response.text
    assert f'value="{token}"' in response.text


async def test_register_page_escapes_prefill_values(single_org_client):
    response = await single_org_client.get(
        REGISTER_PATH,
        params={"token": '"><script>alert(1)</script>', "email": '"><b>x</b>'},
    )
    assert response.status_code == 200
    assert "<script>" not in response.text
    assert "&lt;script&gt;" in response.text
    assert "<b>x</b>" not in response.text


# ---------------------------------------------------------------------------
# Submitting the form
# ---------------------------------------------------------------------------


async def test_register_page_creates_account_and_membership(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        data=_form(invitation_token=str(invitation_id)),
    )
    assert response.status_code == 200
    assert "desktop app" in response.text

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


async def test_register_page_wrong_token_rerenders_with_generic_error(
    single_org_client, test_engine
):
    """A wrong token re-renders the form with the uniform message: identical
    for an invited and an uninvited email, so nothing enumerates the allowlist."""
    _, organization_id = await _claim_instance(test_engine)
    await _invite(test_engine, organization_id)

    invited_wrong_token = await single_org_client.post(
        REGISTER_PATH,
        data=_form(invitation_token=str(uuid4())),
    )
    uninvited = await single_org_client.post(
        REGISTER_PATH,
        data=_form(email="stranger@example.com", invitation_token=str(uuid4())),
    )
    malformed = await single_org_client.post(
        REGISTER_PATH,
        data=_form(invitation_token="not-a-token"),
    )

    for response in (invited_wrong_token, uninvited, malformed):
        assert response.status_code == 403
        assert NOT_INVITED_MESSAGE in response.text
        # Still the form, so the visitor can correct the token.
        assert 'name="invitation_token"' in response.text
    # The exact same error block in every case (only the prefill differs):
    # nothing distinguishes an invited email from an uninvited one.
    responses = (invited_wrong_token, uninvited, malformed)
    assert len({_error_block(response.text) for response in responses}) == 1
    # The invited email stays prefilled so the visitor can correct the token.
    assert f'value="{INVITED_EMAIL}"' in invited_wrong_token.text
    assert await _count_users(test_engine) == 1


async def test_register_page_validation_error_rerenders(single_org_client, test_engine):
    _, organization_id = await _claim_instance(test_engine)
    invitation_id = await _invite(test_engine, organization_id)

    response = await single_org_client.post(
        REGISTER_PATH,
        data=_form(password="short", invitation_token=str(invitation_id)),
    )
    assert response.status_code == 400
    assert 'class="error"' in response.text
    assert 'name="password"' in response.text
    assert await _count_users(test_engine) == 1
