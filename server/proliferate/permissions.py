from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Literal, cast
from uuid import UUID

from fastapi import Cookie, Depends, Header, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import (
    ActorIdentity,
    AuthenticatedUser,
    OwnerContext,
    OwnerScope,
    OwnerSelection,
    PolicyAllowed,
    PolicyDenied,
    PolicyVerdict,
    require_org_role,
)
from proliferate.auth.dependencies import current_product_user
from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.engine import apply_rls_context_to_session, get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.errors import InvalidRequest, NotFoundError, PermissionDenied
from proliferate.middleware.request_context import set_resource_tenant_context
from proliferate.rls_context import set_rls_owner_context
from proliferate.server.billing.subjects import (
    ensure_organization_billing_subject_state,
    ensure_personal_billing_subject_state,
)

OrganizationRole = Literal["owner", "admin", "member"]

__all__ = [
    "ActorIdentity",
    "AuthenticatedUser",
    "CurrentOrgUser",
    "OwnerContext",
    "OwnerScope",
    "OwnerSelection",
    "PolicyAllowed",
    "PolicyDenied",
    "PolicyVerdict",
    "current_org_admin",
    "current_org_member",
    "current_org_owner",
    "current_owner_context",
    "current_path_org_admin",
    "current_path_org_member",
    "current_path_org_owner",
    "require_org_role",
    "require_owner_role",
]


@dataclass(frozen=True)
class CurrentOrgUser:
    actor_user_id: UUID
    organization_id: UUID
    membership_id: UUID
    role: OrganizationRole


async def current_owner_context(
    owner_scope: OwnerScope | None = Query(default=None, alias="ownerScope"),
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    header_owner_scope: OwnerScope | None = Header(
        default=None,
        alias="X-Proliferate-Owner-Scope",
    ),
    header_org_id: UUID | None = Header(default=None, alias="X-Proliferate-Org-Id"),
    cookie_org_id: UUID | None = Cookie(default=None, alias="proliferate_org_id"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OwnerContext:
    selection = _owner_selection_from_request(
        owner_scope=owner_scope,
        organization_id=organization_id,
        header_owner_scope=header_owner_scope,
        header_org_id=header_org_id,
        cookie_org_id=cookie_org_id,
    )
    return await _resolve_owner_context_for_selection(db, user, selection)


def require_owner_role(*roles: str) -> Callable[[OwnerContext], Awaitable[OwnerContext]]:
    async def dependency(
        context: OwnerContext = Depends(current_owner_context),
    ) -> OwnerContext:
        require_org_role(context, roles)
        return context

    return dependency


async def current_path_org_member(
    organization_id: UUID = Path(...),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CurrentOrgUser:
    return await _resolve_current_org_user(db, user=user, organization_id=organization_id)


async def current_path_org_admin(
    org_user: CurrentOrgUser = Depends(current_path_org_member),
) -> CurrentOrgUser:
    _require_current_org_role(org_user, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
    return org_user


async def current_path_org_owner(
    org_user: CurrentOrgUser = Depends(current_path_org_member),
) -> CurrentOrgUser:
    _require_current_org_role(org_user, {ORGANIZATION_ROLE_OWNER})
    return org_user


async def current_org_member(
    context: OwnerContext = Depends(current_owner_context),
) -> CurrentOrgUser:
    return _current_org_user_from_owner_context(context)


async def current_org_admin(
    org_user: CurrentOrgUser = Depends(current_org_member),
) -> CurrentOrgUser:
    _require_current_org_role(org_user, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
    return org_user


async def current_org_owner(
    org_user: CurrentOrgUser = Depends(current_org_member),
) -> CurrentOrgUser:
    _require_current_org_role(org_user, {ORGANIZATION_ROLE_OWNER})
    return org_user


def _owner_selection_from_request(
    *,
    owner_scope: OwnerScope | None,
    organization_id: UUID | None,
    header_owner_scope: OwnerScope | None,
    header_org_id: UUID | None,
    cookie_org_id: UUID | None,
) -> OwnerSelection:
    if owner_scope == "personal":
        return OwnerSelection(owner_scope="personal", organization_id=None)

    selected_org_id = organization_id or header_org_id or cookie_org_id
    selected_scope = owner_scope or header_owner_scope
    if selected_scope == "personal":
        return OwnerSelection(owner_scope="personal", organization_id=None)
    if selected_scope == "organization":
        if selected_org_id is None:
            raise InvalidRequest(
                "organizationId is required for organization scope.",
                code="missing_organization_id",
            )
        return OwnerSelection(owner_scope="organization", organization_id=selected_org_id)
    if selected_org_id is not None:
        return OwnerSelection(owner_scope="organization", organization_id=selected_org_id)
    return OwnerSelection(owner_scope="personal", organization_id=None)


async def _resolve_owner_context_for_selection(
    db: AsyncSession,
    user: User,
    selection: OwnerSelection,
) -> OwnerContext:
    if selection.owner_scope == "personal":
        set_resource_tenant_context(organization_id=None)
        set_rls_owner_context(owner_scope="personal", organization_id=None)
        await apply_rls_context_to_session(db)
        state = await ensure_personal_billing_subject_state(db, user.id)
        if state.kind != BILLING_SUBJECT_KIND_PERSONAL:
            raise InvalidRequest(
                "Personal billing subject could not be resolved.",
                code="invalid_owner_selection",
                status_code=500,
            )
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=state.billing_subject_id,
        )

    if selection.organization_id is None:
        raise InvalidRequest(
            "organizationId is required for organization scope.",
            code="missing_organization_id",
        )
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=selection.organization_id,
        user_id=user.id,
    )
    if record is None:
        raise NotFoundError(
            "Organization not found.",
            code="organization_not_found",
        )
    set_resource_tenant_context(organization_id=str(selection.organization_id))
    set_rls_owner_context(
        owner_scope="organization",
        organization_id=selection.organization_id,
    )
    await apply_rls_context_to_session(db)
    state = await ensure_organization_billing_subject_state(db, selection.organization_id)
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=user.id,
        owner_user_id=None,
        organization_id=selection.organization_id,
        membership_id=record.membership.id,
        membership_role=record.membership.role,
        billing_subject_id=state.billing_subject_id,
    )


async def _resolve_current_org_user(
    db: AsyncSession,
    *,
    user: User,
    organization_id: UUID,
) -> CurrentOrgUser:
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    if record is None:
        raise NotFoundError(
            "Organization not found.",
            code="organization_not_found",
        )
    set_resource_tenant_context(organization_id=str(organization_id))
    set_rls_owner_context(owner_scope="organization", organization_id=organization_id)
    await apply_rls_context_to_session(db)
    return CurrentOrgUser(
        actor_user_id=user.id,
        organization_id=organization_id,
        membership_id=record.membership.id,
        role=_coerce_org_role(record.membership.role),
    )


def _current_org_user_from_owner_context(context: OwnerContext) -> CurrentOrgUser:
    if (
        context.owner_scope != "organization"
        or context.organization_id is None
        or context.membership_id is None
        or context.membership_role is None
    ):
        raise NotFoundError(
            "Organization not found.",
            code="organization_not_found",
        )
    return CurrentOrgUser(
        actor_user_id=context.actor_user_id,
        organization_id=context.organization_id,
        membership_id=context.membership_id,
        role=_coerce_org_role(context.membership_role),
    )


def _coerce_org_role(role: str) -> OrganizationRole:
    if role in {"owner", "admin", "member"}:
        return cast(OrganizationRole, role)
    raise PermissionDenied(
        "Invalid organization membership role.",
        code="invalid_organization_role",
    )


def _require_current_org_role(org_user: CurrentOrgUser, roles: Iterable[str]) -> None:
    if org_user.role not in set(roles):
        raise PermissionDenied(
            "You do not have permission to manage this organization.",
            code="organization_permission_denied",
        )
