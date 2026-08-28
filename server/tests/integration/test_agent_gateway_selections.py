"""Focused CRUD coverage for agent auth selections."""

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


def _seat(
    *,
    api_key_id: uuid.UUID | None = None,
    env_var_name: str | None = None,
    enabled: bool = True,
) -> DesiredAuthSource:
    return DesiredAuthSource(
        source_kind="seat",
        api_key_id=api_key_id,
        env_var_name=env_var_name,
        enabled=enabled,
    )


class TestSeatSelectionWriteGate:
    """Seats v1: the cross-table shape law for `seat` rows (spec §2).

    A seat row references an `anthropic_subscription` vault entry or NULL
    (NULL = "use my seat pool"); env_var_name is forbidden — the seat recipe
    owns its env mapping. The referenced-entry kind check spans tables, so it
    lives here in the store write gate, not in SQL.
    """

    @pytest.mark.asyncio
    async def test_put_accepts_the_pool_seat_row(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rows = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_seat()],
        )
        seat_rows = [r for r in rows if r.source_kind == "seat"]
        assert len(seat_rows) == 1
        assert seat_rows[0].api_key_id is None
        assert seat_rows[0].env_var_name is None
        assert seat_rows[0].enabled is True

    @pytest.mark.asyncio
    async def test_put_accepts_a_pin_of_an_active_seat_entry(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        seat = await store.create_agent_seat(
            db_session,
            user_id=user_id,
            title="Max seat · ops@acme.com",
            value="sk-ant-oat01-tokentokentokentokentokentokentokenAA",
        )
        rows = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_seat(api_key_id=seat.id)],
        )
        seat_rows = [r for r in rows if r.source_kind == "seat"]
        assert [r.api_key_id for r in seat_rows] == [seat.id]

    @pytest.mark.asyncio
    async def test_put_rejects_a_seat_pinning_a_bare_key_entry(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        bare = await store.create_agent_api_key(
            db_session, user_id=user_id, title="Bare", value="sk-ant-bare1234"
        )
        with pytest.raises(ValueError, match="must pin an anthropic_subscription"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_seat(api_key_id=bare.id)],
            )

    @pytest.mark.asyncio
    async def test_put_rejects_a_seat_pinning_a_revoked_seat(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        seat = await store.create_agent_seat(
            db_session,
            user_id=user_id,
            title="Max seat 1",
            value="sk-ant-oat01-tokentokentokentokentokentokentokenBB",
        )
        await store.revoke_agent_api_key(db_session, user_id=user_id, api_key_id=seat.id)
        with pytest.raises(selections_store.AgentApiKeyNotUsableError):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_seat(api_key_id=seat.id)],
            )

    @pytest.mark.asyncio
    async def test_put_rejects_an_api_key_row_referencing_a_seat_entry(
        self, db_session: AsyncSession
    ) -> None:
        # The reverse hole: a seat token must never ride a free-form env var.
        user_id = await _create_user(db_session)
        seat = await store.create_agent_seat(
            db_session,
            user_id=user_id,
            title="Max seat 1",
            value="sk-ant-oat01-tokentokentokentokentokentokentokenCC",
        )
        with pytest.raises(ValueError, match="wire a seat row instead"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_api_key(seat.id, env_var_name="CLAUDE_CODE_OAUTH_TOKEN")],
            )

    @pytest.mark.asyncio
    async def test_put_rejects_a_seat_row_naming_an_env_var(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        with pytest.raises(ValueError, match="must not carry an env_var_name"):
            await store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind="claude",
                surface="local",
                sources=[_seat(env_var_name="CLAUDE_CODE_OAUTH_TOKEN")],
            )

    @pytest.mark.asyncio
    async def test_pool_and_pin_are_distinct_rows_and_replace_cleanly(
        self, db_session: AsyncSession
    ) -> None:
        # Seat identity within a scope is the referenced entry: the pool row
        # is (seat, None, None) and a pin is (seat, None, <entry id>), so a
        # full-desired-state swap between them deletes one and inserts the
        # other rather than colliding.
        user_id = await _create_user(db_session)
        seat = await store.create_agent_seat(
            db_session,
            user_id=user_id,
            title="Max seat 1",
            value="sk-ant-oat01-tokentokentokentokentokentokentokenDD",
        )
        first = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_seat()],
        )
        pool_id = next(r.id for r in first if r.source_kind == "seat")
        second = await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[_seat(api_key_id=seat.id)],
        )
        seat_rows = [r for r in second if r.source_kind == "seat"]
        assert [r.api_key_id for r in seat_rows] == [seat.id]
        assert seat_rows[0].id != pool_id
