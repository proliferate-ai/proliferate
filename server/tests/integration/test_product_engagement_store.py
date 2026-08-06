"""Real-Postgres proof for Product Engagement resource-store reads."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import proliferate.integrations.customerio as customerio_integration
from proliferate.db.models.analytics import ClientDailyActivity
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.cloud.workspaces import (
    CLOUD_WORKSPACE_SCRATCH,
    CloudWorkspace,
)
from proliferate.db.store.analytics import list_latest_client_activity
from proliferate.db.store.auth_identities import list_latest_auth_logins
from proliferate.db.store.cloud_workspaces import list_active_workspace_counts
from proliferate.db.store.users import list_engagement_sync_users_page


def _user(user_id: UUID, email: str, *, is_active: bool = True) -> User:
    return User(
        id=user_id,
        email=email,
        hashed_password="unused",
        is_active=is_active,
        is_superuser=False,
        is_verified=True,
    )


def _workspace(
    *,
    owner_user_id: UUID,
    name: str,
    archived_at: datetime | None = None,
) -> CloudWorkspace:
    return CloudWorkspace(
        id=uuid4(),
        owner_user_id=owner_user_id,
        workspace_kind=CLOUD_WORKSPACE_SCRATCH,
        repo_environment_id=None,
        display_name=name,
        git_branch="main",
        git_base_branch=None,
        archived_at=archived_at,
    )


@pytest.mark.asyncio
async def test_engagement_stores_preserve_page_counts_maxima_and_frozen_values(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_ids = tuple(UUID(int=value) for value in range(1, 5))
    users = tuple(
        _user(
            user_id,
            f"user-{index}@example.com",
            is_active=index != 2,
        )
        for index, user_id in enumerate(user_ids, start=1)
    )
    db_session.add_all(users)
    await db_session.flush()

    archived_at = datetime(2026, 7, 1, tzinfo=UTC)
    db_session.add_all(
        [
            _workspace(owner_user_id=user_ids[0], name="active-one"),
            _workspace(owner_user_id=user_ids[0], name="active-two"),
            _workspace(
                owner_user_id=user_ids[0],
                name="archived",
                archived_at=archived_at,
            ),
            _workspace(
                owner_user_id=user_ids[1],
                name="archived-only",
                archived_at=archived_at,
            ),
            _workspace(owner_user_id=user_ids[2], name="active-three"),
        ]
    )

    early_activity = datetime(2026, 7, 2, 8, tzinfo=UTC)
    late_activity = datetime(2026, 7, 3, 9, tzinfo=UTC)
    db_session.add_all(
        [
            ClientDailyActivity(
                id=uuid4(),
                activity_date=date(2026, 7, 2),
                surface="desktop",
                actor_user_id=user_ids[0],
                anonymous_install_uuid=None,
                last_seen_at=early_activity,
            ),
            ClientDailyActivity(
                id=uuid4(),
                activity_date=date(2026, 7, 3),
                surface="web",
                actor_user_id=user_ids[0],
                anonymous_install_uuid=None,
                last_seen_at=late_activity,
            ),
            ClientDailyActivity(
                id=uuid4(),
                activity_date=date(2026, 7, 4),
                surface="mobile",
                actor_user_id=user_ids[2],
                anonymous_install_uuid=None,
                last_seen_at=early_activity,
            ),
        ]
    )

    early_login = datetime(2026, 7, 4, 10, tzinfo=UTC)
    late_login = datetime(2026, 7, 5, 11, tzinfo=UTC)
    db_session.add_all(
        [
            AuthIdentity(
                id=uuid4(),
                user_id=user_ids[0],
                provider="github",
                provider_subject="engagement-github-user-1",
                last_login_at=early_login,
            ),
            AuthIdentity(
                id=uuid4(),
                user_id=user_ids[0],
                provider="google",
                provider_subject="engagement-google-user-1",
                last_login_at=late_login,
            ),
            AuthIdentity(
                id=uuid4(),
                user_id=user_ids[1],
                provider="github",
                provider_subject="engagement-github-user-2",
                last_login_at=None,
            ),
            AuthIdentity(
                id=uuid4(),
                user_id=user_ids[2],
                provider="github",
                provider_subject="engagement-github-user-3",
                last_login_at=early_login,
            ),
        ]
    )
    await db_session.flush()

    provider_call = AsyncMock(side_effect=AssertionError("stores must not call provider"))
    monkeypatch.setattr(customerio_integration, "push_user_attributes", provider_call)

    first_page = await list_engagement_sync_users_page(
        db_session,
        after_id=None,
        limit=2,
    )
    second_page = await list_engagement_sync_users_page(
        db_session,
        after_id=user_ids[1],
        limit=2,
    )
    terminal_page = await list_engagement_sync_users_page(
        db_session,
        after_id=user_ids[3],
        limit=2,
    )
    assert tuple(value.id for value in first_page) == user_ids[:2]
    assert first_page[1].id == user_ids[1]  # inactive users remain in the all-user scan
    assert tuple(value.id for value in second_page) == user_ids[2:]
    assert terminal_page == ()
    assert all(value.id > user_ids[1] for value in second_page)

    workspace_counts = await list_active_workspace_counts(
        db_session,
        owner_user_ids=user_ids,
    )
    assert {value.owner_user_id: value.workspace_count for value in workspace_counts} == {
        user_ids[0]: 2,
        user_ids[2]: 1,
    }

    activities = await list_latest_client_activity(
        db_session,
        actor_user_ids=user_ids,
    )
    assert {value.actor_user_id: value.last_seen_at for value in activities} == {
        user_ids[0]: late_activity,
        user_ids[2]: early_activity,
    }

    logins = await list_latest_auth_logins(
        db_session,
        user_ids=user_ids,
    )
    assert {value.user_id: value.last_login_at for value in logins} == {
        user_ids[0]: late_login,
        user_ids[1]: None,
        user_ids[2]: early_login,
    }

    frozen_values = (
        (first_page[0], "email"),
        (workspace_counts[0], "workspace_count"),
        (activities[0], "last_seen_at"),
        (logins[0], "last_login_at"),
    )
    for value, field_name in frozen_values:
        with pytest.raises(FrozenInstanceError):
            setattr(value, field_name, getattr(value, field_name))

    provider_call.assert_not_awaited()
