from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from proliferate.errors import NotFoundError, PermissionDenied

OwnerScope = Literal["personal", "organization"]


class ActorIdentity(Protocol):
    id: UUID


class AuthenticatedUser(ActorIdentity, Protocol):
    email: str


@dataclass(frozen=True)
class OwnerSelection:
    owner_scope: OwnerScope = "personal"
    organization_id: UUID | None = None


@dataclass(frozen=True)
class OwnerContext:
    owner_scope: OwnerScope
    actor_user_id: UUID
    owner_user_id: UUID | None
    organization_id: UUID | None
    membership_id: UUID | None
    membership_role: str | None
    billing_subject_id: UUID


@dataclass(frozen=True)
class PolicyAllowed:
    allowed: Literal[True] = True


@dataclass(frozen=True)
class PolicyDenied:
    code: str
    message: str
    status_code: int = 403
    allowed: Literal[False] = False


PolicyVerdict = PolicyAllowed | PolicyDenied


def require_org_role(context: OwnerContext, roles: Iterable[str]) -> None:
    if context.owner_scope != "organization" or context.membership_role is None:
        raise NotFoundError(
            "Organization not found.",
            code="organization_not_found",
        )
    if context.membership_role not in set(roles):
        raise PermissionDenied(
            "You do not have permission to manage this organization.",
            code="organization_permission_denied",
        )
