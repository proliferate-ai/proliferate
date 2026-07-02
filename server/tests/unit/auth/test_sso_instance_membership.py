"""Single-org mode: SSO login must not reactivate admin-removed memberships.

These are db-backed tests of ``resolve_sso_user`` against THE instance org
(all of this is inert in hosted mode). The monkeypatch-based SSO service
security tests live in ``test_sso_service_security``.
"""

from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.sso import service as sso_service
from proliferate.auth.sso.types import (
    DEFAULT_OIDC_SCOPES,
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoLoginPolicy,
    SsoProtocol,
    SsoScope,
    SsoStatus,
    VerifiedSsoIdentity,
)
from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.server.organizations.errors import InstanceOrganizationAccessRemoved


def _connection(*, allowed_domains: tuple[str, ...]) -> SsoConnectionSnapshot:
    return SsoConnectionSnapshot(
        id=None,
        scope=SsoScope.DEPLOYMENT,
        organization_id=None,
        connection_key="deployment",
        protocol=SsoProtocol.OIDC,
        status=SsoStatus.ENABLED,
        display_name="Company SSO",
        login_policy=SsoLoginPolicy.OPTIONAL,
        jit_policy=SsoJitPolicy.EXISTING_USER,
        default_role="member",
        allowed_domains=allowed_domains,
        oidc_issuer_url="https://idp.example.test/",
        oidc_discovery_url=None,
        oidc_authorization_endpoint=None,
        oidc_token_endpoint=None,
        oidc_jwks_uri=None,
        oidc_userinfo_endpoint=None,
        oidc_client_id="client-id",
        oidc_client_secret="client-secret",
        oidc_client_secret_configured=True,
        oidc_scopes=DEFAULT_OIDC_SCOPES,
        oidc_token_endpoint_auth_method="client_secret_basic",
    )


def _organization_connection(
    *,
    connection_id: object,
    organization_id: object,
    jit_policy: SsoJitPolicy,
) -> SsoConnectionSnapshot:
    return replace(
        _connection(allowed_domains=("example.com",)),
        id=connection_id,
        scope=SsoScope.ORGANIZATION,
        organization_id=organization_id,
        connection_key=f"organization:{connection_id}",
        jit_policy=jit_policy,
    )


def _verified(email: str) -> VerifiedSsoIdentity:
    return VerifiedSsoIdentity(
        provider_subject=f"subject-{email}",
        email=email,
        email_verified=True,
        display_name=None,
        avatar_url=None,
        claims={},
    )


async def _seed_instance_org_with_removed_member(db: AsyncSession, *, removed_email: str):
    owner = await create_auth_user(
        db, email="owner@example.com", display_name=None, avatar_url=None
    )
    organization = Organization(name="Acme", logo_domain=None, logo_image=None, is_instance=True)
    db.add(organization)
    await db.flush()
    db.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=owner.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    removed_user = await create_auth_user(
        db, email=removed_email, display_name=None, avatar_url=None
    )
    db.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=removed_user.id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
        )
    )
    await db.flush()
    return organization, removed_user


async def _membership_status(db: AsyncSession, *, organization_id, user_id):  # type: ignore[no-untyped-def]
    from sqlalchemy import select

    membership = (
        await db.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
        )
    ).scalar_one()
    return membership.status, membership.role


@pytest.mark.asyncio
async def test_deployment_sso_login_does_not_reactivate_removed_membership(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    organization, removed_user = await _seed_instance_org_with_removed_member(
        db_session, removed_email="kicked@example.com"
    )

    with pytest.raises(InstanceOrganizationAccessRemoved) as exc_info:
        await sso_service.resolve_sso_user(
            db_session,
            connection=replace(
                _connection(allowed_domains=()),
                jit_policy=SsoJitPolicy.CREATE_MEMBER,
            ),
            verified=_verified("kicked@example.com"),
        )

    assert exc_info.value.status_code == 403
    status, _role = await _membership_status(
        db_session, organization_id=organization.id, user_id=removed_user.id
    )
    assert status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED


@pytest.mark.asyncio
async def test_deployment_sso_login_reinstates_admin_listed_removed_user(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADMIN_EMAILS stays the deliberate lockout-recovery exception at login."""
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    monkeypatch.setattr(settings, "admin_emails", "kicked-admin@example.com")
    organization, removed_user = await _seed_instance_org_with_removed_member(
        db_session, removed_email="kicked-admin@example.com"
    )

    resolved = await sso_service.resolve_sso_user(
        db_session,
        connection=replace(
            _connection(allowed_domains=()),
            jit_policy=SsoJitPolicy.CREATE_MEMBER,
        ),
        verified=_verified("kicked-admin@example.com"),
    )

    assert resolved.id == removed_user.id
    status, role = await _membership_status(
        db_session, organization_id=organization.id, user_id=removed_user.id
    )
    assert status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
    assert role == ORGANIZATION_ROLE_ADMIN


@pytest.mark.asyncio
async def test_org_scope_sso_jit_does_not_reactivate_removed_instance_membership(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    organization, removed_user = await _seed_instance_org_with_removed_member(
        db_session, removed_email="kicked@example.com"
    )

    with pytest.raises(InstanceOrganizationAccessRemoved):
        await sso_service.resolve_sso_user(
            db_session,
            connection=_organization_connection(
                connection_id=uuid4(),
                organization_id=organization.id,
                jit_policy=SsoJitPolicy.CREATE_MEMBER,
            ),
            verified=_verified("kicked@example.com"),
        )

    status, _role = await _membership_status(
        db_session, organization_id=organization.id, user_id=removed_user.id
    )
    assert status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
