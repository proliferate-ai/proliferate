"""Persisted organization slugs retain exact identity during SSO discovery."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import SsoConnection
from proliferate.db.models.organizations import Organization
from proliferate.db.store import organizations as organization_store
from proliferate.server.accounts.sso import service as sso_service


@pytest.mark.asyncio
async def test_long_collision_slugs_preserve_identity_and_sso_routing(
    db_session: AsyncSession,
) -> None:
    base = "a" * 48
    first_slug = await organization_store.allocate_organization_slug(db_session, "A" * 49)
    first = Organization(name="A" * 49, slug=first_slug, status="active")
    db_session.add(first)
    await db_session.flush()

    second_slug = await organization_store.allocate_organization_slug(db_session, "A" * 48)
    second = Organization(name="A" * 48, slug=second_slug, status="active")
    random_form = Organization(
        name="Random suffix organization",
        slug=f"{base}-abcdef",
        status="active",
    )
    db_session.add_all((second, random_form))
    await db_session.flush()

    assert first.slug == base
    assert second.slug == f"{base}-2"
    assert (await organization_store.get_organization_by_slug(db_session, base)).id == first.id
    assert (
        await organization_store.get_organization_by_slug(db_session, f"{base}-2")
    ).id == second.id
    assert (
        await organization_store.get_organization_by_slug(db_session, f"{base}-abcdef")
    ).id == random_form.id
    assert (
        await organization_store.get_organization_by_slug(
            db_session,
            f"  !!!{base.upper()}-2???  ",
        )
    ).id == second.id

    unmatched = f"{base}-2-{'x' * 20}"
    assert len(unmatched) > 64
    assert await organization_store.get_organization_by_slug(db_session, unmatched) is None

    first_connection = SsoConnection(
        scope="organization",
        organization_id=first.id,
        protocol="oidc",
        status="enabled",
        display_name="First organization SSO",
        login_policy="optional",
        jit_policy="create_member",
        default_role="member",
        allowed_domains_json="[]",
        oidc_issuer_url="https://first.example.test",
        oidc_client_id="first-client-id",
        oidc_token_endpoint_auth_method="none",
    )
    second_connection = SsoConnection(
        scope="organization",
        organization_id=second.id,
        protocol="oidc",
        status="enabled",
        display_name="Second organization SSO",
        login_policy="optional",
        jit_policy="create_member",
        default_role="member",
        allowed_domains_json="[]",
        oidc_issuer_url="https://second.example.test",
        oidc_client_id="second-client-id",
        oidc_token_endpoint_auth_method="none",
    )
    db_session.add_all((first_connection, second_connection))
    await db_session.flush()

    discovery = await sso_service.discover_sso(db_session, email=None, slug=second_slug)
    assert discovery.enabled is True
    assert discovery.organization_id == second.id
    assert discovery.connection_id == second_connection.id
    assert discovery.connection_id != first_connection.id

    unavailable = await sso_service.discover_sso(db_session, email=None, slug=unmatched)
    assert unavailable.enabled is False
    assert unavailable.organization_id is None
    assert unavailable.connection_id is None
    assert unavailable.reason == "not_available"
