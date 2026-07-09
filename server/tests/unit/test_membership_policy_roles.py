"""Role resolution tests for the single-org membership policy.

Covers how ``place_new_identity`` picks the role for a brand-new instance
membership: a live pending invitation wins, then the caller-provided SSO
default role, then member; the ADMIN_EMAILS floor raises listed emails to at
least admin. Placement/guard behavior lives in ``test_membership_policy``.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations.membership_policy import place_new_identity
from proliferate.utils.time import utcnow


async def _seed_instance_org(db: AsyncSession, *, owner_id) -> Organization:  # type: ignore[no-untyped-def]
    organization = Organization(name="Acme", logo_domain=None, logo_image=None, is_instance=True)
    db.add(organization)
    await db.flush()
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


async def _seed_invitation(  # type: ignore[no-untyped-def]
    db: AsyncSession,
    *,
    organization_id,
    invited_by_user_id,
    email: str,
    role: str,
    expires_in: timedelta = timedelta(days=7),
):
    record = await invitation_store.create_or_rotate_organization_invitation(
        db,
        organization_id=organization_id,
        email=email,
        role=role,
        invited_by_user_id=invited_by_user_id,
        expires_at=utcnow() + expires_in,
    )
    assert record is not None
    return record.invitation


# ---------------------------------------------------------------------------
# SingleOrgPolicy: role resolution for new memberships (invited role, SSO
# default_role, ADMIN_EMAILS floor)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_org_mode_honors_pending_invitation_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    await _seed_invitation(
        db_session,
        organization_id=instance_org.id,
        invited_by_user_id=owner.id,
        email="future-admin@acme.test",
        role=ORGANIZATION_ROLE_ADMIN,
    )

    joiner = await create_auth_user(
        db_session, email="future-admin@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert len(joiner_orgs) == 1
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_single_org_mode_ignores_expired_invitation_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    await _seed_invitation(
        db_session,
        organization_id=instance_org.id,
        invited_by_user_id=owner.id,
        email="late@acme.test",
        role=ORGANIZATION_ROLE_ADMIN,
        expires_in=timedelta(days=-1),
    )

    joiner = await create_auth_user(
        db_session, email="late@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_single_org_mode_honors_sso_default_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    await _seed_instance_org(db_session, owner_id=owner.id)

    joiner = await create_auth_user(
        db_session, email="jit-admin@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner, default_role=ORGANIZATION_ROLE_ADMIN)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_single_org_mode_invitation_role_wins_over_default_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    await _seed_invitation(
        db_session,
        organization_id=instance_org.id,
        invited_by_user_id=owner.id,
        email="invited-member@acme.test",
        role=ORGANIZATION_ROLE_MEMBER,
    )

    joiner = await create_auth_user(
        db_session, email="invited-member@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner, default_role=ORGANIZATION_ROLE_ADMIN)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_single_org_mode_ignores_invalid_default_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    await _seed_instance_org(db_session, owner_id=owner.id)

    joiner = await create_auth_user(
        db_session, email="odd-role@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner, default_role="superuser")

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_admin_emails_floor_raises_invited_member_to_admin(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    monkeypatch.setattr(settings, "admin_emails", "listed@acme.test")

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    await _seed_invitation(
        db_session,
        organization_id=instance_org.id,
        invited_by_user_id=owner.id,
        email="listed@acme.test",
        role=ORGANIZATION_ROLE_MEMBER,
    )

    joiner = await create_auth_user(
        db_session, email="listed@acme.test", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, joiner)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_hosted_mode_ignores_default_role(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)

    user = await create_auth_user(
        db_session, email="hosted@example.com", display_name=None, avatar_url=None
    )
    await place_new_identity(db_session, user, default_role=ORGANIZATION_ROLE_ADMIN)

    orgs = await organization_store.list_organizations_for_user(db_session, user.id)
    assert len(orgs) == 1
    assert orgs[0].membership.role == ORGANIZATION_ROLE_OWNER
    assert orgs[0].organization.is_instance is False
