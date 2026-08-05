"""Characterization tests for the nightly Customer.io engagement sync."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest

from proliferate.background.tasks import customerio_sync as customerio_task
from proliferate.constants.product_engagement import (
    CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE,
)
from proliferate.db.store.analytics import LatestClientActivityValue
from proliferate.db.store.auth_identities import LatestAuthLoginValue
from proliferate.db.store.cloud_workspaces import ActiveWorkspaceCountValue
from proliferate.db.store.users import EngagementSyncUserValue
from proliferate.server.product_engagement.worker import service as engagement_service


def _user_id(value: int) -> UUID:
    return UUID(int=value)


class _SessionContext:
    def __init__(self, factory: _SessionFactory, number: int) -> None:
        self.factory = factory
        self.number = number

    async def __aenter__(self) -> int:
        self.factory.open_sessions += 1
        self.factory.events.append(("session_enter", self.number))
        return self.number

    async def __aexit__(self, *_args: Any) -> None:
        self.factory.events.append(("session_exit", self.number))
        self.factory.open_sessions -= 1


class _SessionFactory:
    def __init__(self, events: list[tuple[object, ...]]) -> None:
        self.events = events
        self.open_sessions = 0
        self.created = 0

    def __call__(self) -> _SessionContext:
        self.created += 1
        return _SessionContext(self, self.created)


@pytest.mark.asyncio
async def test_worker_preserves_pagination_query_order_profiles_and_partial_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user1 = EngagementSyncUserValue(_user_id(1), "alice@acme.com")
    user2 = EngagementSyncUserValue(_user_id(2), "bob@gmail.com")
    user3 = EngagementSyncUserValue(_user_id(3), None)
    first_activity = datetime(2026, 7, 1, 12, tzinfo=UTC)
    later_login = datetime(2026, 7, 2, 8, tzinfo=UTC)
    second_activity = datetime(2026, 7, 3, 9, tzinfo=UTC)
    events: list[tuple[object, ...]] = []
    factory = _SessionFactory(events)

    async def list_users(
        db: object,
        *,
        after_id: UUID | None,
        limit: int,
    ) -> tuple[EngagementSyncUserValue, ...]:
        events.append(("users", db, after_id, limit))
        return {
            None: (user1, user2),
            user2.id: (user3,),
            user3.id: (),
        }[after_id]

    async def workspace_counts(
        db: object,
        *,
        owner_user_ids: tuple[UUID, ...],
    ) -> tuple[ActiveWorkspaceCountValue, ...]:
        events.append(("workspaces", db, owner_user_ids))
        if owner_user_ids == (user1.id, user2.id):
            return (ActiveWorkspaceCountValue(user1.id, 3),)
        return ()

    async def client_activity(
        db: object,
        *,
        actor_user_ids: tuple[UUID, ...],
    ) -> tuple[LatestClientActivityValue, ...]:
        events.append(("activity", db, actor_user_ids))
        if actor_user_ids == (user1.id, user2.id):
            return (
                LatestClientActivityValue(user1.id, first_activity),
                LatestClientActivityValue(user2.id, second_activity),
            )
        return ()

    async def auth_logins(
        db: object,
        *,
        user_ids: tuple[UUID, ...],
    ) -> tuple[LatestAuthLoginValue, ...]:
        events.append(("logins", db, user_ids))
        if user_ids == (user1.id, user2.id):
            return (
                LatestAuthLoginValue(user1.id, later_login),
                LatestAuthLoginValue(user2.id, None),
            )
        return ()

    pushes: list[tuple[str, dict[str, Any]]] = []
    logs: list[tuple[str, tuple[object, ...]]] = []
    push_results = (True, False, True)

    async def push(*, user_id: str, attributes: dict[str, Any]) -> bool:
        assert factory.open_sessions == 0
        events.append(("push", user_id))
        pushes.append((user_id, attributes))
        return push_results[len(pushes) - 1]

    monkeypatch.setattr(engagement_service, "list_engagement_sync_users_page", list_users)
    monkeypatch.setattr(engagement_service, "list_active_workspace_counts", workspace_counts)
    monkeypatch.setattr(engagement_service, "list_latest_client_activity", client_activity)
    monkeypatch.setattr(engagement_service, "list_latest_auth_logins", auth_logins)
    monkeypatch.setattr(engagement_service, "push_user_attributes", push)
    monkeypatch.setattr(
        engagement_service.logger,
        "info",
        lambda message, *args: logs.append((message, args)),
    )

    await engagement_service.run_customerio_engagement_sync(factory)  # type: ignore[arg-type]

    assert events == [
        ("session_enter", 1),
        ("users", 1, None, CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE),
        ("workspaces", 1, (user1.id, user2.id)),
        ("activity", 1, (user1.id, user2.id)),
        ("logins", 1, (user1.id, user2.id)),
        ("session_exit", 1),
        ("push", str(user1.id)),
        ("push", str(user2.id)),
        ("session_enter", 2),
        ("users", 2, user2.id, CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE),
        ("workspaces", 2, (user3.id,)),
        ("activity", 2, (user3.id,)),
        ("logins", 2, (user3.id,)),
        ("session_exit", 2),
        ("push", str(user3.id)),
        ("session_enter", 3),
        ("users", 3, user3.id, CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE),
        ("session_exit", 3),
    ]
    assert pushes == [
        (
            str(user1.id),
            {
                "workspace_count": 3,
                "email_type": "company",
                "last_active_at": int(later_login.timestamp()),
            },
        ),
        (
            str(user2.id),
            {
                "workspace_count": 0,
                "email_type": "personal",
                "last_active_at": int(second_activity.timestamp()),
            },
        ),
        (
            str(user3.id),
            {
                "workspace_count": 0,
                "email_type": "personal",
            },
        ),
    ]
    assert logs == [
        (
            "Customer.io engagement sync complete: %d users processed, %d pushed successfully",
            (3, 2),
        )
    ]


@pytest.mark.asyncio
async def test_worker_logs_zero_totals_without_running_aggregate_or_provider_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[object, ...]] = []
    logs: list[tuple[str, tuple[object, ...]]] = []
    factory = _SessionFactory(events)

    async def no_users(
        _db: object,
        *,
        after_id: UUID | None,
        limit: int,
    ) -> tuple[EngagementSyncUserValue, ...]:
        assert after_id is None
        assert limit == CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE
        return ()

    async def forbidden(*_args: object, **_kwargs: object) -> tuple[()]:
        raise AssertionError("terminal page must not run aggregates or provider calls")

    monkeypatch.setattr(engagement_service, "list_engagement_sync_users_page", no_users)
    monkeypatch.setattr(engagement_service, "list_active_workspace_counts", forbidden)
    monkeypatch.setattr(engagement_service, "list_latest_client_activity", forbidden)
    monkeypatch.setattr(engagement_service, "list_latest_auth_logins", forbidden)
    monkeypatch.setattr(engagement_service, "push_user_attributes", forbidden)
    monkeypatch.setattr(
        engagement_service.logger,
        "info",
        lambda message, *args: logs.append((message, args)),
    )

    await engagement_service.run_customerio_engagement_sync(factory)  # type: ignore[arg-type]

    assert events == [("session_enter", 1), ("session_exit", 1)]
    assert logs == [
        (
            "Customer.io engagement sync complete: %d users processed, %d pushed successfully",
            (0, 0),
        )
    ]


@pytest.mark.asyncio
async def test_worker_store_failure_escapes_after_closing_session_without_success_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = EngagementSyncUserValue(_user_id(1), "user@example.com")
    events: list[tuple[object, ...]] = []
    logs: list[tuple[str, tuple[object, ...]]] = []
    factory = _SessionFactory(events)

    async def users(*_args: object, **_kwargs: object) -> tuple[EngagementSyncUserValue, ...]:
        return (user,)

    async def fail(*_args: object, **_kwargs: object) -> tuple[ActiveWorkspaceCountValue, ...]:
        raise RuntimeError("query failed")

    async def forbidden(*_args: object, **_kwargs: object) -> tuple[()]:
        raise AssertionError("processing must stop after the failed store")

    monkeypatch.setattr(engagement_service, "list_engagement_sync_users_page", users)
    monkeypatch.setattr(engagement_service, "list_active_workspace_counts", fail)
    monkeypatch.setattr(engagement_service, "list_latest_client_activity", forbidden)
    monkeypatch.setattr(engagement_service, "list_latest_auth_logins", forbidden)
    monkeypatch.setattr(engagement_service, "push_user_attributes", forbidden)
    monkeypatch.setattr(
        engagement_service.logger,
        "info",
        lambda message, *args: logs.append((message, args)),
    )

    with pytest.raises(RuntimeError, match="query failed"):
        await engagement_service.run_customerio_engagement_sync(factory)  # type: ignore[arg-type]

    assert events == [("session_enter", 1), ("session_exit", 1)]
    assert logs == []


@pytest.mark.asyncio
async def test_worker_unexpected_integration_failure_escapes_after_session_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = EngagementSyncUserValue(_user_id(1), "user@example.com")
    events: list[tuple[object, ...]] = []
    logs: list[tuple[str, tuple[object, ...]]] = []
    factory = _SessionFactory(events)

    async def users(*_args: object, **_kwargs: object) -> tuple[EngagementSyncUserValue, ...]:
        return (user,)

    async def empty(*_args: object, **_kwargs: object) -> tuple[()]:
        return ()

    async def fail_push(*_args: object, **_kwargs: object) -> bool:
        assert factory.open_sessions == 0
        events.append(("push", str(user.id)))
        raise RuntimeError("unexpected adapter failure")

    monkeypatch.setattr(engagement_service, "list_engagement_sync_users_page", users)
    monkeypatch.setattr(engagement_service, "list_active_workspace_counts", empty)
    monkeypatch.setattr(engagement_service, "list_latest_client_activity", empty)
    monkeypatch.setattr(engagement_service, "list_latest_auth_logins", empty)
    monkeypatch.setattr(engagement_service, "push_user_attributes", fail_push)
    monkeypatch.setattr(
        engagement_service.logger,
        "info",
        lambda message, *args: logs.append((message, args)),
    )

    with pytest.raises(RuntimeError, match="unexpected adapter failure"):
        await engagement_service.run_customerio_engagement_sync(factory)  # type: ignore[arg-type]

    assert events == [
        ("session_enter", 1),
        ("session_exit", 1),
        ("push", str(user.id)),
    ]
    assert logs == []


def test_task_uses_distinct_task_local_engines_and_returns_ok_only_on_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    monkeypatch.setattr(customerio_task.settings, "customerio_site_id", "")
    monkeypatch.setattr(customerio_task.settings, "customerio_api_key", "")

    class _Engine:
        def __init__(self, number: int) -> None:
            self.number = number

        async def dispose(self) -> None:
            calls.append(("dispose", self.number))

    def create_engine(database_url: str, **kwargs: object) -> _Engine:
        number = 1 + sum(call[0] == "engine" for call in calls)
        calls.append(("engine", number, database_url, kwargs))
        return _Engine(number)

    def sessionmaker(engine: _Engine, **kwargs: object) -> tuple[str, int]:
        calls.append(("sessionmaker", engine.number, kwargs))
        return ("factory", engine.number)

    async def run(factory: tuple[str, int]) -> None:
        calls.append(("run", factory))

    monkeypatch.setattr(customerio_task, "create_async_engine", create_engine)
    monkeypatch.setattr(customerio_task, "async_sessionmaker", sessionmaker)
    monkeypatch.setattr(customerio_task, "run_customerio_engagement_sync", run)

    assert customerio_task.customerio_engagement_sync() == "ok"
    assert customerio_task.customerio_engagement_sync() == "ok"
    assert calls == [
        (
            "engine",
            1,
            customerio_task.settings.database_url,
            {"pool_pre_ping": True, "connect_args": {"statement_cache_size": 0}},
        ),
        ("sessionmaker", 1, {"expire_on_commit": False}),
        ("run", ("factory", 1)),
        ("dispose", 1),
        (
            "engine",
            2,
            customerio_task.settings.database_url,
            {"pool_pre_ping": True, "connect_args": {"statement_cache_size": 0}},
        ),
        ("sessionmaker", 2, {"expire_on_commit": False}),
        ("run", ("factory", 2)),
        ("dispose", 2),
    ]


def test_task_disposes_engine_and_propagates_worker_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    class _Engine:
        async def dispose(self) -> None:
            calls.append("dispose")

    def create_engine(*_args: object, **_kwargs: object) -> _Engine:
        calls.append("engine")
        return _Engine()

    def sessionmaker(*_args: object, **_kwargs: object) -> object:
        calls.append("sessionmaker")
        return object()

    async def fail(_factory: object) -> None:
        calls.append("run")
        raise RuntimeError("worker failed")

    monkeypatch.setattr(customerio_task, "create_async_engine", create_engine)
    monkeypatch.setattr(customerio_task, "async_sessionmaker", sessionmaker)
    monkeypatch.setattr(customerio_task, "run_customerio_engagement_sync", fail)

    with pytest.raises(RuntimeError, match="worker failed"):
        customerio_task.customerio_engagement_sync()

    assert calls == ["engine", "sessionmaker", "run", "dispose"]
