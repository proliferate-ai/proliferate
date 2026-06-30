"""Organization member authentication method read models."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso.branding import (
    sso_brand_label_for_connection,
    sso_brand_label_from_subject,
)
from proliferate.auth.sso.deployment_config import deployment_sso_connection
from proliferate.auth.sso.types import DEPLOYMENT_SSO_CONNECTION_KEY
from proliferate.db.models.auth import AuthIdentity, OAuthAccount, SsoConnection, SsoIdentity, User
from proliferate.db.store.organization_records import MemberAuthMethodRecord


async def list_member_auth_methods(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_ids: list[UUID],
) -> dict[UUID, list[MemberAuthMethodRecord]]:
    if not user_ids:
        return {}
    unique_user_ids = tuple(dict.fromkeys(user_ids))
    methods: dict[UUID, list[MemberAuthMethodRecord]] = {
        user_id: [] for user_id in unique_user_ids
    }
    seen: dict[UUID, set[str]] = {user_id: set() for user_id in unique_user_ids}

    for user_id, password_set_at in (
        await db.execute(
            select(User.id, User.password_set_at)
            .where(User.id.in_(unique_user_ids))
            .order_by(User.id.asc())
        )
    ).all():
        if password_set_at is not None:
            _append_member_auth_method(
                methods,
                seen,
                user_id,
                MemberAuthMethodRecord(provider="password", label="Email/password"),
            )

    for user_id, provider in (
        await db.execute(
            select(AuthIdentity.user_id, AuthIdentity.provider)
            .where(AuthIdentity.user_id.in_(unique_user_ids))
            .order_by(
                AuthIdentity.user_id.asc(),
                AuthIdentity.provider.asc(),
                AuthIdentity.linked_at.asc(),
            )
        )
    ).all():
        _append_member_auth_method(
            methods,
            seen,
            user_id,
            MemberAuthMethodRecord(provider=provider, label=_auth_provider_label(provider)),
        )

    for user_id, provider in (
        await db.execute(
            select(OAuthAccount.user_id, OAuthAccount.oauth_name)
            .where(
                OAuthAccount.user_id.in_(unique_user_ids),
                OAuthAccount.oauth_name.in_(("github", "google")),
            )
            .order_by(OAuthAccount.user_id.asc(), OAuthAccount.oauth_name.asc())
        )
    ).all():
        _append_member_auth_method(
            methods,
            seen,
            user_id,
            MemberAuthMethodRecord(provider=provider, label=_auth_provider_label(provider)),
        )

    sso_rows = (
        await db.execute(
            select(SsoIdentity, SsoConnection)
            .outerjoin(SsoConnection, SsoConnection.id == SsoIdentity.connection_id)
            .where(
                SsoIdentity.user_id.in_(unique_user_ids),
                or_(
                    SsoIdentity.organization_id.is_(None),
                    SsoIdentity.organization_id == organization_id,
                ),
            )
            .order_by(SsoIdentity.user_id.asc(), SsoIdentity.linked_at.asc())
        )
    ).all()
    for identity, connection in sso_rows:
        connection_record = connection
        if connection_record is None and identity.connection_key == DEPLOYMENT_SSO_CONNECTION_KEY:
            connection_record = deployment_sso_connection()
        if connection_record is not None:
            display_name = connection_record.display_name
            brand_label = sso_brand_label_for_connection(
                connection_record,
                identity.provider_subject,
            )
        else:
            display_name = "SSO"
            brand_label = sso_brand_label_from_subject(identity.provider_subject)
        _append_member_auth_method(
            methods,
            seen,
            identity.user_id,
            MemberAuthMethodRecord(
                provider="sso",
                label=display_name,
                brand_label=brand_label,
            ),
            dedupe_key=f"sso:{brand_label or display_name}:{identity.connection_key}",
        )
    return methods


def _append_member_auth_method(
    methods: dict[UUID, list[MemberAuthMethodRecord]],
    seen: dict[UUID, set[str]],
    user_id: UUID,
    method: MemberAuthMethodRecord,
    *,
    dedupe_key: str | None = None,
) -> None:
    key = dedupe_key or method.provider
    if key in seen[user_id]:
        return
    seen[user_id].add(key)
    methods[user_id].append(method)


def _auth_provider_label(provider: str) -> str:
    if provider == "github":
        return "GitHub"
    if provider == "google":
        return "Google"
    if provider == "apple":
        return "Apple"
    return provider.upper()
