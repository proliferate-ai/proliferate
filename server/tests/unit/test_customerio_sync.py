"""Unit tests for the nightly Customer.io engagement sync task."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from proliferate.background.tasks import customerio_sync


def _uid() -> uuid.UUID:
    return uuid.uuid4()


@pytest.mark.asyncio
async def test_sync_page_pushes_attributes_for_users() -> None:
    """Verify _sync_page computes workspace_count, last_active_at, email_type
    and pushes them via push_user_attributes."""
    user1_id = _uid()
    user2_id = _uid()
    user_rows = [
        (user1_id, "alice@acme.com"),
        (user2_id, "bob@gmail.com"),
    ]

    last_seen = datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)
    last_login = datetime(2026, 7, 2, 8, 0, 0, tzinfo=UTC)

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    call_count = 0

    async def fake_execute(query):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # workspace counts
            return _FakeResult([(user1_id, 3)])
        elif call_count == 2:
            # activity last_seen_at
            return _FakeResult([(user1_id, last_seen), (user2_id, last_seen)])
        elif call_count == 3:
            # login last_login_at
            return _FakeResult([(user1_id, last_login)])
        return _FakeResult([])

    db = AsyncMock()
    db.execute = fake_execute

    push_mock = AsyncMock(return_value=True)
    with patch.object(customerio_sync, "push_user_attributes", push_mock):
        pushed = await customerio_sync._sync_page(db, user_rows)

    assert pushed == 2
    calls = push_mock.call_args_list

    # user1: workspace_count=3, last_active_at=last_login (greater), email_type=company
    u1_call = next(c for c in calls if c.kwargs["user_id"] == str(user1_id))
    assert u1_call.kwargs["attributes"]["workspace_count"] == 3
    assert u1_call.kwargs["attributes"]["last_active_at"] == int(last_login.timestamp())
    assert u1_call.kwargs["attributes"]["email_type"] == "company"

    # user2: workspace_count=0, last_active_at=last_seen, email_type=personal
    u2_call = next(c for c in calls if c.kwargs["user_id"] == str(user2_id))
    assert u2_call.kwargs["attributes"]["workspace_count"] == 0
    assert u2_call.kwargs["attributes"]["last_active_at"] == int(last_seen.timestamp())
    assert u2_call.kwargs["attributes"]["email_type"] == "personal"


@pytest.mark.asyncio
async def test_sync_page_omits_last_active_at_when_null() -> None:
    """last_active_at should not be in the payload when there is no activity."""
    user_id = _uid()
    user_rows = [(user_id, "user@company.io")]

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    async def fake_execute(query):
        return _FakeResult([])

    db = AsyncMock()
    db.execute = fake_execute

    push_mock = AsyncMock(return_value=True)
    with patch.object(customerio_sync, "push_user_attributes", push_mock):
        await customerio_sync._sync_page(db, user_rows)

    attrs = push_mock.call_args.kwargs["attributes"]
    assert "last_active_at" not in attrs
    assert attrs["workspace_count"] == 0
    assert attrs["email_type"] == "company"


@pytest.mark.asyncio
async def test_sync_page_counts_failures() -> None:
    """When push_user_attributes returns False, it shouldn't count as pushed."""
    user_id = _uid()
    user_rows = [(user_id, "x@gmail.com")]

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    async def fake_execute(query):
        return _FakeResult([])

    db = AsyncMock()
    db.execute = fake_execute

    push_mock = AsyncMock(return_value=False)
    with patch.object(customerio_sync, "push_user_attributes", push_mock):
        pushed = await customerio_sync._sync_page(db, user_rows)

    assert pushed == 0
