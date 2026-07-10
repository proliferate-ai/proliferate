"""Slug-driven SSO discovery: resolution and enumeration protection."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso import service as sso_service
from proliferate.auth.sso.types import (
    DEFAULT_OIDC_SCOPES,
    SsoJitPolicy,
    SsoLoginPolicy,
    SsoProtocol,
    SsoScope,
    SsoStatus,
)
from proliferate.db.store.auth_sso_records import SsoConnectionRecord


def _connection_record(
    *,
    connection_id: object,
    organization_id: object,
    status: str,
) -> SsoConnectionRecord:
    now = datetime.now(UTC)
    return SsoConnectionRecord(
        id=connection_id,
        scope=SsoScope.ORGANIZATION.value,
        organization_id=organization_id,
        protocol=SsoProtocol.OIDC.value,
        status=status,
        display_name="Okta",
        login_policy=SsoLoginPolicy.OPTIONAL.value,
        jit_policy=SsoJitPolicy.CREATE_MEMBER.value,
        default_role="member",
        allowed_domains=(),
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
        saml_idp_metadata_url=None,
        saml_idp_metadata_xml_configured=False,
        saml_idp_entity_id=None,
        saml_sso_url=None,
        saml_x509_cert_configured=False,
        saml_email_attribute=None,
        created_by_user_id=None,
        updated_by_user_id=None,
        tested_at=None,
        last_error=None,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_slug_resolves_to_enabled_org_sso(monkeypatch: pytest.MonkeyPatch) -> None:
    organization_id = uuid4()
    connection_id = uuid4()

    async def fake_get_organization_by_slug(_db: AsyncSession, slug: str) -> object:
        assert slug == "acme"
        return SimpleNamespace(id=organization_id)

    async def fake_list_connections(_db: AsyncSession, *, organization_id: object) -> list:
        return [
            _connection_record(
                connection_id=connection_id,
                organization_id=organization_id,
                status=SsoStatus.ENABLED.value,
            )
        ]

    monkeypatch.setattr(
        sso_service.organization_store,
        "get_organization_by_slug",
        fake_get_organization_by_slug,
    )
    monkeypatch.setattr(
        sso_service.sso_store,
        "list_sso_connections_for_organization",
        fake_list_connections,
    )

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, object()), email=None, slug="acme"
    )

    assert discovery.enabled is True
    assert discovery.scope == SsoScope.ORGANIZATION
    assert discovery.organization_id == organization_id
    assert discovery.connection_id == connection_id
    assert discovery.display_name == "Okta"


@pytest.mark.asyncio
async def test_nonexistent_slug_returns_generic_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get_organization_by_slug(_db: AsyncSession, _slug: str) -> None:
        return None

    monkeypatch.setattr(
        sso_service.organization_store,
        "get_organization_by_slug",
        fake_get_organization_by_slug,
    )

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, object()), email=None, slug="does-not-exist"
    )

    assert discovery.enabled is False
    assert discovery.organization_id is None
    assert discovery.connection_id is None
    assert discovery.display_name is None
    assert discovery.reason == "not_available"


@pytest.mark.asyncio
async def test_org_without_enabled_sso_is_indistinguishable_from_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    connection_id = uuid4()

    async def fake_get_organization_by_slug(_db: AsyncSession, _slug: str) -> object:
        return SimpleNamespace(id=organization_id)

    async def fake_list_connections(_db: AsyncSession, *, organization_id: object) -> list:
        # Present but disabled: must not leak that the org exists.
        return [
            _connection_record(
                connection_id=connection_id,
                organization_id=organization_id,
                status=SsoStatus.DISABLED.value,
            )
        ]

    monkeypatch.setattr(
        sso_service.organization_store,
        "get_organization_by_slug",
        fake_get_organization_by_slug,
    )
    monkeypatch.setattr(
        sso_service.sso_store,
        "list_sso_connections_for_organization",
        fake_list_connections,
    )

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, object()), email=None, slug="acme"
    )

    assert discovery.enabled is False
    assert discovery.organization_id is None
    assert discovery.connection_id is None
    assert discovery.display_name is None
    assert discovery.reason == "not_available"
