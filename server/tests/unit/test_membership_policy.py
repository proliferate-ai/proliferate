"""Tests for the membership policy seam and the single_org_mode setting."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.config import Settings, settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations.errors import InstanceOrganizationNotClaimed
from proliferate.server.organizations.membership_policy import (
    HostedPolicy,
    SingleOrgPolicy,
    place_new_identity,
    select_membership_policy,
)


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
