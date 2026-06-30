from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

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
from proliferate.db.models.auth import User
from proliferate.db.store.auth_sso_records import SsoConnectionRecord, SsoIdentityRecord


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
async def test_resolve_sso_user_rechecks_org_membership_for_existing_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_organization_id = uuid4()
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
            organization_id=target_organization_id,
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

    async def fake_get_user_by_id(_db: AsyncSession, _user_id: object) -> User:
        return _user(user_id=user_id, email="person@example.com")

    async def fake_get_active_membership(*_args: object, **_kwargs: object) -> None:
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
    monkeypatch.setattr(
        sso_service.invitation_store,
        "has_live_pending_invitation_for_organization_email",
        _false_pending_invitation,
    )
    monkeypatch.setattr(sso_service, "_attach_sso_identity", fake_attach_sso_identity)

    with pytest.raises(HTTPException) as exc_info:
        await sso_service.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=_organization_connection(
                connection_id=connection_id,
                organization_id=target_organization_id,
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

    async def fake_get_sso_identity_by_connection_subject(
        *_args: object,
        **_kwargs: object,
    ) -> None:
        return None

    async def fake_get_user_by_email(*_args: object, **_kwargs: object) -> None:
        return None

    async def fake_create_auth_user(*_args: object, **_kwargs: object) -> User:
        return user

    async def fake_ensure_default_organization_for_account(
        _db: AsyncSession,
        ensured_user: User,
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
    monkeypatch.setattr(sso_service, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(sso_service, "_attach_sso_identity", fake_attach_sso_identity)

    with pytest.raises(HTTPException) as exc_info:
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

    assert exc_info.value.status_code == 403
    assert attach_called is False


@pytest.mark.asyncio
async def test_resolve_sso_user_accepts_pending_org_invitation_when_jit_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_organization_id = uuid4()
    connection_id = uuid4()
    membership_id = uuid4()
    user = _user(user_id=uuid4(), email="person@example.com")
    ensured_user_ids: list[object] = []
    seat_adjustments: list[tuple[object, object]] = []

    async def fake_get_sso_identity_by_connection_subject(
        *_args: object,
        **_kwargs: object,
    ) -> None:
        return None

    async def fake_get_user_by_email(*_args: object, **_kwargs: object) -> None:
        return None

    async def fake_create_auth_user(*_args: object, **_kwargs: object) -> User:
        return user

    async def fake_ensure_default_organization_for_account(
        _db: AsyncSession,
        ensured_user: User,
    ) -> None:
        ensured_user_ids.append(ensured_user.id)

    async def fake_has_pending_invitation(
        _db: AsyncSession,
        *,
        organization_id: object,
        email: str,
    ) -> bool:
        assert organization_id == target_organization_id
        assert email == "person@example.com"
        return True

    async def fake_get_active_membership(*_args: object, **_kwargs: object) -> None:
        return None

    async def fake_accept_pending_invitation(*_args: object, **_kwargs: object):
        return (
            SimpleNamespace(
                organization=SimpleNamespace(id=target_organization_id),
                membership=SimpleNamespace(id=membership_id),
            ),
            None,
        )

    async def fake_maybe_create_organization_seat_adjustment(
        _db: AsyncSession,
        *,
        organization_id: object,
        membership_id: object,
    ) -> None:
        seat_adjustments.append((organization_id, membership_id))

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
    monkeypatch.setattr(
        sso_service.invitation_store,
        "has_live_pending_invitation_for_organization_email",
        fake_has_pending_invitation,
    )
    monkeypatch.setattr(
        sso_service.organization_store,
        "get_active_membership",
        fake_get_active_membership,
    )
    monkeypatch.setattr(
        sso_service.invitation_store,
        "accept_pending_invitation_for_organization_email",
        fake_accept_pending_invitation,
    )
    monkeypatch.setattr(
        sso_service,
        "maybe_create_organization_seat_adjustment",
        fake_maybe_create_organization_seat_adjustment,
    )
    monkeypatch.setattr(sso_service, "_attach_sso_identity", fake_attach_sso_identity)

    resolved = await sso_service.resolve_sso_user(
        cast(AsyncSession, object()),
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
    assert ensured_user_ids == [user.id]
    assert seat_adjustments == [(target_organization_id, membership_id)]


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
