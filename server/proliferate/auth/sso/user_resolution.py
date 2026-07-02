"""SSO identity-to-user resolution and organization placement.

Given a verified SSO identity, resolve (or JIT-provision) the local user and
place them in the right organization: linking the SSO identity, honoring the
connection's JIT policy and default role, accepting pending invitations, and
enforcing the single-org-mode guards (never silently reactivating an
admin-removed instance membership; asserting the ADMIN_EMAILS floor at login).
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import (
    create_auth_user,
    get_user_by_email,
    get_user_by_id,
)
from proliferate.auth.sso.policy import require_email_domain_allowed
from proliferate.auth.sso.types import (
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoScope,
    VerifiedSsoIdentity,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_MEMBER
from proliferate.db.models.auth import User
from proliferate.db.store import auth_sso as sso_store
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.server.billing.seat_reconciliation import (
    maybe_create_organization_seat_adjustment,
)
from proliferate.server.organizations.admin_emails import ensure_admin_email_role
from proliferate.server.organizations.membership_policy import (
    ensure_instance_membership_not_removed,
    place_new_identity,
)


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
    existing_identity = await sso_store.get_sso_identity_by_connection_subject(
        db,
        connection_key=connection.connection_key,
        provider_subject=verified.provider_subject,
    )
    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Linked SSO user not found.")
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
            raise HTTPException(status_code=400, detail="SSO organization is missing.")
        user = await _resolve_organization_sso_user(
            db,
            connection=connection,
            verified=verified,
            user=user,
        )
    else:
        if user is None:
            if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
                raise HTTPException(status_code=403, detail="SSO user provisioning is disabled.")
            user = await create_auth_user(
                db,
                email=verified.email,
                display_name=verified.display_name,
                avatar_url=verified.avatar_url,
            )
        elif connection.jit_policy == SsoJitPolicy.DISABLED:
            raise HTTPException(status_code=403, detail="SSO user provisioning is disabled.")
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
        raise HTTPException(status_code=400, detail="SSO did not return an email address.")
    if not verified.email_verified:
        raise HTTPException(status_code=403, detail="SSO email address is not verified.")
    require_email_domain_allowed(verified.email, connection.allowed_domains)


async def _resolve_organization_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
    user: User | None,
) -> User:
    if connection.organization_id is None:
        raise HTTPException(status_code=400, detail="SSO organization is missing.")
    has_pending_invitation = (
        await invitation_store.has_live_pending_invitation_for_organization_email(
            db,
            organization_id=connection.organization_id,
            email=verified.email or "",
        )
    )
    if user is None:
        if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER and not has_pending_invitation:
            raise HTTPException(status_code=403, detail="SSO user is not a team member.")
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
        accepted, _error = await invitation_store.accept_pending_invitation_for_organization_email(
            db,
            organization_id=connection.organization_id,
            authenticated_user_id=user.id,
            authenticated_email=verified.email or "",
        )
        if accepted is not None:
            await maybe_create_organization_seat_adjustment(
                db,
                organization_id=accepted.organization.id,
                membership_id=accepted.membership.id,
            )
            return user
    if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
        raise HTTPException(status_code=403, detail="SSO user is not a team member.")
    # Single-org mode only (no-op in hosted mode): JIT must not silently
    # reactivate an instance-org membership an admin removed. ADMIN_EMAILS
    # listed emails are excepted; that floor is the documented
    # lockout-recovery path.
    await ensure_instance_membership_not_removed(
        db,
        organization_id=connection.organization_id,
        user_id=user.id,
        email=verified.email,
    )
    membership = await sso_store.ensure_sso_organization_membership(
        db,
        organization_id=connection.organization_id,
        user_id=user.id,
        role=connection.default_role or ORGANIZATION_ROLE_MEMBER,
    )
    await maybe_create_organization_seat_adjustment(
        db,
        organization_id=connection.organization_id,
        membership_id=membership.id,
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
        raise HTTPException(status_code=403, detail="User is inactive.")
