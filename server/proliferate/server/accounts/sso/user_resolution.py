"""SSO identity-to-user resolution and organization placement.

Given a verified SSO identity, resolve (or JIT-provision) the local user and
place them in the right organization: linking the SSO identity, honoring the
connection's JIT policy and default role, accepting pending invitations, and
enforcing the single-org-mode guards (never silently reactivating an
admin-removed instance membership; asserting the ADMIN_EMAILS floor at login).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.identity.store import (
    create_auth_user,
    get_user_by_email,
    get_user_by_id,
)
from proliferate.auth.sso.policy import SsoPolicyError, require_email_domain_allowed
from proliferate.auth.sso.types import (
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoScope,
    VerifiedSsoIdentity,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_MEMBER
from proliferate.db.store import auth_sso as sso_store
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations import service as organization_service
from proliferate.server.organizations.admin_emails import ensure_admin_email_role
from proliferate.server.organizations.membership_policy import (
    place_new_identity,
)

if TYPE_CHECKING:
    from proliferate.auth.users import User


async def resolve_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> User:
    user = await _resolve_sso_user(db, connection=connection, verified=verified)
    # ADMIN_EMAILS floor: asserted at every login. SSO callbacks are always
    # logins, so this runs unconditionally once the user is resolved.
    await ensure_admin_email_role(db, user)
    return user


async def _resolve_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> User:
    _require_verified_allowed_email(connection=connection, verified=verified)
    assert verified.email is not None
    existing_identity = await sso_store.get_sso_identity_by_connection_subject(
        db,
        connection_key=connection.connection_key,
        provider_subject=verified.provider_subject,
    )
    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise AuthFlowError(
                "sso_linked_user_not_found",
                "Linked SSO user not found.",
                status_code=400,
            )
        _ensure_active_user(user)
        if connection.scope == SsoScope.ORGANIZATION:
            user = await _resolve_organization_sso_user(
                db,
                connection=connection,
                verified=verified,
                user=user,
            )
        await _attach_sso_identity(db, user=user, connection=connection, verified=verified)
        return user

    user = await get_user_by_email(db, verified.email)
    if connection.scope == SsoScope.ORGANIZATION:
        if connection.organization_id is None:
            raise AuthFlowError(
                "sso_organization_missing",
                "SSO organization is missing.",
                status_code=400,
            )
        user = await _resolve_organization_sso_user(
            db,
            connection=connection,
            verified=verified,
            user=user,
        )
    else:
        if user is None:
            if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
                raise AuthFlowError(
                    "sso_jit_disabled",
                    "SSO user provisioning is disabled.",
                    status_code=403,
                )
            user = await create_auth_user(
                db,
                email=verified.email,
                display_name=verified.display_name,
                avatar_url=verified.avatar_url,
            )
        elif connection.jit_policy == SsoJitPolicy.DISABLED:
            raise AuthFlowError(
                "sso_jit_disabled",
                "SSO user provisioning is disabled.",
                status_code=403,
            )
        _ensure_active_user(user)
        # Single-org mode honors the connection's default role for JIT
        # placement; hosted mode ignores it (personal org owner as always).
        # The policy never reactivates an admin-removed instance membership:
        # a kicked user gets a clear 403 here instead of regaining access
        # (ADMIN_EMAILS-listed emails excepted; that floor is the documented
        # lockout-recovery path).
        await place_new_identity(db, user, default_role=connection.default_role)

    await _attach_sso_identity(db, user=user, connection=connection, verified=verified)
    return user


def _require_verified_allowed_email(
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> None:
    if not verified.email:
        raise AuthFlowError(
            "sso_email_missing",
            "SSO did not return an email address.",
            status_code=400,
        )
    if not verified.email_verified:
        raise AuthFlowError(
            "sso_email_unverified",
            "SSO email address is not verified.",
            status_code=403,
        )
    try:
        require_email_domain_allowed(verified.email, connection.allowed_domains)
    except SsoPolicyError as exc:
        raise AuthFlowError(exc.code, exc.message, status_code=403) from exc


async def _resolve_organization_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
    user: User | None,
) -> User:
    if connection.organization_id is None:
        raise AuthFlowError(
            "sso_organization_missing",
            "SSO organization is missing.",
            status_code=400,
        )
    has_pending_invitation = (
        await invitation_store.has_live_pending_invitation_for_organization_email(
            db,
            organization_id=connection.organization_id,
            email=verified.email or "",
        )
    )
    if user is None:
        if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER and not has_pending_invitation:
            raise AuthFlowError(
                "sso_user_not_team_member",
                "SSO user is not a team member.",
                status_code=403,
            )
        user = await create_auth_user(
            db,
            email=verified.email or "",
            display_name=verified.display_name,
            avatar_url=verified.avatar_url,
        )
        await place_new_identity(db, user, default_role=connection.default_role)
    _ensure_active_user(user)
    membership = await organization_store.get_active_membership(
        db,
        organization_id=connection.organization_id,
        user_id=user.id,
    )
    if membership is not None:
        return user
    if has_pending_invitation:
        # Invitation acceptance mutates Organization-owned records, so Auth calls
        # its public service: it owns locking, membership, billing, and enrollment.
        # The dependency remains Auth -> Organizations; the owner never imports this resolver.
        accepted = await organization_service.try_accept_invitation(
            db,
            user,
            organization_id=connection.organization_id,
            authenticated_email=verified.email or "",
        )
        if accepted is not None:
            return user
    if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
        raise AuthFlowError(
            "sso_user_not_team_member",
            "SSO user is not a team member.",
            status_code=403,
        )
    await organization_service.provision_sso_jit_membership(
        db,
        user,
        organization_id=connection.organization_id,
        authenticated_email=verified.email or "",
        role=connection.default_role or ORGANIZATION_ROLE_MEMBER,
    )
    return user


async def _attach_sso_identity(
    db: AsyncSession,
    *,
    user: User,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> None:
    await sso_store.upsert_sso_identity_for_user(
        db,
        user_id=user.id,
        organization_id=connection.organization_id,
        connection_id=connection.id,
        connection_key=connection.connection_key,
        protocol=connection.protocol.value,
        provider_subject=verified.provider_subject,
        email=verified.email,
        email_verified=verified.email_verified,
        display_name=verified.display_name,
    )
    if verified.display_name and not user.display_name:
        user.display_name = verified.display_name
    if verified.avatar_url and not user.avatar_url:
        user.avatar_url = verified.avatar_url
    await db.flush()


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise AuthFlowError("sso_user_inactive", "User is inactive.", status_code=403)
