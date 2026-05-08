from __future__ import annotations

from uuid import uuid4

import pytest

from proliferate.auth.authorization import OwnerContext, OwnerScope, require_org_role
from proliferate.errors import NotFoundError, PermissionDenied


def _owner_context(*, role: str | None, scope: OwnerScope = "organization") -> OwnerContext:
    return OwnerContext(
        owner_scope=scope,
        actor_user_id=uuid4(),
        owner_user_id=None,
        organization_id=uuid4() if scope == "organization" else None,
        membership_id=uuid4() if role is not None else None,
        membership_role=role,
        billing_subject_id=uuid4(),
    )


def test_require_org_role_allows_matching_role() -> None:
    require_org_role(_owner_context(role="owner"), {"owner", "admin"})


def test_require_org_role_rejects_non_organization_context() -> None:
    with pytest.raises(NotFoundError) as exc_info:
        require_org_role(_owner_context(role=None, scope="personal"), {"owner"})

    assert exc_info.value.code == "organization_not_found"
    assert exc_info.value.message == "Organization not found."
    assert exc_info.value.status_code == 404


def test_require_org_role_rejects_missing_membership() -> None:
    with pytest.raises(NotFoundError) as exc_info:
        require_org_role(_owner_context(role=None), {"owner"})

    assert exc_info.value.code == "organization_not_found"
    assert exc_info.value.message == "Organization not found."
    assert exc_info.value.status_code == 404


def test_require_org_role_rejects_disallowed_role() -> None:
    with pytest.raises(PermissionDenied) as exc_info:
        require_org_role(_owner_context(role="member"), {"owner", "admin"})

    assert exc_info.value.code == "organization_permission_denied"
    assert exc_info.value.message == "You do not have permission to manage this organization."
    assert exc_info.value.status_code == 403
