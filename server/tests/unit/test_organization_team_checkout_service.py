from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.organizations import service as organization_service

EXPIRES_AT = datetime(2026, 8, 6, 9, 0, tzinfo=UTC)


def _session() -> AsyncSession:
    return cast(AsyncSession, object())


def _actor() -> organization_service.OrganizationActor:
    return cast(
        organization_service.OrganizationActor,
        SimpleNamespace(id=uuid4(), email="owner@example.com", display_name="Owner"),
    )


@pytest.mark.asyncio
async def test_ensure_pending_team_checkout_returns_current_after_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    actor = _actor()
    expected = object()
    calls: list[tuple[str, object, object]] = []

    async def _lock(actual_db: AsyncSession, user_id: UUID) -> None:
        calls.append(("lock", actual_db, user_id))

    async def _current(actual_db: AsyncSession, user_id: UUID) -> object:
        calls.append(("current", actual_db, user_id))
        return expected

    async def _unexpected_create(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("an existing checkout intent must be reused")

    monkeypatch.setattr(
        organization_service.organization_store,
        "acquire_membership_activation_lock",
        _lock,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "get_current_team_checkout_intent",
        _current,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "create_pending_team_checkout_intent",
        _unexpected_create,
    )

    result = await organization_service.ensure_pending_team_checkout_intent(
        db,
        actor,
        team_name="Team",
        logo_domain="example.com",
        idempotency_key="intent-key",
        invite_emails=["invitee@example.com"],
        expires_at=EXPIRES_AT,
    )

    assert result is expected
    assert calls == [
        ("lock", db, actor.id),
        ("current", db, actor.id),
    ]


@pytest.mark.asyncio
async def test_ensure_pending_team_checkout_creates_after_lock_and_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    actor = _actor()
    expected = object()
    calls: list[tuple[str, object]] = []

    async def _lock(actual_db: AsyncSession, user_id: UUID) -> None:
        calls.append(("lock", (actual_db, user_id)))

    async def _current(actual_db: AsyncSession, user_id: UUID) -> None:
        calls.append(("current", (actual_db, user_id)))
        return None

    async def _create(actual_db: AsyncSession, **kwargs: object) -> object:
        calls.append(("create", {"db": actual_db, **kwargs}))
        return expected

    monkeypatch.setattr(
        organization_service.organization_store,
        "acquire_membership_activation_lock",
        _lock,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "get_current_team_checkout_intent",
        _current,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "create_pending_team_checkout_intent",
        _create,
    )

    result = await organization_service.ensure_pending_team_checkout_intent(
        db,
        actor,
        team_name="Team",
        logo_domain="example.com",
        idempotency_key="intent-key",
        invite_emails=["one@example.com", "two@example.com"],
        expires_at=EXPIRES_AT,
    )

    assert result is expected
    assert calls == [
        ("lock", (db, actor.id)),
        ("current", (db, actor.id)),
        (
            "create",
            {
                "db": db,
                "created_by_user_id": actor.id,
                "team_name": "Team",
                "logo_domain": "example.com",
                "idempotency_key": "intent-key",
                "invite_emails": ["one@example.com", "two@example.com"],
                "expires_at": EXPIRES_AT,
            },
        ),
    ]


@pytest.mark.parametrize("store_result", [None, object()])
@pytest.mark.asyncio
async def test_get_current_team_checkout_intent_forwards_actor(
    monkeypatch: pytest.MonkeyPatch,
    store_result: object | None,
) -> None:
    db = _session()
    actor = _actor()
    calls: list[tuple[AsyncSession, UUID]] = []

    async def _current(actual_db: AsyncSession, user_id: UUID) -> object | None:
        calls.append((actual_db, user_id))
        return store_result

    monkeypatch.setattr(
        organization_service.organization_store,
        "get_current_team_checkout_intent",
        _current,
    )

    result = await organization_service.get_current_team_checkout_intent(db, actor)

    assert result is store_result
    assert calls == [(db, actor.id)]


@pytest.mark.parametrize("store_result", [None, object()])
@pytest.mark.asyncio
async def test_bind_team_checkout_session_forwards_every_field(
    monkeypatch: pytest.MonkeyPatch,
    store_result: object | None,
) -> None:
    db = _session()
    intent_id = uuid4()
    calls: list[dict[str, object]] = []

    async def _bind(actual_db: AsyncSession, **kwargs: object) -> object | None:
        calls.append({"db": actual_db, **kwargs})
        return store_result

    monkeypatch.setattr(
        organization_service.organization_store,
        "bind_team_checkout_session",
        _bind,
    )

    result = await organization_service.bind_team_checkout_session(
        db,
        intent_id=intent_id,
        stripe_checkout_session_id="cs_123",
        stripe_customer_id="cus_123",
        checkout_url="https://checkout.example/session",
    )

    assert result is store_result
    assert calls == [
        {
            "db": db,
            "intent_id": intent_id,
            "stripe_checkout_session_id": "cs_123",
            "stripe_customer_id": "cus_123",
            "checkout_url": "https://checkout.example/session",
        }
    ]


@pytest.mark.parametrize("store_result", [None, object()])
@pytest.mark.asyncio
async def test_cancel_team_checkout_intent_forwards_actor_and_intent(
    monkeypatch: pytest.MonkeyPatch,
    store_result: object | None,
) -> None:
    db = _session()
    actor = _actor()
    intent_id = uuid4()
    calls: list[dict[str, object]] = []

    async def _cancel(actual_db: AsyncSession, **kwargs: object) -> object | None:
        calls.append({"db": actual_db, **kwargs})
        return store_result

    monkeypatch.setattr(
        organization_service.organization_store,
        "cancel_team_checkout_intent",
        _cancel,
    )

    result = await organization_service.cancel_team_checkout_intent(db, actor, intent_id)

    assert result is store_result
    assert calls == [
        {
            "db": db,
            "intent_id": intent_id,
            "created_by_user_id": actor.id,
        }
    ]
