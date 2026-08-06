"""Characterization of explicit legacy OAuth user-creation results."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi_users import exceptions as fastapi_users_exceptions

from proliferate.auth.users import UserManager


def _manager(user_db: object) -> UserManager:
    return UserManager(user_db)  # type: ignore[arg-type]


def _oauth_account() -> SimpleNamespace:
    return SimpleNamespace(account_id="account-id", oauth_name="github")


@pytest.mark.asyncio
async def test_oauth_callback_result_marks_only_the_create_branch() -> None:
    created = SimpleNamespace(oauth_accounts=[])
    user_db = SimpleNamespace(
        get_by_oauth_account=AsyncMock(return_value=None),
        get_by_email=AsyncMock(return_value=None),
        create=AsyncMock(return_value=created),
        add_oauth_account=AsyncMock(return_value=created),
    )

    result = await _manager(user_db).oauth_callback_with_result(
        "github", "access-token", "account-id", "person@example.com", is_verified_by_default=True
    )

    assert result.user is created
    assert result.created is True
    user_db.create.assert_awaited_once()
    user_db.add_oauth_account.assert_awaited_once()


@pytest.mark.asyncio
async def test_oauth_callback_result_keeps_associated_and_existing_users_uncreated() -> None:
    associated = SimpleNamespace(oauth_accounts=[])
    associated_db = SimpleNamespace(
        get_by_oauth_account=AsyncMock(return_value=None),
        get_by_email=AsyncMock(return_value=associated),
        create=AsyncMock(),
        add_oauth_account=AsyncMock(return_value=associated),
    )
    associated_result = await _manager(associated_db).oauth_callback_with_result(
        "github", "access-token", "account-id", "person@example.com", associate_by_email=True
    )
    assert associated_result.user is associated
    assert associated_result.created is False
    associated_db.create.assert_not_awaited()

    existing = SimpleNamespace(oauth_accounts=[_oauth_account()])
    existing_db = SimpleNamespace(
        get_by_oauth_account=AsyncMock(return_value=existing),
        get_by_email=AsyncMock(),
        create=AsyncMock(),
        add_oauth_account=AsyncMock(),
        update_oauth_account=AsyncMock(return_value=existing),
    )
    existing_result = await _manager(existing_db).oauth_callback_with_result(
        "github", "access-token", "account-id", "person@example.com"
    )
    assert existing_result.user is existing
    assert existing_result.created is False
    existing_db.update_oauth_account.assert_awaited_once()


@pytest.mark.asyncio
async def test_oauth_callback_result_preserves_unassociated_email_conflict() -> None:
    existing = SimpleNamespace(oauth_accounts=[])
    user_db = SimpleNamespace(
        get_by_oauth_account=AsyncMock(return_value=None),
        get_by_email=AsyncMock(return_value=existing),
        create=AsyncMock(),
        add_oauth_account=AsyncMock(),
    )

    with pytest.raises(fastapi_users_exceptions.UserAlreadyExists):
        await _manager(user_db).oauth_callback_with_result(
            "github", "access-token", "account-id", "person@example.com"
        )

    user_db.create.assert_not_awaited()
    user_db.add_oauth_account.assert_not_awaited()
