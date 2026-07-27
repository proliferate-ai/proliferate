"""Focused CRUD and revision-lineage coverage for agent auth selections."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import proliferate.db.store.agent_gateway.selections as selections_store
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
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


@pytest.mark.asyncio
async def test_touch_bumps_one_surface_and_only_that_surface(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`touch_auth_selection_revisions` is the out-of-band revision-bump seam
    (enrollment-sync's local-surface poke, proof C5): it advances every row of
    the named surface — enabled or not — and leaves sibling surfaces alone."""
    user_id = await _create_user(db_session)
    write_time = datetime(2026, 7, 15, tzinfo=UTC)
    touch_time = write_time + timedelta(seconds=30)
    monkeypatch.setattr(selections_store, "utcnow", lambda: write_time)
    for surface in ("local", "cloud"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface=surface,
            sources=[_gateway()],
        )

    monkeypatch.setattr(selections_store, "utcnow", lambda: touch_time)
    touched = await store.touch_auth_selection_revisions(
        db_session, user_id=user_id, surface="local"
    )

    # The local scope holds the enabled gateway row (put normalizes a marker
    # into the same row here, so one row per surface).
    assert touched == 1
    local_rows = await store.list_auth_selections(db_session, user_id=user_id, surface="local")
    assert {row.updated_at for row in local_rows} == {touch_time}
    cloud_rows = await store.list_auth_selections(db_session, user_id=user_id, surface="cloud")
    assert {row.updated_at for row in cloud_rows} == {write_time}

    with pytest.raises(ValueError, match="Unknown agent auth surface"):
        await store.touch_auth_selection_revisions(
            db_session, user_id=user_id, surface="mainframe"
        )


def _typed(
    key_id: uuid.UUID,
    *,
    provider_hint: str | None = None,
    enabled: bool = True,
) -> DesiredAuthSource:
    """A selection source referencing a TYPED vault entry: no env_var_name by
    law (agent-auth.md: "a selection referencing a typed entry names no
    env_var_name" — the typed kind carries its own env mapping)."""
    return DesiredAuthSource(
        source_kind="api_key",
        api_key_id=key_id,
        env_var_name=None,
        provider_hint=provider_hint,
        enabled=enabled,
    )


async def _bedrock_entry(db_session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    record = await store.create_agent_provider_config(
        db_session,
        user_id=user_id,
        title="Personal Bedrock",
        kind="aws_bedrock",
        value={"region": "us-east-1", "bearerToken": "bedrock-token-abcd"},
    )
    return record.id


class TestTypedProviderConfigWriteGate:
    """The typed-config write gate (agent-auth.md "The vault", proofs A5/A6):
    a selection may reference a typed vault entry exactly when the harness's
    registry declares that providerConfig kind non-pending; the shape law is
    bare-requires-env-var XOR typed-forbids-one."""

    @pytest.mark.asyncio
    async def test_put_accepts_typed_entry_for_declared_kind(
        self,
        db_session: AsyncSession,
    ) -> None:
        user_id = await _create_user(db_session)
        entry_id = await _bedrock_entry(db_session, user_id)

        rows = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_typed(entry_id)],
            supported_provider_config_kinds=("aws_bedrock",),
        )
        typed_row = next(r for r in rows if r.source_kind == "api_key")
        assert typed_row.api_key_id == entry_id
        assert typed_row.env_var_name is None
        assert typed_row.enabled is True

    @pytest.mark.asyncio
    async def test_put_updates_typed_row_in_place(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        entry_id = await _bedrock_entry(db_session, user_id)
        vocabulary = ("aws_bedrock",)

        first = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_typed(entry_id)],
            supported_provider_config_kinds=vocabulary,
        )
        row_id = next(r.id for r in first if r.source_kind == "api_key")

        second = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_typed(entry_id, enabled=False)],
            supported_provider_config_kinds=vocabulary,
        )
        typed_row = next(r for r in second if r.source_kind == "api_key")
        assert typed_row.id == row_id
        assert typed_row.enabled is False

    @pytest.mark.asyncio
    async def test_put_rejects_typed_entry_for_undeclared_kind(
        self,
        db_session: AsyncSession,
    ) -> None:
        # The store's default vocabulary is EMPTY — closed unless the caller
        # (the service layer, reading the registry) opens it. This is the
        # registry-driven typed refusal for an undeclared/pending combo.
        user_id = await _create_user(db_session)
        entry_id = await _bedrock_entry(db_session, user_id)

        with pytest.raises(
            store.AgentProviderConfigNotSupportedError,
            match="does not support provider-config kind 'aws_bedrock'",
        ):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="grok",
                surface="local",
                sources=[_typed(entry_id)],
            )

    @pytest.mark.asyncio
    async def test_put_rejects_typed_entry_carrying_env_var_name(
        self,
        db_session: AsyncSession,
    ) -> None:
        # Proof A6, illegal shape 1: a typed-entry selection with an env var.
        user_id = await _create_user(db_session)
        entry_id = await _bedrock_entry(db_session, user_id)

        with pytest.raises(ValueError, match="typed vault entry must not name an"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_api_key(entry_id, env_var_name="AWS_REGION")],
                supported_provider_config_kinds=("aws_bedrock",),
            )

    @pytest.mark.asyncio
    async def test_put_rejects_bare_key_without_env_var_name(
        self,
        db_session: AsyncSession,
    ) -> None:
        # Proof A6, illegal shape 2: a bare-key selection without an env var.
        user_id = await _create_user(db_session)
        key = await store.create_agent_api_key(
            db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
        )

        with pytest.raises(ValueError, match="bare key requires an env_var_name"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_typed(key.id)],
                supported_provider_config_kinds=("aws_bedrock",),
            )

    @pytest.mark.asyncio
    async def test_put_rejects_revoked_typed_entry(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        entry_id = await _bedrock_entry(db_session, user_id)
        await store.revoke_agent_api_key(db_session, user_id=user_id, api_key_id=entry_id)

        with pytest.raises(
            store.AgentApiKeyNotUsableError,
            match="api_key_id must reference an active key owned by the user",
        ):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_typed(entry_id)],
                supported_provider_config_kinds=("aws_bedrock",),
            )

    @pytest.mark.asyncio
    async def test_two_typed_entries_compose_for_a_multi_source_harness(
        self,
        db_session: AsyncSession,
    ) -> None:
        # Typed rows are keyed by their vault entry (env_var_name is None for
        # all of them), so a multi-source harness can hold more than one.
        user_id = await _create_user(db_session)
        bedrock_id = await _bedrock_entry(db_session, user_id)
        azure = await store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Personal Azure",
            kind="azure_openai",
            value={"endpoint": "https://my-res.openai.azure.com", "apiKey": "azure-key-abcd"},
        )

        rows = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            sources=[_typed(bedrock_id), _typed(azure.id)],
            supported_provider_config_kinds=("aws_bedrock", "azure_openai"),
        )
        typed_ids = {r.api_key_id for r in rows if r.source_kind == "api_key"}
        assert typed_ids == {bedrock_id, azure.id}

        # And referencing the SAME typed entry twice is still a duplicate.
        with pytest.raises(ValueError, match="Duplicate selection source"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="opencode",
                surface="cloud",
                sources=[_typed(bedrock_id), _typed(bedrock_id)],
                supported_provider_config_kinds=("aws_bedrock", "azure_openai"),
            )
