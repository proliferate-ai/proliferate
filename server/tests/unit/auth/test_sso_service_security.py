from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
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
from proliferate.db.models.auth import User
from proliferate.db.store.auth_sso_records import SsoConnectionRecord


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("verified_email", "has_pending_invitation"),
    [
        ("person@example.com", False),
        ("new-person@example.com", True),
    ],
)
async def test_resolve_sso_user_rechecks_org_membership_for_existing_identity(
    monkeypatch: pytest.MonkeyPatch,
    verified_email: str,
    has_pending_invitation: bool,
) -> None:
    target_organization_id = uuid4()
    connection_id = uuid4()
    user_id = uuid4()
    user = _user(user_id=user_id, email="person@example.com")
    db = cast(AsyncSession, object())
    try_accept = AsyncMock(return_value=SimpleNamespace() if has_pending_invitation else None)
    attach_identity = AsyncMock()

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        AsyncMock(return_value=SimpleNamespace(user_id=user_id)),
    )
    monkeypatch.setattr(sso_user_resolution, "get_user_by_id", AsyncMock(return_value=user))
    monkeypatch.setattr(
        sso_user_resolution.organization_store,
        "get_active_membership",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        sso_user_resolution.invitation_store,
        "has_live_pending_invitation_for_organization_email",
        AsyncMock(return_value=has_pending_invitation),
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_service,
        "try_accept_invitation",
        try_accept,
    )
    monkeypatch.setattr(sso_user_resolution, "_attach_sso_identity", attach_identity)

    resolution = sso_service.resolve_sso_user(
        db,
        connection=_organization_connection(
            connection_id=connection_id,
            organization_id=target_organization_id,
            jit_policy=SsoJitPolicy.EXISTING_USER,
        ),
        verified=VerifiedSsoIdentity(
            provider_subject="subject-1",
            email=verified_email,
            email_verified=True,
            display_name="Person Example",
            avatar_url=None,
            claims={},
        ),
    )

    if not has_pending_invitation:
        with pytest.raises(AuthFlowError) as exc_info:
            await resolution
        assert exc_info.value.code == "sso_user_not_team_member"
        assert exc_info.value.status_code == 403
        assert exc_info.value.message == "SSO user is not a team member."
        attach_identity.assert_not_awaited()
        return

    assert await resolution is user
    try_accept.assert_awaited_once_with(
        db,
        user,
        organization_id=target_organization_id,
        authenticated_email=verified_email,
    )
    attach_identity.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_sso_user_ensures_default_org_for_new_deployment_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(user_id=uuid4(), email="person@example.com")
    ensured_user_ids: list[object] = []
    placed_default_roles: list[object] = []

    async def fake_get_sso_identity_by_connection_subject(
        *_args: object,
        **_kwargs: object,
    ) -> None:
        return None

    async def fake_get_user_by_email(*_args: object, **_kwargs: object) -> None:
        return None

    async def fake_create_auth_user(*_args: object, **_kwargs: object) -> User:
        return user

    async def fake_place_new_identity(
        _db: AsyncSession,
        ensured_user: User,
        *,
        default_role: str | None = None,
    ) -> None:
        ensured_user_ids.append(ensured_user.id)
        placed_default_roles.append(default_role)

    async def fake_attach_sso_identity(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )
    monkeypatch.setattr(sso_user_resolution, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(sso_user_resolution, "create_auth_user", fake_create_auth_user)
    monkeypatch.setattr(
        sso_user_resolution,
        "place_new_identity",
        fake_place_new_identity,
    )
    monkeypatch.setattr(sso_user_resolution, "_attach_sso_identity", fake_attach_sso_identity)

    resolved = await sso_service.resolve_sso_user(
        cast(AsyncSession, object()),
        connection=replace(
            _connection(allowed_domains=("example.com",)),
            jit_policy=SsoJitPolicy.CREATE_MEMBER,
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

    assert resolved is user
    assert ensured_user_ids == [user.id]
    # The connection's default role travels into the membership policy so
    # single-org placement honors it (hosted placement ignores it).
    assert placed_default_roles == ["member"]


@pytest.mark.asyncio
async def test_resolve_sso_user_rejects_unlinked_deployment_user_when_jit_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(user_id=uuid4(), email="person@example.com")
    attach_called = False

    async def fake_get_sso_identity_by_connection_subject(
        *_args: object,
        **_kwargs: object,
    ) -> None:
        return None

    async def fake_get_user_by_email(*_args: object, **_kwargs: object) -> User:
        return user

    async def fake_attach_sso_identity(*_args: object, **_kwargs: object) -> None:
        nonlocal attach_called
        attach_called = True

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        fake_get_sso_identity_by_connection_subject,
    )
    monkeypatch.setattr(sso_user_resolution, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(sso_user_resolution, "_attach_sso_identity", fake_attach_sso_identity)

    with pytest.raises(AuthFlowError) as exc_info:
        await sso_service.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=replace(
                _connection(allowed_domains=("example.com",)),
                jit_policy=SsoJitPolicy.DISABLED,
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

    assert exc_info.value.code == "sso_jit_disabled"
    assert exc_info.value.status_code == 403
    assert exc_info.value.message == "SSO user provisioning is disabled."
    assert attach_called is False


@pytest.mark.asyncio
async def test_resolve_sso_user_accepts_pending_org_invitation_when_jit_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_organization_id = uuid4()
    connection_id = uuid4()
    user = _user(user_id=uuid4(), email="person@example.com")
    db = cast(AsyncSession, object())
    events: list[str] = []

    async def fake_create_auth_user(*_args: object, **_kwargs: object) -> User:
        events.append("create_user")
        return user

    async def fake_place_new_identity(
        _db: AsyncSession,
        ensured_user: User,
        *,
        default_role: str | None = None,
    ) -> None:
        assert _db is db
        assert ensured_user is user
        assert default_role == "member"
        events.append("place_user")

    async def fake_has_pending_invitation(
        _db: AsyncSession,
        *,
        organization_id: object,
        email: str,
    ) -> bool:
        assert organization_id == target_organization_id
        assert email == "person@example.com"
        return True

    async def fake_try_accept_invitation(
        call_db: AsyncSession,
        actor_user: User,
        *,
        organization_id: object,
        authenticated_email: str,
    ) -> SimpleNamespace:
        assert call_db is db
        assert actor_user is user
        assert organization_id == target_organization_id
        assert authenticated_email == "person@example.com"
        assert events == ["create_user", "place_user"]
        events.append("accept_invitation")
        return SimpleNamespace()

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(sso_user_resolution, "get_user_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(sso_user_resolution, "create_auth_user", fake_create_auth_user)
    monkeypatch.setattr(
        sso_user_resolution,
        "place_new_identity",
        fake_place_new_identity,
    )
    monkeypatch.setattr(
        sso_user_resolution.invitation_store,
        "has_live_pending_invitation_for_organization_email",
        fake_has_pending_invitation,
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_store,
        "get_active_membership",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_service,
        "try_accept_invitation",
        fake_try_accept_invitation,
    )
    monkeypatch.setattr(sso_user_resolution, "_attach_sso_identity", AsyncMock())

    resolved = await sso_service.resolve_sso_user(
        db,
        connection=_organization_connection(
            connection_id=connection_id,
            organization_id=target_organization_id,
            jit_policy=SsoJitPolicy.DISABLED,
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

    assert resolved is user
    assert events == ["create_user", "place_user", "accept_invitation"]


@pytest.mark.asyncio
async def test_resolve_sso_user_falls_back_to_jit_after_invitation_acceptance_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_organization_id = uuid4()
    connection_id = uuid4()
    user = _user(user_id=uuid4(), email="person@example.com")
    db = cast(AsyncSession, object())
    try_accept = AsyncMock(return_value=None)
    provision_jit_membership = AsyncMock(return_value=SimpleNamespace(id=uuid4()))

    monkeypatch.setattr(
        sso_service.sso_store,
        "get_sso_identity_by_connection_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(sso_user_resolution, "get_user_by_email", AsyncMock(return_value=user))
    monkeypatch.setattr(
        sso_user_resolution.invitation_store,
        "has_live_pending_invitation_for_organization_email",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_store,
        "get_active_membership",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_service,
        "try_accept_invitation",
        try_accept,
    )
    monkeypatch.setattr(
        sso_user_resolution.organization_service,
        "provision_sso_jit_membership",
        provision_jit_membership,
    )
    monkeypatch.setattr(sso_user_resolution, "_attach_sso_identity", AsyncMock())

    resolved = await sso_service.resolve_sso_user(
        db,
        connection=_organization_connection(
            connection_id=connection_id,
            organization_id=target_organization_id,
            jit_policy=SsoJitPolicy.CREATE_MEMBER,
        ),
        verified=VerifiedSsoIdentity(
            provider_subject="subject-1",
            email=user.email,
            email_verified=True,
            display_name="Person Example",
            avatar_url=None,
            claims={},
        ),
    )

    assert resolved is user
    try_accept.assert_awaited_once_with(
        db,
        user,
        organization_id=target_organization_id,
        authenticated_email=user.email,
    )
    provision_jit_membership.assert_awaited_once_with(
        db,
        user,
        organization_id=target_organization_id,
        authenticated_email=user.email,
        role="member",
    )


async def _false_pending_invitation(*_args: object, **_kwargs: object) -> bool:
    return False


def _connection_record(
    *,
    id: object,
    organization_id: object,
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


def _user(*, user_id: object, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        hashed_password="unused-sso-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
