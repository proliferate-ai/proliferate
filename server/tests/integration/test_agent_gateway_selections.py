"""Focused CRUD and revision-lineage coverage for agent auth selections."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import proliferate.db.store.agent_gateway.selections as selections_store
from proliferate.db.store import agent_gateway as store
from tests.integration.test_agent_gateway_store import _api_key, _create_user, _gateway


@pytest.mark.asyncio
async def test_put_creates_lists_and_filters_enabled(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
    )

    rows = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[
            _gateway(),
            _api_key(key.id, provider_hint="anthropic", enabled=False),
        ],
    )
    assert {(r.source_kind, r.enabled) for r in rows} == {
        ("gateway", True),
        ("api_key", False),
    }
    api_row = next(r for r in rows if r.source_kind == "api_key")
    assert api_row.env_var_name == "ANTHROPIC_API_KEY"
    assert api_row.provider_hint == "anthropic"

    all_rows = await store.list_auth_selections(db_session, user_id=user_id)
    assert len(all_rows) == 2
    assert await store.list_auth_selections(db_session, user_id=user_id, surface="cloud") == []

    # Disabled rows stay in the DB but never reach the renderer helper.
    enabled = await store.list_enabled_auth_selections(
        db_session, user_id=user_id, surface="local"
    )
    assert [r.source_kind for r in enabled] == ["gateway"]


@pytest.mark.asyncio
async def test_put_is_full_desired_state_replace(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
    )

    first = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        sources=[_gateway(), _api_key(key.id)],
    )
    gateway_id = next(r.id for r in first if r.source_kind == "gateway")

    # Dropping the api_key source deletes its row; the gateway row is kept
    # (same id + created_at) rather than churned.
    second = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="opencode",
        surface="cloud",
        sources=[_gateway()],
    )
    assert [r.source_kind for r in second] == ["gateway"]
    assert second[0].id == gateway_id


@pytest.mark.asyncio
async def test_put_updates_row_in_place(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
    )

    first = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[_api_key(key.id, enabled=True)],
    )
    row_id = first[0].id

    second = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[_api_key(key.id, provider_hint="anthropic", enabled=False)],
    )
    assert second[0].id == row_id
    assert second[0].enabled is False
    assert second[0].provider_hint == "anthropic"


@pytest.mark.asyncio
async def test_put_normalizes_empty_sources_to_monotonic_disabled_gateway_marker(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="OpenAI", value="sk-openai-1234abcd"
    )
    first_write = datetime(2026, 7, 15, tzinfo=UTC)
    clear_write = first_write + timedelta(seconds=1)
    writes = iter((first_write, clear_write))
    monkeypatch.setattr(selections_store, "utcnow", lambda: next(writes))

    first = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="codex",
        surface="local",
        sources=[_gateway(enabled=False), _api_key(key.id)],
    )
    gateway_id = next(row.id for row in first if row.source_kind == "gateway")

    cleared = await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="codex",
        surface="local",
        sources=[],
    )

    assert len(cleared) == 1
    assert cleared[0].id == gateway_id
    assert cleared[0].enabled is False
    assert cleared[0].updated_at == clear_write
