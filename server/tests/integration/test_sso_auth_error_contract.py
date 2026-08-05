from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.server.accounts.sso import service as sso_service
from proliferate.server.accounts.sso import user_resolution as sso_user_resolution
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
from proliferate.db.models.auth import SsoChallenge, SsoConnection, User
from proliferate.integrations.sso.errors import SsoIntegrationError
from proliferate.integrations.sso.oidc import OidcMetadata, OidcTokenResponse
from proliferate.server.organizations.sso import service as organization_sso_service
from proliferate.utils.crypto import encrypt_text
from tests.integration.test_organization_sso_membership import (
    _create_organization_for_user,
    _create_user_and_get_tokens,
    _headers,
)


def _assert_error(response: Response, *, status_code: int, detail: str) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert "retry-after" not in response.headers
    assert "www-authenticate" not in response.headers
    assert "sso_" not in response.text


def _assert_product_error(
    response: Response,
    *,
    status_code: int,
    code: str,
    message: str,
) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": {"code": code, "message": message}}
    assert "retry-after" not in response.headers
    assert "www-authenticate" not in response.headers


def _start_body(
    *,
    method: str = "S256",
    email: str | None = None,
) -> dict[str, str]:
    body = {
        "clientState": "client-state",
        "codeChallenge": "pkce-challenge",
        "codeChallengeMethod": method,
        "redirectUri": settings.mobile_redirect_uri,
    }
    if email is not None:
        body["email"] = email
    return body


def _connection() -> SsoConnectionSnapshot:
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
        allowed_domains=(),
        oidc_issuer_url="https://idp.example.test",
        oidc_discovery_url=None,
        oidc_authorization_endpoint="https://idp.example.test/authorize",
        oidc_token_endpoint="https://idp.example.test/token",
        oidc_jwks_uri="https://idp.example.test/jwks",
        oidc_userinfo_endpoint=None,
        oidc_client_id="client-id",
        oidc_client_secret="client-secret",
        oidc_client_secret_configured=True,
        oidc_scopes=DEFAULT_OIDC_SCOPES,
        oidc_token_endpoint_auth_method="client_secret_basic",
    )


def _metadata() -> OidcMetadata:
    return OidcMetadata(
        issuer="https://idp.example.test",
        authorization_endpoint="https://idp.example.test/authorize",
        token_endpoint="https://idp.example.test/token",
        jwks_uri="https://idp.example.test/jwks",
        userinfo_endpoint=None,
    )


async def _start_sso(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> str:
    monkeypatch.setattr(sso_service, "deployment_sso_connection", _connection)
    monkeypatch.setattr(
        sso_service,
        "resolve_oidc_metadata",
        AsyncMock(return_value=_metadata()),
    )
    response = await client.post("/auth/mobile/sso/start", json=_start_body())
    assert response.status_code == 200
    state = response.json()["state"]
    assert isinstance(state, str)
    return state


async def _assert_challenge_consumed(
    db: AsyncSession,
    *,
    state: str,
    expected: bool,
) -> None:
    result = await db.execute(
        select(SsoChallenge).where(SsoChallenge.state_hash == sso_service.hash_secret(state))
    )
    challenge = result.scalar_one()
    assert (challenge.consumed_at is not None) is expected


@pytest.mark.asyncio
async def test_unknown_surface_and_challenge_method_preserve_raw_bodies(
    client: AsyncClient,
) -> None:
    unknown = await client.post("/auth/unknown/sso/start", json=_start_body())
    _assert_error(unknown, status_code=404, detail="Unknown auth surface.")

    unsupported = await client.post(
        "/auth/mobile/sso/start",
        json=_start_body(method="plain"),
    )
    _assert_error(
        unsupported,
        status_code=400,
        detail="Unsupported code challenge method.",
    )


@pytest.mark.asyncio
async def test_missing_and_disabled_connections_preserve_raw_bodies(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sso_service, "deployment_sso_connection", lambda: None)
    missing = await client.post("/auth/mobile/sso/start", json=_start_body())
    _assert_error(
        missing,
        status_code=404,
        detail="SSO is not configured for this account.",
    )

    disabled_connection = replace(_connection(), status=SsoStatus.DISABLED)
    monkeypatch.setattr(
        sso_service,
        "deployment_sso_connection",
        lambda: disabled_connection,
    )
    disabled = await client.post("/auth/mobile/sso/start", json=_start_body())
    _assert_error(
        disabled,
        status_code=403,
        detail="SSO connection is not enabled.",
    )


@pytest.mark.asyncio
async def test_email_domain_failure_preserves_raw_body(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    restricted = replace(_connection(), allowed_domains=("example.com",))
    monkeypatch.setattr(sso_service, "deployment_sso_connection", lambda: restricted)

    response = await client.post(
        "/auth/mobile/sso/start",
        json=_start_body(email="person@other.test"),
    )

    _assert_error(
        response,
        status_code=403,
        detail="Email domain is not allowed for this SSO.",
    )


@pytest.mark.asyncio
async def test_incomplete_oidc_configuration_preserves_raw_body(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    incomplete = replace(_connection(), oidc_client_id=None)
    monkeypatch.setattr(sso_service, "deployment_sso_connection", lambda: incomplete)

    response = await client.post("/auth/mobile/sso/start", json=_start_body())

    _assert_error(response, status_code=400, detail="OIDC client ID is required.")


@pytest.mark.asyncio
async def test_invalid_callback_state_preserves_redirect_mapping(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test")

    response = await client.get(
        "/auth/sso/oidc/callback",
        params={"state": "missing-state", "code": "provider-code"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://app.example.test/auth/error?code=sso_state_invalid"
    )


@pytest.mark.asyncio
async def test_provider_error_with_invalid_state_uses_static_redirect(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test")

    response = await client.get(
        "/auth/sso/oidc/callback",
        params={"state": "missing-state", "error": "access_denied"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert (
        response.headers["location"] == "https://app.example.test/auth/error?code=provider_error"
    )


@pytest.mark.asyncio
async def test_valid_provider_error_consumes_state_and_keeps_client_redirect(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = await _start_sso(client, monkeypatch)

    response = await client.get(
        "/auth/sso/oidc/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        "proliferate://auth/callback?error=access_denied&state=client-state"
    )
    await _assert_challenge_consumed(db_session, state=state, expected=True)


@pytest.mark.asyncio
async def test_sso_identity_backfills_empty_user_profile_without_overwriting(
    db_session: AsyncSession,
) -> None:
    user = User(
        email="profile-backfill@example.com",
        hashed_password="unused-sso-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name=None,
        avatar_url=None,
    )
    db_session.add(user)
    await db_session.flush()
    user_id = user.id
    connection = _connection()
    verified = VerifiedSsoIdentity(
        provider_subject="profile-backfill-subject",
        email=user.email,
        email_verified=True,
        display_name="SSO Profile Name",
        avatar_url="https://idp.example.test/profile.png",
        claims={},
    )

    await sso_user_resolution._attach_sso_identity(
        db_session,
        user=user,
        connection=connection,
        verified=verified,
    )
    await db_session.commit()
    db_session.expire_all()

    persisted = await db_session.get(User, user_id)
    assert persisted is not None
    assert persisted.display_name == "SSO Profile Name"
    assert persisted.avatar_url == "https://idp.example.test/profile.png"

    await sso_user_resolution._attach_sso_identity(
        db_session,
        user=persisted,
        connection=connection,
        verified=replace(
            verified,
            display_name="Replacement Name",
            avatar_url="https://idp.example.test/replacement.png",
        ),
    )
    await db_session.commit()
    db_session.expire_all()

    unchanged = await db_session.get(User, user_id)
    assert unchanged is not None
    assert unchanged.display_name == "SSO Profile Name"
    assert unchanged.avatar_url == "https://idp.example.test/profile.png"


@pytest.mark.asyncio
async def test_integration_callback_failure_redirects_and_rolls_back_state(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test")
    state = await _start_sso(client, monkeypatch)
    monkeypatch.setattr(
        sso_service,
        "exchange_oidc_code",
        AsyncMock(side_effect=SsoIntegrationError("OIDC token exchange failed.")),
    )

    response = await client.get(
        "/auth/sso/oidc/callback",
        params={"state": state, "code": "provider-code"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://app.example.test/auth/error?code=sso_oidc_token_exchange_failed"
    )
    await _assert_challenge_consumed(db_session, state=state, expected=False)


@pytest.mark.parametrize(
    ("code", "message"),
    [
        ("sso_jit_disabled", "SSO user provisioning is disabled."),
        ("sso_user_not_team_member", "SSO user is not a team member."),
    ],
)
@pytest.mark.asyncio
async def test_jit_and_membership_callback_failures_redirect_and_roll_back(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    code: str,
    message: str,
) -> None:
    monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.test")
    state = await _start_sso(client, monkeypatch)
    monkeypatch.setattr(
        sso_service,
        "exchange_oidc_code",
        AsyncMock(
            return_value=OidcTokenResponse(
                access_token="access-token",
                id_token="id-token",
                refresh_token=None,
                expires_at=None,
                scopes=frozenset(),
            )
        ),
    )
    monkeypatch.setattr(
        sso_service,
        "verify_oidc_identity",
        AsyncMock(
            return_value=VerifiedSsoIdentity(
                provider_subject="provider-subject",
                email="person@example.com",
                email_verified=True,
                display_name=None,
                avatar_url=None,
                claims={},
            )
        ),
    )
    monkeypatch.setattr(
        sso_service,
        "resolve_sso_user",
        AsyncMock(side_effect=AuthFlowError(code, message, status_code=403)),
    )

    response = await client.get(
        "/auth/sso/oidc/callback",
        params={"state": state, "code": "provider-code"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == f"https://app.example.test/auth/error?code={code}"
    await _assert_challenge_consumed(db_session, state=state, expected=False)


@pytest.mark.asyncio
async def test_connection_test_preserves_integration_detail(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="sso-owner@example.com")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = organization["organization_id"]

    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as db:
        now = datetime.now(UTC)
        connection = SsoConnection(
            scope="organization",
            organization_id=organization_id,
            protocol="oidc",
            status="draft",
            display_name="Company SSO",
            login_policy="optional",
            jit_policy="existing_user",
            default_role="member",
            allowed_domains_json='["example.com"]',
            oidc_issuer_url="https://idp.example.test",
            oidc_authorization_endpoint="https://idp.example.test/authorize",
            oidc_token_endpoint="https://idp.example.test/token",
            oidc_jwks_uri="https://idp.example.test/jwks",
            oidc_client_id="client-id",
            oidc_client_secret_ciphertext=encrypt_text("client-secret"),
            created_at=now,
            updated_at=now,
        )
        db.add(connection)
        await db.commit()
        connection_id = connection.id

    monkeypatch.setattr(
        sso_service,
        "resolve_oidc_metadata",
        AsyncMock(side_effect=SsoIntegrationError("OIDC discovery metadata is invalid.")),
    )
    response = await client.post(
        f"/v1/organizations/{organization_id}/sso/connections/{connection_id}/test",
        headers=_headers(owner),
    )

    _assert_error(
        response,
        status_code=400,
        detail="OIDC discovery metadata is invalid.",
    )


@pytest.mark.asyncio
async def test_organization_sso_validation_errors_use_structured_contract(
    client: AsyncClient,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="sso-validation-owner@example.com")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = organization["organization_id"]
    cases = [
        (
            {"displayName": " "},
            "sso_display_name_required",
            "SSO display name is required.",
        ),
        (
            {"displayName": "x" * 256},
            "sso_display_name_too_long",
            "SSO display name is too long.",
        ),
        (
            {"loginPolicy": "required"},
            "sso_required_login_policy_unsupported",
            "Required SSO login policy is not supported yet.",
        ),
        (
            {"defaultRole": "owner"},
            "sso_jit_default_role_not_allowed",
            "SSO JIT default role cannot be owner.",
        ),
        (
            {
                "displayName": " ",
                "loginPolicy": "required",
                "defaultRole": "owner",
            },
            "sso_display_name_required",
            "SSO display name is required.",
        ),
        (
            {"loginPolicy": "required", "defaultRole": "owner"},
            "sso_required_login_policy_unsupported",
            "Required SSO login policy is not supported yet.",
        ),
    ]

    for body, code, message in cases:
        response = await client.post(
            f"/v1/organizations/{organization_id}/sso/connections",
            headers=_headers(owner),
            json=body,
        )

        _assert_product_error(
            response,
            status_code=400,
            code=code,
            message=message,
        )


@pytest.mark.asyncio
async def test_organization_sso_enable_protocol_error_uses_structured_contract(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _create_user_and_get_tokens(client, email="sso-enable-owner@example.com")
    organization = await _create_organization_for_user(user_id=owner["user_id"])
    organization_id = organization["organization_id"]
    test_connection = AsyncMock(return_value=SimpleNamespace(protocol="saml"))
    set_status = AsyncMock()
    monkeypatch.setattr(
        organization_sso_service,
        "test_organization_sso_connection",
        test_connection,
    )
    monkeypatch.setattr(
        organization_sso_service.sso_store,
        "set_sso_connection_status",
        set_status,
    )

    response = await client.post(
        f"/v1/organizations/{organization_id}/sso/connections/{uuid4()}/enable",
        headers=_headers(owner),
    )

    _assert_product_error(
        response,
        status_code=400,
        code="sso_connection_enable_protocol_unsupported",
        message="Only OIDC SSO can be enabled right now.",
    )
    test_connection.assert_awaited_once()
    set_status.assert_not_awaited()
