"""Organization member authentication method read models."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import AuthIdentity, OAuthAccount, User
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

    return methods


def _append_member_auth_method(
    methods: dict[UUID, list[MemberAuthMethodRecord]],
    seen: dict[UUID, set[str]],
    user_id: UUID,
    method: MemberAuthMethodRecord,
) -> None:
    if method.provider in seen[user_id]:
        return
    seen[user_id].add(method.provider)
    methods[user_id].append(method)


def _auth_provider_label(provider: str) -> str:
    if provider == "github":
        return "GitHub"
    if provider == "google":
        return "Google"
    if provider == "apple":
        return "Apple"
    return provider.upper()
