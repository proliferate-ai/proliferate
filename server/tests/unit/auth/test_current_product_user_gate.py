"""Unit tests for the org-SSO carve-out in the product-readiness gate."""

from __future__ import annotations

from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth import dependencies
from proliferate.auth.identity.types import AccountReadiness
from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.errors import PermissionDenied


def _user() -> User:
    return User(
        id=uuid4(),
        email="person@example.com",
        hashed_password="unused-sso-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )


@pytest.mark.asyncio
async def test_single_org_mode_bypasses_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    user = _user()

    resolved = await dependencies.current_product_user(
        user=user,
        db=cast(AsyncSession, object()),
    )

    assert resolved is user


@pytest.mark.asyncio
async def test_org_sso_identity_passes_gate_without_github(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)

    async def fake_org_sso_membership(_db: AsyncSession, *, user_id: object) -> bool:
        return True

    async def fail_readiness(*_args: object, **_kwargs: object) -> AccountReadiness:
        raise AssertionError("GitHub readiness must not be consulted for org-SSO users.")

    monkeypatch.setattr(
        dependencies,
        "user_has_active_organization_sso_membership",
        fake_org_sso_membership,
    )
    monkeypatch.setattr(dependencies, "get_account_readiness", fail_readiness)

    user = _user()
    resolved = await dependencies.current_product_user(
        user=user,
        db=cast(AsyncSession, object()),
    )

    assert resolved is user


@pytest.mark.asyncio
async def test_plain_hosted_user_without_github_is_gated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "single_org_mode_override", False)

    async def fake_org_sso_membership(_db: AsyncSession, *, user_id: object) -> bool:
        return False

    async def fake_readiness(*_args: object, **_kwargs: object) -> AccountReadiness:
        return AccountReadiness(
            product_ready=False,
            missing_requirements=("github_identity_missing",),
            github_identity_id=None,
            github_grant_status=None,
        )

    monkeypatch.setattr(
        dependencies,
        "user_has_active_organization_sso_membership",
        fake_org_sso_membership,
    )
    monkeypatch.setattr(dependencies, "get_account_readiness", fake_readiness)

    with pytest.raises(PermissionDenied) as exc_info:
        await dependencies.current_product_user(
            user=_user(),
            db=cast(AsyncSession, object()),
        )

    assert exc_info.value.code == "github_link_required"
