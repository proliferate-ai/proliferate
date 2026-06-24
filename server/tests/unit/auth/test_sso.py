from __future__ import annotations

from typing import cast

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso import api as sso_api
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


def test_sso_auth_error_url_encodes_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    assert sso_api._auth_error_url("access_denied&next=https://evil.test") == (
        "https://app.example.test/auth/error?"
        "code=access_denied%26next%3Dhttps%3A%2F%2Fevil.test"
    )


@pytest.mark.asyncio
async def test_resolve_sso_user_rejects_unverified_email_before_identity_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity_lookup_called = False

    async def fake_get_sso_identity_by_connection_subject(*_args: object, **_kwargs: object):
        nonlocal identity_lookup_called
        identity_lookup_called = True
        return None

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )

    with pytest.raises(HTTPException) as exc_info:
        await sso_service.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=_connection(allowed_domains=("example.com",)),
            verified=VerifiedSsoIdentity(
                provider_subject="subject-1",
                email="person@example.com",
                email_verified=False,
                display_name=None,
                avatar_url=None,
                claims={},
            ),
        )

    assert exc_info.value.status_code == 403
    assert identity_lookup_called is False


@pytest.mark.asyncio
async def test_resolve_sso_user_rechecks_allowed_domain_before_identity_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity_lookup_called = False

    async def fake_get_sso_identity_by_connection_subject(*_args: object, **_kwargs: object):
        nonlocal identity_lookup_called
        identity_lookup_called = True
        return None

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )

    with pytest.raises(HTTPException) as exc_info:
        await sso_service.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=_connection(allowed_domains=("example.com",)),
            verified=VerifiedSsoIdentity(
                provider_subject="subject-1",
                email="person@other.test",
                email_verified=True,
                display_name=None,
                avatar_url=None,
                claims={},
            ),
        )

    assert exc_info.value.status_code == 403
    assert identity_lookup_called is False


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
