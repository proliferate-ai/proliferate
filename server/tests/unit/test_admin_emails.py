"""Tests for the ADMIN_EMAILS floor and the instance admin invariants."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.password import authenticate_password_login
from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import hash_password
from proliferate.config import Settings, settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.auth_passwords import update_user_password_hash
from proliferate.permissions import CurrentOrgUser
from proliferate.server.organizations import service as organization_service
from proliferate.server.organizations.admin_emails import (
    ensure_admin_email_role,
    is_admin_listed_email,
)
from proliferate.server.organizations.errors import OrganizationServiceError
from proliferate.server.organizations.membership_policy import place_new_identity


def _single_org(monkeypatch: pytest.MonkeyPatch, *, admin_emails: str) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    monkeypatch.setattr(settings, "admin_emails", admin_emails)


async def _seed_instance_org(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID | None,
) -> Organization:
    organization = Organization(name="Acme", logo_domain=None, logo_image=None, is_instance=True)
    db.add(organization)
    await db.flush()
    if owner_id is not None:
        db.add(
            OrganizationMembership(
                organization_id=organization.id,
                user_id=owner_id,
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
        )
        await db.flush()
    return organization


async def _seed_membership(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    status: str = ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
) -> OrganizationMembership:
    membership = OrganizationMembership(
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        status=status,
    )
    db.add(membership)
    await db.flush()
    return membership


async def _user(db: AsyncSession, email: str) -> User:
    return await create_auth_user(db, email=email, display_name=None, avatar_url=None)


async def _membership_role(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
) -> str | None:
    membership = await organization_store.get_active_membership(
        db, organization_id=organization_id, user_id=user_id
    )
    return membership.role if membership is not None else None


def _org_user(
    *,
    organization_id: uuid.UUID,
    membership_id: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
    role: str = ORGANIZATION_ROLE_OWNER,
) -> CurrentOrgUser:
    return CurrentOrgUser(
        actor_user_id=actor_user_id or uuid.uuid4(),
        organization_id=organization_id,
        membership_id=membership_id,
        role=role,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# ADMIN_EMAILS parsing (config.py)
# ---------------------------------------------------------------------------


def test_admin_emails_env_is_parsed_normalized_and_lowered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_EMAILS", " Pablo@Corp.example.COM, ops@corp.example.com ,,")
    resolved = Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-jwt-secret",
        cloud_secret_key="test-cloud-secret",
    )
    assert resolved.admin_email_set == frozenset(
        {"pablo@corp.example.com", "ops@corp.example.com"}
    )


def test_admin_emails_empty_env_parses_to_empty_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "admin_emails", "")
    assert settings.admin_email_set == frozenset()
    monkeypatch.setattr(settings, "admin_emails", " , ,")
    assert settings.admin_email_set == frozenset()


def test_is_admin_listed_email_matches_case_insensitively(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="pablo@corp.example.com")
    assert is_admin_listed_email("Pablo@Corp.Example.Com ") is True
    assert is_admin_listed_email("other@corp.example.com") is False
    assert is_admin_listed_email(None) is False


def test_is_admin_listed_email_inert_in_hosted_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    monkeypatch.setattr(settings, "admin_emails", "pablo@corp.example.com")
    assert is_admin_listed_email("pablo@corp.example.com") is False


# ---------------------------------------------------------------------------
# Promotion at account creation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_listed_email_is_created_as_admin(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="Pablo@Acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)

    listed = await _user(db_session, "pablo@acme.test")
    await place_new_identity(db_session, listed)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=listed.id)
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_empty_admin_emails_is_a_no_op_at_creation(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)

    joiner = await _user(db_session, "joiner@acme.test")
    await place_new_identity(db_session, joiner)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=joiner.id)
    assert role == ORGANIZATION_ROLE_MEMBER


# ---------------------------------------------------------------------------
# Promotion at login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_password_login_promotes_pre_existing_listed_member(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user created before their email was listed gets promoted at login."""
    _single_org(monkeypatch, admin_emails="")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    member = await _user(db_session, "recovered@acme.test")
    await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=member.id,
        role=ORGANIZATION_ROLE_MEMBER,
    )
    await update_user_password_hash(
        db_session,
        user_id=member.id,
        hashed_password=hash_password("correct-horse-battery"),
        password_set_at=datetime.now(UTC),
    )

    # The operator lists the email afterwards (lockout recovery).
    monkeypatch.setattr(settings, "admin_emails", "recovered@acme.test")
    session = await authenticate_password_login(
        db_session,
        email="Recovered@acme.test",
        password="correct-horse-battery",
        client_ip=None,
    )

    assert session.user_id == member.id
    role = await _membership_role(db_session, organization_id=organization.id, user_id=member.id)
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_login_helper_reinstates_listed_user_removed_from_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="removed@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    removed = await _user(db_session, "removed@acme.test")
    await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=removed.id,
        role=ORGANIZATION_ROLE_MEMBER,
        status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    )

    await ensure_admin_email_role(db_session, removed)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=removed.id)
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_login_helper_leaves_owner_role_untouched(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="owner@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)

    await ensure_admin_email_role(db_session, owner)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=owner.id)
    assert role == ORGANIZATION_ROLE_OWNER


@pytest.mark.asyncio
async def test_removal_from_list_never_demotes(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="admin@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    admin = await _user(db_session, "admin@acme.test")
    await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=admin.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    # The email is removed from the env; the next login must not demote.
    monkeypatch.setattr(settings, "admin_emails", "")
    await ensure_admin_email_role(db_session, admin)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=admin.id)
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_login_helper_is_inert_in_hosted_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    monkeypatch.setattr(settings, "admin_emails", "member@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    member = await _user(db_session, "member@acme.test")
    await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=member.id,
        role=ORGANIZATION_ROLE_MEMBER,
    )

    await ensure_admin_email_role(db_session, member)

    role = await _membership_role(db_session, organization_id=organization.id, user_id=member.id)
    assert role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_login_helper_is_a_no_op_before_the_instance_is_claimed(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="early@acme.test")

    early = await _user(db_session, "early@acme.test")
    await ensure_admin_email_role(db_session, early)

    memberships = (await db_session.execute(select(OrganizationMembership))).scalars().all()
    assert memberships == []


# ---------------------------------------------------------------------------
# Role-change invariants (organization service layer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_listed_user_cannot_be_demoted_below_admin(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="listed@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    owner_membership = await organization_store.get_active_membership(
        db_session, organization_id=organization.id, user_id=owner.id
    )
    assert owner_membership is not None
    listed = await _user(db_session, "listed@acme.test")
    listed_membership = await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=listed.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    org_user = _org_user(
        organization_id=organization.id,
        membership_id=owner_membership.id,
        actor_user_id=owner.id,
    )
    with pytest.raises(OrganizationServiceError) as exc_info:
        await organization_service.update_membership(
            db_session,
            org_user,
            listed_membership.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=None,
        )

    assert exc_info.value.code == "admin_email_role_floor"
    assert exc_info.value.status_code == 409
    role = await _membership_role(db_session, organization_id=organization.id, user_id=listed.id)
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_listed_user_demotion_allowed_in_hosted_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The floor is inert in hosted mode even for an organization marked instance."""
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    monkeypatch.setattr(settings, "admin_emails", "listed@acme.test")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    owner_membership = await organization_store.get_active_membership(
        db_session, organization_id=organization.id, user_id=owner.id
    )
    assert owner_membership is not None
    listed = await _user(db_session, "listed@acme.test")
    listed_membership = await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=listed.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    org_user = _org_user(
        organization_id=organization.id,
        membership_id=owner_membership.id,
        actor_user_id=owner.id,
    )
    updated = await organization_service.update_membership(
        db_session,
        org_user,
        listed_membership.id,
        role=ORGANIZATION_ROLE_MEMBER,
        status=None,
    )
    assert updated.role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_last_admin_cannot_be_demoted(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="")

    organization = await _seed_instance_org(db_session, owner_id=None)
    admin = await _user(db_session, "solo-admin@acme.test")
    admin_membership = await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=admin.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    org_user = _org_user(organization_id=organization.id, membership_id=uuid.uuid4())
    with pytest.raises(OrganizationServiceError) as exc_info:
        await organization_service.update_membership(
            db_session,
            org_user,
            admin_membership.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=None,
        )

    assert exc_info.value.code == "last_admin_cannot_be_removed"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_last_admin_cannot_be_removed(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="")

    organization = await _seed_instance_org(db_session, owner_id=None)
    admin = await _user(db_session, "solo-admin@acme.test")
    admin_membership = await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=admin.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    org_user = _org_user(organization_id=organization.id, membership_id=uuid.uuid4())
    with pytest.raises(OrganizationServiceError) as exc_info:
        await organization_service.update_membership(
            db_session,
            org_user,
            admin_membership.id,
            role=None,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )

    assert exc_info.value.code == "last_admin_cannot_be_removed"


@pytest.mark.asyncio
async def test_demoting_an_admin_is_allowed_while_another_admin_remains(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _single_org(monkeypatch, admin_emails="")

    owner = await _user(db_session, "owner@acme.test")
    organization = await _seed_instance_org(db_session, owner_id=owner.id)
    owner_membership = await organization_store.get_active_membership(
        db_session, organization_id=organization.id, user_id=owner.id
    )
    assert owner_membership is not None
    admin = await _user(db_session, "admin@acme.test")
    admin_membership = await _seed_membership(
        db_session,
        organization_id=organization.id,
        user_id=admin.id,
        role=ORGANIZATION_ROLE_ADMIN,
    )

    org_user = _org_user(
        organization_id=organization.id,
        membership_id=owner_membership.id,
        actor_user_id=owner.id,
    )
    updated = await organization_service.update_membership(
        db_session,
        org_user,
        admin_membership.id,
        role=ORGANIZATION_ROLE_MEMBER,
        status=None,
    )
    assert updated.role == ORGANIZATION_ROLE_MEMBER
