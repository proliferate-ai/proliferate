"""Tests for the membership policy seam and the single_org_mode setting."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.config import Settings, settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations import service as organization_service
from proliferate.server.organizations.errors import (
    InstanceOrganizationAccessRemoved,
    InstanceOrganizationNotClaimed,
)
from proliferate.server.organizations.membership_policy import (
    HostedPolicy,
    SingleOrgPolicy,
    ensure_instance_membership_not_removed,
    place_new_identity,
    select_membership_policy,
)
from proliferate.utils.time import utcnow


def _settings(
    monkeypatch: pytest.MonkeyPatch,
    *,
    telemetry_mode: str | None = None,
    single_org_mode: str | None = None,
) -> Settings:
    # telemetry_mode and single_org_mode are populated by their env aliases, so
    # exercise them the way an operator would rather than via constructor kwargs.
    if telemetry_mode is not None:
        monkeypatch.setenv("TELEMETRY_MODE", telemetry_mode)
    if single_org_mode is not None:
        monkeypatch.setenv("SINGLE_ORG_MODE", single_org_mode)
    return Settings(
        _env_file=None,
        debug=True,
        jwt_secret="test-jwt-secret",
        cloud_secret_key="test-cloud-secret",
    )


# ---------------------------------------------------------------------------
# single_org_mode default expression + env override
# ---------------------------------------------------------------------------


def test_single_org_mode_defaults_true_for_local_dev(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _settings(monkeypatch, telemetry_mode="local_dev").single_org_mode is True


def test_single_org_mode_defaults_true_for_self_managed(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _settings(monkeypatch, telemetry_mode="self_managed").single_org_mode is True


def test_single_org_mode_defaults_false_for_hosted_product(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _settings(monkeypatch, telemetry_mode="hosted_product").single_org_mode is False


def test_single_org_mode_env_override_wins_off_for_non_hosted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved = _settings(monkeypatch, telemetry_mode="self_managed", single_org_mode="false")
    assert resolved.single_org_mode is False


def test_single_org_mode_env_override_wins_on_for_hosted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved = _settings(monkeypatch, telemetry_mode="hosted_product", single_org_mode="true")
    assert resolved.single_org_mode is True


def test_select_policy_follows_single_org_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    assert isinstance(select_membership_policy(), HostedPolicy)
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    assert isinstance(select_membership_policy(), SingleOrgPolicy)


# ---------------------------------------------------------------------------
# HostedPolicy: personal default org per identity (today's behavior)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hosted_mode_creates_personal_org_per_user(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)

    first = await create_auth_user(
        db_session, email="a@example.com", display_name="A", avatar_url=None
    )
    second = await create_auth_user(
        db_session, email="b@example.com", display_name="B", avatar_url=None
    )

    await place_new_identity(db_session, first)
    await place_new_identity(db_session, second)

    first_orgs = await organization_store.list_organizations_for_user(db_session, first.id)
    second_orgs = await organization_store.list_organizations_for_user(db_session, second.id)

    assert len(first_orgs) == 1
    assert len(second_orgs) == 1
    assert first_orgs[0].membership.role == ORGANIZATION_ROLE_OWNER
    assert second_orgs[0].membership.role == ORGANIZATION_ROLE_OWNER
    # Distinct personal organizations, not a shared one.
    assert first_orgs[0].organization.id != second_orgs[0].organization.id
    assert first_orgs[0].organization.is_instance is False


# ---------------------------------------------------------------------------
# SingleOrgPolicy: join the one instance org
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_single_org_mode_places_second_user_into_instance_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)

    joiner = await create_auth_user(
        db_session, email="teammate@acme.test", display_name="Teammate", avatar_url=None
    )
    await place_new_identity(db_session, joiner)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert len(joiner_orgs) == 1
    assert joiner_orgs[0].organization.id == instance_org.id
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_MEMBER

    # No new organization was minted; the instance org is still the only one.
    all_orgs = (await db_session.execute(_count_organizations())).scalar_one()
    assert all_orgs == 1


@pytest.mark.asyncio
async def test_single_org_mode_join_is_idempotent(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner2@acme.test", display_name="Owner", avatar_url=None
    )
    await _seed_instance_org(db_session, owner_id=owner.id)

    joiner = await create_auth_user(
        db_session, email="dup@acme.test", display_name="Dup", avatar_url=None
    )
    await place_new_identity(db_session, joiner)
    await place_new_identity(db_session, joiner)

    joiner_orgs = await organization_store.list_organizations_for_user(db_session, joiner.id)
    assert len(joiner_orgs) == 1
    assert joiner_orgs[0].membership.role == ORGANIZATION_ROLE_MEMBER


@pytest.mark.asyncio
async def test_single_org_mode_without_instance_org_fails_closed(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    user = await create_auth_user(
        db_session, email="early@acme.test", display_name="Early", avatar_url=None
    )

    with pytest.raises(InstanceOrganizationNotClaimed) as exc_info:
        await place_new_identity(db_session, user)

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "instance_not_claimed"

    # Fail-closed: no organization and no membership were created.
    assert (await db_session.execute(_count_organizations())).scalar_one() == 0
    user_orgs = await organization_store.list_organizations_for_user(db_session, user.id)
    assert user_orgs == []


def _count_organizations():  # type: ignore[no-untyped-def]
    from sqlalchemy import func, select

    return select(func.count(Organization.id))


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


async def _membership_row(db: AsyncSession, *, organization_id, user_id):  # type: ignore[no-untyped-def]
    from sqlalchemy import select

    return (
        await db.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


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


# ---------------------------------------------------------------------------
# SingleOrgPolicy: admin-removed memberships are never silently reactivated
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_org_mode_does_not_reactivate_removed_membership(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    removed = await create_auth_user(
        db_session, email="kicked@acme.test", display_name=None, avatar_url=None
    )
    db_session.add(
        OrganizationMembership(
            organization_id=instance_org.id,
            user_id=removed.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )
    )
    await db_session.flush()

    with pytest.raises(InstanceOrganizationAccessRemoved) as exc_info:
        await place_new_identity(db_session, removed)

    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "instance_access_removed"
    membership = await _membership_row(
        db_session, organization_id=instance_org.id, user_id=removed.id
    )
    assert membership is not None
    assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED


@pytest.mark.asyncio
async def test_single_org_mode_reinstates_removed_admin_listed_email(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADMIN_EMAILS is the deliberate lockout-recovery exception."""
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    monkeypatch.setattr(settings, "admin_emails", "kicked-admin@acme.test")

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    removed = await create_auth_user(
        db_session, email="kicked-admin@acme.test", display_name=None, avatar_url=None
    )
    db_session.add(
        OrganizationMembership(
            organization_id=instance_org.id,
            user_id=removed.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )
    )
    await db_session.flush()

    await place_new_identity(db_session, removed)

    membership = await _membership_row(
        db_session, organization_id=instance_org.id, user_id=removed.id
    )
    assert membership is not None
    assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
    assert membership.role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_ensure_instance_membership_not_removed_guard(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    removed = await create_auth_user(
        db_session, email="kicked@acme.test", display_name=None, avatar_url=None
    )
    db_session.add(
        OrganizationMembership(
            organization_id=instance_org.id,
            user_id=removed.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )
    )
    await db_session.flush()

    with pytest.raises(InstanceOrganizationAccessRemoved):
        await ensure_instance_membership_not_removed(
            db_session,
            organization_id=instance_org.id,
            user_id=removed.id,
            email=removed.email,
        )

    # Active member and never-joined users pass through.
    await ensure_instance_membership_not_removed(
        db_session,
        organization_id=instance_org.id,
        user_id=owner.id,
        email=owner.email,
    )

    # Hosted mode: inert even with the same data.
    monkeypatch.setattr(settings, "single_org_mode_override", False)
    await ensure_instance_membership_not_removed(
        db_session,
        organization_id=instance_org.id,
        user_id=removed.id,
        email=removed.email,
    )


# ---------------------------------------------------------------------------
# GET /organizations service path: no personal-org minting in single-org mode
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_organizations_places_user_into_instance_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    orphan = await create_auth_user(
        db_session, email="orphan@acme.test", display_name=None, avatar_url=None
    )

    records = await organization_service.list_organizations(db_session, orphan)

    assert len(records) == 1
    assert records[0].organization.id == instance_org.id
    assert records[0].membership.role == ORGANIZATION_ROLE_MEMBER
    # No personal org was minted; the instance org is still the only one.
    assert (await db_session.execute(_count_organizations())).scalar_one() == 1


@pytest.mark.asyncio
async def test_list_organizations_fails_closed_before_claim(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    user = await create_auth_user(
        db_session, email="early@acme.test", display_name=None, avatar_url=None
    )

    with pytest.raises(InstanceOrganizationNotClaimed):
        await organization_service.list_organizations(db_session, user)

    assert (await db_session.execute(_count_organizations())).scalar_one() == 0


@pytest.mark.asyncio
async def test_list_organizations_does_not_reactivate_removed_membership(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)

    owner = await create_auth_user(
        db_session, email="owner@acme.test", display_name="Owner", avatar_url=None
    )
    instance_org = await _seed_instance_org(db_session, owner_id=owner.id)
    removed = await create_auth_user(
        db_session, email="kicked@acme.test", display_name=None, avatar_url=None
    )
    db_session.add(
        OrganizationMembership(
            organization_id=instance_org.id,
            user_id=removed.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )
    )
    await db_session.flush()

    with pytest.raises(InstanceOrganizationAccessRemoved):
        await organization_service.list_organizations(db_session, removed)

    membership = await _membership_row(
        db_session, organization_id=instance_org.id, user_id=removed.id
    )
    assert membership is not None
    assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
    # No personal org was minted either.
    assert (await db_session.execute(_count_organizations())).scalar_one() == 1


@pytest.mark.asyncio
async def test_list_organizations_still_mints_personal_org_in_hosted_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)

    user = await create_auth_user(
        db_session, email="hosted-list@example.com", display_name=None, avatar_url=None
    )

    records = await organization_service.list_organizations(db_session, user)

    assert len(records) == 1
    assert records[0].membership.role == ORGANIZATION_ROLE_OWNER
    assert records[0].organization.is_instance is False
