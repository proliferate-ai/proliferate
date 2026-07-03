"""Integration tests for route-selection slot composition (real Postgres)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import agent_gateway as store


async def _create_user(db_session: AsyncSession, *, email: str | None = None) -> uuid.UUID:
    user = User(
        email=email or f"agent-gateway-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


@pytest.mark.asyncio
async def test_single_source_harness_rejects_non_primary_slot(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    for harness in ("claude", "codex", "grok"):
        with pytest.raises(ValueError, match="single-source"):
            await store.upsert_route_selection(
                db_session,
                user_id=user_id,
                harness_kind=harness,
                surface="local",
                route="gateway",
                slot="gateway",
            )


@pytest.mark.asyncio
async def test_opencode_slots_compose_additively(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    anthropic_key = await store.create_agent_api_key(
        db_session,
        user_id=user_id,
        provider="anthropic",
        display_name="Anthropic key",
        payload="sk-ant-api03-abcdefabc4",
    )

    gateway = await store.upsert_route_selection(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        route="gateway",
        slot="gateway",
    )
    direct = await store.upsert_route_selection(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        route="api_key",
        api_key_id=anthropic_key.id,
        slot="anthropic",
    )
    assert gateway.slot == "gateway"
    assert direct.slot == "anthropic"
    assert gateway.id != direct.id

    listed = await store.list_route_selections(db_session, user_id=user_id)
    assert [(record.harness_kind, record.slot) for record in listed] == [
        ("opencode", "anthropic"),
        ("opencode", "gateway"),
    ]

    # Slot-scoped get/delete leave sibling slots untouched.
    fetched = await store.get_route_selection(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        slot="anthropic",
    )
    assert fetched is not None
    assert fetched.id == direct.id
    assert (
        await store.get_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
        )
        is None
    )
    assert await store.delete_route_selection(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        slot="anthropic",
    )
    remaining = await store.list_route_selections(db_session, user_id=user_id)
    assert [record.slot for record in remaining] == ["gateway"]


@pytest.mark.asyncio
async def test_opencode_slot_route_legality(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    openai_key = await store.create_agent_api_key(
        db_session,
        user_id=user_id,
        provider="openai",
        display_name="OpenAI key",
        payload="sk-proj-abcdef1234",
    )

    with pytest.raises(ValueError, match="slots"):
        await store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            route="gateway",
        )
    with pytest.raises(ValueError, match="gateway.*slot"):
        await store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            route="api_key",
            api_key_id=openai_key.id,
            slot="gateway",
        )
    with pytest.raises(ValueError, match="api_key"):
        await store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            route="gateway",
            slot="openai",
        )
    # Provider slots require a key of the same provider.
    with pytest.raises(ValueError, match="requires a anthropic key"):
        await store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            route="api_key",
            api_key_id=openai_key.id,
            slot="anthropic",
        )
