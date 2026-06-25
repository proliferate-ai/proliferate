from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso import api as sso_api
from proliferate.auth.sso import service as sso_service
from proliferate.auth.sso.branding import (
    sso_brand_label_for_connection,
    sso_brand_label_from_subject,
)
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
from proliferate.db.models.auth import User
from proliferate.db.store.auth_sso_records import SsoConnectionRecord, SsoIdentityRecord
from proliferate.integrations.sso import oidc as oidc_integration
from proliferate.integrations.sso.errors import SsoIntegrationError


def test_sso_auth_error_url_encodes_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    assert sso_api._auth_error_url("access_denied&next=https://evil.test") == (
        "https://app.example.test/auth/error?code=access_denied%26next%3Dhttps%3A%2F%2Fevil.test"
    )


def test_oidc_callback_url_prefers_explicit_sso_callback_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "http://127.0.0.1:8025")
    monkeypatch.setattr(
        settings,
        "sso_oidc_callback_base_url",
        " http://localhost:8025/ ",
    )

    assert (
        sso_service._oidc_callback_url(_request("http://127.0.0.1:8025/auth/sso/start"))
        == "http://localhost:8025/auth/sso/oidc/callback"
    )


@pytest.mark.asyncio
async def test_discover_sso_ignores_org_connections_without_explicit_org_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lookup_called = False

    async def fake_list_enabled_sso_connections_for_domain(
        _db: AsyncSession,
        *,
        domain: str,
    ) -> list[SsoConnectionRecord]:
        nonlocal lookup_called
        lookup_called = True
        return []

    monkeypatch.setattr(
        sso_service.sso_store,
        "list_enabled_sso_connections_for_domain",
        fake_list_enabled_sso_connections_for_domain,
    )
    monkeypatch.setattr(
        sso_service,
        "deployment_sso_connection",
        lambda: _connection(allowed_domains=("example.com",)),
    )

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, object()),
        email="person@example.com",
    )

    assert discovery.enabled is True
    assert discovery.scope == SsoScope.DEPLOYMENT
    assert discovery.connection_id is None
    assert discovery.organization_id is None
    assert lookup_called is False


@pytest.mark.asyncio
async def test_discover_sso_finds_org_connection_with_explicit_org_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_organization_id = uuid4()
    connection_id = uuid4()

    async def fake_list_sso_connections_for_organization(
        _db: AsyncSession,
        *,
        organization_id: object,
    ) -> list[SsoConnectionRecord]:
        assert organization_id == target_organization_id
        return [
            _connection_record(
                id=connection_id,
                organization_id=target_organization_id,
                allowed_domains=("example.com",),
            )
        ]

    monkeypatch.setattr(
        sso_service.sso_store,
        "list_sso_connections_for_organization",
        fake_list_sso_connections_for_organization,
    )

    discovery = await sso_service.discover_sso(
        cast(AsyncSession, object()),
        email=None,
        organization_id=target_organization_id,
    )

    assert discovery.enabled is True
    assert discovery.scope == SsoScope.ORGANIZATION
    assert discovery.connection_id == connection_id
    assert discovery.organization_id == target_organization_id
    assert discovery.display_name == "Google SSO"


def test_oidc_discovery_rejects_mismatched_configured_issuer() -> None:
    with pytest.raises(SsoIntegrationError, match="discovery issuer"):
        oidc_integration._validate_discovered_issuer(
            _connection(allowed_domains=("example.com",)),
            "https://other-idp.example.test",
        )


def test_sso_brand_labels_use_connection_and_legacy_subject_hints() -> None:
    google_connection = replace(
        _connection(allowed_domains=("example.com",)),
        display_name="Corporate Login",
        oidc_issuer_url="https://accounts.google.com",
    )
    microsoft_connection = replace(
        _connection(allowed_domains=("example.com",)),
        display_name="Workforce Login",
        oidc_issuer_url="https://login.microsoftonline.com/common/v2.0",
    )

    assert (
        sso_brand_label_for_connection(google_connection, "subject-1")
        == "Google SSO"
    )
    assert (
        sso_brand_label_for_connection(microsoft_connection, "subject-1")
        == "Microsoft Entra"
    )
    assert sso_brand_label_from_subject("auth0|abc123") == "Auth0 SSO"
    assert sso_brand_label_from_subject("105348973383490238728") == "Google SSO"
    assert sso_brand_label_from_subject("00u14igc8z0aH8qyU698") == "Okta SSO"
    assert sso_brand_label_from_subject("unknown-subject") is None


@pytest.mark.asyncio
async def test_oidc_url_validation_rejects_private_http_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "sso_oidc_allow_private_provider_urls", False)

    with pytest.raises(SsoIntegrationError, match="must use HTTPS"):
        await oidc_integration._validate_oidc_url(
            "http://127.0.0.1:5555/.well-known/openid-configuration",
            "discovery_url",
        )


@pytest.mark.asyncio
async def test_oidc_url_validation_can_allow_private_provider_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "sso_oidc_allow_private_provider_urls", True)

    await oidc_integration._validate_oidc_url(
        "http://127.0.0.1:5555/.well-known/openid-configuration",
        "discovery_url",
    )


@pytest.mark.asyncio
async def test_verify_oidc_identity_uses_userinfo_email_verified_when_id_token_omits_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_decode_oidc_id_token(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"sub": "subject-1", "email": "person@example.com"}

    async def fake_fetch_userinfo(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"email_verified": True, "name": "Person Example"}

    monkeypatch.setattr(oidc_integration, "_decode_oidc_id_token", fake_decode_oidc_id_token)
    monkeypatch.setattr(oidc_integration, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(oidc_integration, "_validate_nonce", lambda *_args, **_kwargs: None)

    identity = await oidc_integration.verify_oidc_identity(
        connection=_connection(allowed_domains=("example.com",)),
        metadata=_metadata(userinfo_endpoint="https://idp.example.test/userinfo"),
        token=_oidc_token(access_token="access-token"),
        nonce_hash="nonce-hash",
    )

    assert identity.email == "person@example.com"
    assert identity.email_verified is True
    assert identity.display_name == "Person Example"


@pytest.mark.asyncio
async def test_verify_oidc_identity_treats_missing_email_verified_claim_as_unverified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_decode_oidc_id_token(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"sub": "subject-1", "email": "person@example.com"}

    async def fake_fetch_userinfo(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {}

    monkeypatch.setattr(oidc_integration, "_decode_oidc_id_token", fake_decode_oidc_id_token)
    monkeypatch.setattr(oidc_integration, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(oidc_integration, "_validate_nonce", lambda *_args, **_kwargs: None)

    identity = await oidc_integration.verify_oidc_identity(
        connection=_connection(allowed_domains=("example.com",)),
        metadata=_metadata(userinfo_endpoint="https://idp.example.test/userinfo"),
        token=_oidc_token(access_token="access-token"),
        nonce_hash="nonce-hash",
    )

    assert identity.email == "person@example.com"
    assert identity.email_verified is False


@pytest.mark.asyncio
async def test_verify_oidc_identity_preserves_explicit_unverified_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    userinfo_called = False

    async def fake_decode_oidc_id_token(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"sub": "subject-1", "email": "person@example.com", "email_verified": False}

    async def fake_fetch_userinfo(*_args: object, **_kwargs: object) -> dict[str, object]:
        nonlocal userinfo_called
        userinfo_called = True
        return {"email_verified": True}

    monkeypatch.setattr(oidc_integration, "_decode_oidc_id_token", fake_decode_oidc_id_token)
    monkeypatch.setattr(oidc_integration, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(oidc_integration, "_validate_nonce", lambda *_args, **_kwargs: None)

    identity = await oidc_integration.verify_oidc_identity(
        connection=_connection(allowed_domains=("example.com",)),
        metadata=_metadata(userinfo_endpoint="https://idp.example.test/userinfo"),
        token=_oidc_token(access_token="access-token"),
        nonce_hash="nonce-hash",
    )

    assert identity.email_verified is False
    assert userinfo_called is False


@pytest.mark.asyncio
async def test_oidc_sso_callback_uses_static_error_for_unbound_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        error="access_denied&next=https://evil.test",
        db=cast(AsyncSession, _FakeDb()),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"] == "https://app.example.test/auth/error?code=provider_error"
    )


@pytest.mark.asyncio
async def test_oidc_sso_callback_redirects_known_processing_http_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    async def fake_complete_oidc_sso_callback(*_args: object, **_kwargs: object) -> str:
        raise HTTPException(status_code=400, detail="Invalid or expired SSO state.")

    monkeypatch.setattr(
        sso_api,
        "complete_oidc_sso_callback",
        fake_complete_oidc_sso_callback,
    )
    db = _FakeDb()

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        state="state",
        code="code",
        db=cast(AsyncSession, db),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"]
        == "https://app.example.test/auth/error?code=sso_state_invalid"
    )
    assert db.rolled_back is True
    assert db.committed is False


@pytest.mark.asyncio
async def test_oidc_sso_callback_redirects_email_domain_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    async def fake_complete_oidc_sso_callback(*_args: object, **_kwargs: object) -> str:
        raise HTTPException(status_code=403, detail="Email domain is not allowed for this SSO.")

    monkeypatch.setattr(
        sso_api,
        "complete_oidc_sso_callback",
        fake_complete_oidc_sso_callback,
    )
    db = _FakeDb()

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        state="state",
        code="code",
        db=cast(AsyncSession, db),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"]
        == "https://app.example.test/auth/error?code=sso_email_domain_not_allowed"
    )
    assert db.rolled_back is True
    assert db.committed is False


@pytest.mark.asyncio
async def test_oidc_sso_callback_redirects_org_membership_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    async def fake_complete_oidc_sso_callback(*_args: object, **_kwargs: object) -> str:
        raise HTTPException(status_code=403, detail="SSO user is not a team member.")

    monkeypatch.setattr(
        sso_api,
        "complete_oidc_sso_callback",
        fake_complete_oidc_sso_callback,
    )
    db = _FakeDb()

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        state="state",
        code="code",
        db=cast(AsyncSession, db),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"]
        == "https://app.example.test/auth/error?code=sso_user_not_team_member"
    )
    assert db.rolled_back is True
    assert db.committed is False


@pytest.mark.asyncio
async def test_oidc_sso_callback_keeps_generic_code_for_unknown_http_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test/")

    async def fake_complete_oidc_sso_callback(*_args: object, **_kwargs: object) -> str:
        raise HTTPException(status_code=400, detail="Unexpected SSO failure.")

    monkeypatch.setattr(
        sso_api,
        "complete_oidc_sso_callback",
        fake_complete_oidc_sso_callback,
    )
    db = _FakeDb()

    response = await sso_api.oidc_sso_callback(
        cast(Request, object()),
        state="state",
        code="code",
        db=cast(AsyncSession, db),
    )

    assert response.status_code == 302
    assert (
        response.headers["location"]
        == "https://app.example.test/auth/error?code=sso_callback_failed"
    )
    assert db.rolled_back is True
    assert db.committed is False


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


@pytest.mark.asyncio
async def test_resolve_sso_user_rechecks_org_membership_for_existing_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    connection_id = uuid4()
    user_id = uuid4()
    now = datetime.now(UTC)
    attach_called = False

    async def fake_get_sso_identity_by_connection_subject(
        *_args: object,
        **_kwargs: object,
    ) -> SsoIdentityRecord:
        return SsoIdentityRecord(
            id=uuid4(),
            user_id=user_id,
            organization_id=organization_id,
            connection_id=connection_id,
            connection_key=f"organization:{connection_id}",
            protocol=SsoProtocol.OIDC.value,
            provider_subject="subject-1",
            email="person@example.com",
            email_verified=True,
            display_name="Person Example",
            linked_at=now,
            last_login_at=now,
        )

    async def fake_get_user_by_id(_db: AsyncSession, _user_id):
        return _user(user_id=user_id, email="person@example.com")

    async def fake_get_active_membership(*_args: object, **_kwargs: object):
        return None

    async def fake_attach_sso_identity(*_args: object, **_kwargs: object) -> None:
        nonlocal attach_called
        attach_called = True

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )
    monkeypatch.setattr(sso_service, "get_user_by_id", fake_get_user_by_id)
    monkeypatch.setattr(
        sso_service.organization_store,
        "get_active_membership",
        fake_get_active_membership,
    )
    monkeypatch.setattr(sso_service, "_attach_sso_identity", fake_attach_sso_identity)

    with pytest.raises(HTTPException) as exc_info:
        await sso_service.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=_organization_connection(
                connection_id=connection_id,
                organization_id=organization_id,
                jit_policy=SsoJitPolicy.EXISTING_USER,
            ),
            verified=VerifiedSsoIdentity(
                provider_subject="subject-1",
                email="person@example.com",
                email_verified=True,
                display_name="Person Example",
                avatar_url=None,
                claims={},
            ),
        )

    assert exc_info.value.status_code == 403
    assert attach_called is False


@pytest.mark.asyncio
async def test_resolve_sso_user_ensures_default_org_for_new_deployment_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(user_id=uuid4(), email="person@example.com")
    ensured_user_ids: list[object] = []

    async def fake_get_sso_identity_by_connection_subject(*_args: object, **_kwargs: object):
        return None

    async def fake_get_user_by_email(*_args: object, **_kwargs: object):
        return None

    async def fake_create_auth_user(*_args: object, **_kwargs: object):
        return user

    async def fake_ensure_default_organization_for_account(
        _db: AsyncSession,
        ensured_user,
    ) -> None:
        ensured_user_ids.append(ensured_user.id)

    async def fake_attach_sso_identity(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )
    monkeypatch.setattr(sso_service, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(sso_service, "create_auth_user", fake_create_auth_user)
    monkeypatch.setattr(
        sso_service,
        "ensure_default_organization_for_account",
        fake_ensure_default_organization_for_account,
    )
    monkeypatch.setattr(sso_service, "_attach_sso_identity", fake_attach_sso_identity)

    resolved = await sso_service.resolve_sso_user(
        cast(AsyncSession, object()),
        connection=_connection(allowed_domains=("example.com",)),
        verified=VerifiedSsoIdentity(
            provider_subject="subject-1",
            email="person@example.com",
            email_verified=True,
            display_name="Person Example",
            avatar_url=None,
            claims={},
        ),
    )

    assert resolved is user
    assert ensured_user_ids == [user.id]


class _FakeDb:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


def _request(url: str) -> Request:
    scheme, rest = url.split("://", 1)
    host, path = rest.split("/", 1)
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": scheme,
            "path": f"/{path}",
            "headers": [(b"host", host.encode("ascii"))],
            "server": (host.split(":", 1)[0], int(host.rsplit(":", 1)[1])),
            "client": ("127.0.0.1", 12345),
        }
    )


def _connection_record(
    *,
    id,
    organization_id,
    allowed_domains: tuple[str, ...],
) -> SsoConnectionRecord:
    now = datetime.now(UTC)
    return SsoConnectionRecord(
        id=id,
        scope=SsoScope.ORGANIZATION.value,
        organization_id=organization_id,
        protocol=SsoProtocol.OIDC.value,
        status=SsoStatus.ENABLED.value,
        display_name="Google SSO",
        login_policy=SsoLoginPolicy.OPTIONAL.value,
        jit_policy=SsoJitPolicy.EXISTING_USER.value,
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
    connection_id,
    organization_id,
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


def _user(*, user_id, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        hashed_password="unused-sso-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )


def _metadata(*, userinfo_endpoint: str | None) -> oidc_integration.OidcMetadata:
    return oidc_integration.OidcMetadata(
        issuer="https://idp.example.test/",
        authorization_endpoint="https://idp.example.test/authorize",
        token_endpoint="https://idp.example.test/token",
        jwks_uri="https://idp.example.test/jwks",
        userinfo_endpoint=userinfo_endpoint,
    )


def _oidc_token(*, access_token: str | None) -> oidc_integration.OidcTokenResponse:
    return oidc_integration.OidcTokenResponse(
        access_token=access_token,
        id_token="id-token",
        refresh_token=None,
        expires_at=None,
        scopes=frozenset({"openid", "email", "profile"}),
    )
