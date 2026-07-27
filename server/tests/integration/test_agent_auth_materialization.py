"""Integration tests: agent-auth changes schedule cloud sandbox materialization.

The sandbox side is covered by unit tests (mocked ``sandbox_io``); here we prove
the service-layer wiring — cloud selection writes invoke the materialization
scheduler for the affected user, while local-surface writes do not — plus the
full load → render chain of ``build_agent_auth_state`` against a real DB.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.agent_gateway import AgentAuthSelection
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.materialization.materialize import agent_auth
from tests.integration.test_agent_gateway_api import _authed_user, _put_selections


@pytest.fixture
def scheduled(monkeypatch: pytest.MonkeyPatch) -> list[uuid.UUID]:
    calls: list[uuid.UUID] = []

    async def fake_schedule(db: object, *, user_id: uuid.UUID) -> None:
        calls.append(user_id)

    monkeypatch.setattr(
        materialization_service,
        "schedule_materialize_agent_auth",
        fake_schedule,
    )
    return calls


class TestAgentAuthMaterializationTriggers:
    @pytest.mark.asyncio
    async def test_cloud_selection_put_and_clear_trigger_scheduler(
        self,
        client: AsyncClient,
        scheduled: list[uuid.UUID],
    ) -> None:
        user_id, headers = await _authed_user(client)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="cloud",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert put.status_code == 200, put.text
        assert scheduled == [uuid.UUID(user_id)]

        # A full-desired-state clear (empty sources) is still a cloud write.
        cleared = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="cloud",
            sources=[],
        )
        assert cleared.status_code == 200, cleared.text
        assert scheduled == [uuid.UUID(user_id)] * 2

    @pytest.mark.asyncio
    async def test_local_selection_changes_do_not_trigger_scheduler(
        self,
        client: AsyncClient,
        scheduled: list[uuid.UUID],
    ) -> None:
        _, headers = await _authed_user(client)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert put.status_code == 200, put.text
        cleared = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[],
        )
        assert cleared.status_code == 200, cleared.text
        assert scheduled == []


async def _register_user_id(client: AsyncClient) -> uuid.UUID:
    user_id, _ = await _authed_user(client)
    return uuid.UUID(user_id)


class TestBuildAgentAuthStateSyncedGateway:
    """End-to-end: a synced enrollment's cloud gateway selection renders v2.

    Drives ``build_agent_auth_state`` through ``_load_state_inputs`` against a
    real DB (selection rows, enrollment row, encrypted virtual key) rather than
    the pure ``render_agent_auth_state`` unit path, guarding the full load →
    render chain that materializes the state file for AnyHarness.
    """

    @pytest.mark.asyncio
    async def test_synced_gateway_selection_renders_with_base_url_and_vkey(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
        user_id = await _register_user_id(client)

        # A cloud gateway selection (materialized) and a local gateway selection
        # (never materialized on the cloud surface): only the cloud one renders.
        await agent_gateway_store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="cloud",
            sources=[DesiredAuthSource(source_kind="gateway")],
        )
        await agent_gateway_store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[DesiredAuthSource(source_kind="gateway")],
        )

        subject = await ensure_personal_billing_subject(db_session, user_id)
        enrollment = await agent_gateway_store.ensure_enrollment_row(
            db_session,
            subject_kind="user",
            billing_subject_id=subject.id,
            user_id=user_id,
        )
        await agent_gateway_store.mark_enrollment_synced(
            db_session,
            enrollment_id=enrollment.id,
            litellm_team_id="team-1",
            litellm_user_id=f"user-{user_id}",
            virtual_key_id=None,
            virtual_key=None,
            sync_fingerprint="fp-1",
        )
        # Post-B2/B3: the renderer resolves the harness's own per-harness
        # child key (model-gateway.md §Account model), not a key on the
        # parent enrollment row.
        await agent_gateway_store.upsert_enrollment_key(
            db_session,
            enrollment_id=enrollment.id,
            harness_kind="claude",
            virtual_key_id="tok-1",
            virtual_key="sk-litellm-vk",
            sync_fingerprint="fp-1",
        )
        await db_session.flush()

        state, fingerprint = await agent_auth.build_agent_auth_state(db_session, user_id)

        assert state["version"] == 2
        assert state["harnesses"] == [
            {
                "harness_kind": "claude",
                "sources": [
                    {
                        "kind": "gateway",
                        "base_url": "https://llm.proliferate.ai",
                        "key": "sk-litellm-vk",
                    }
                ],
            }
        ]
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    @pytest.mark.asyncio
    async def test_each_gateway_harness_renders_its_own_child_key(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Two gateway harnesses → two distinct keys through the real loader.

        The unit suite covers the renderer's map lookup; this drives
        ``_load_state_inputs`` against real child-key rows, so a loader that
        fanned one key out to every harness (or looked up the wrong harness's
        row) fails here.
        """
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
        user_id = await _register_user_id(client)
        for harness_kind in ("claude", "codex"):
            await agent_gateway_store.put_auth_selections(
                db_session,
                user_id=user_id,
                harness_kind=harness_kind,
                surface="cloud",
                sources=[DesiredAuthSource(source_kind="gateway")],
            )

        subject = await ensure_personal_billing_subject(db_session, user_id)
        enrollment = await agent_gateway_store.ensure_enrollment_row(
            db_session,
            subject_kind="user",
            billing_subject_id=subject.id,
            user_id=user_id,
        )
        await agent_gateway_store.mark_enrollment_synced(
            db_session,
            enrollment_id=enrollment.id,
            litellm_team_id="team-1",
            litellm_user_id=f"user-{user_id}",
            virtual_key_id=None,
            virtual_key=None,
            sync_fingerprint="fp-set",
        )
        for harness_kind in ("claude", "codex"):
            await agent_gateway_store.upsert_enrollment_key(
                db_session,
                enrollment_id=enrollment.id,
                harness_kind=harness_kind,
                virtual_key_id=f"tok-{harness_kind}",
                virtual_key=f"sk-litellm-{harness_kind}",
                sync_fingerprint=f"fp-{harness_kind}",
            )
        await db_session.flush()

        state, _ = await agent_auth.build_agent_auth_state(db_session, user_id)

        assert state["harnesses"] == [
            {
                "harness_kind": "claude",
                "sources": [
                    {
                        "kind": "gateway",
                        "base_url": "https://llm.proliferate.ai",
                        "key": "sk-litellm-claude",
                    }
                ],
            },
            {
                "harness_kind": "codex",
                "sources": [
                    {
                        "kind": "gateway",
                        "base_url": "https://llm.proliferate.ai",
                        "key": "sk-litellm-codex",
                    }
                ],
            },
        ]


class TestBuildAgentAuthStateTypedProviderConfig:
    """End-to-end: a selection referencing a typed vault entry, through the
    real ``_load_state_inputs`` loader (review finding 1).

    The unit suite (``TestRenderProviderConfigSource``) hand-builds
    ``AgentAuthStateInputs`` and never exercises the loader's typed-vault
    fallback fetch in ``_load_state_inputs``
    (agent_auth.py:479-488) — the branch from the bare
    ``get_agent_api_key_decrypted`` miss to
    ``get_agent_provider_config_decrypted``, and the ``record.kind`` read that
    feeds ``provider_config_values``. Deleting that whole fallback block, or
    reading a nonexistent attribute instead of ``record.kind``, is invisible
    to every existing test.

    The selection WRITE path (``put_auth_selections`` /
    ``_assert_keys_usable``) structurally rejects a typed-entry reference
    (``test_put_rejects_typed_provider_config_as_api_key_source``, D1) — so a
    real row referencing one can only exist via a direct model insert, which
    is exactly what a stale/pre-D1 row or a future relaxed write path would
    also produce. This drives ``build_agent_auth_state`` against that row the
    same way materialization would.
    """

    @pytest.mark.asyncio
    async def test_typed_vault_selection_renders_translated_env_through_the_loader(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id = await _register_user_id(client)
        provider_config = await agent_gateway_store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Personal Bedrock",
            kind="aws_bedrock",
            value={"region": "us-east-1", "bearerToken": "bedrock-tok-loader"},
        )
        # Direct insert: the write path (put_auth_selections) rejects a typed
        # api_key_id at _assert_keys_usable, so this is the only way a
        # selection referencing a typed vault entry can exist today. The DB
        # CHECK (ck_agent_auth_selection_api_key_shape) currently requires
        # env_var_name IS NOT NULL for every api_key row regardless of vault
        # kind — the schema does not yet encode "a typed entry names no
        # env_var_name" (that gap is itself part of the spec's narrowed
        # write-path bullet); a placeholder value satisfies the constraint
        # without the renderer ever reading it (_render_provider_config_source
        # only reads api_key_id, never env_var_name).
        db_session.add(
            AgentAuthSelection(
                user_id=user_id,
                harness_kind="opencode",
                surface="cloud",
                source_kind="api_key",
                api_key_id=provider_config.id,
                env_var_name="UNUSED_FOR_TYPED_ENTRY",
                enabled=True,
            )
        )
        await db_session.flush()

        state, fingerprint = await agent_auth.build_agent_auth_state(db_session, user_id)

        assert state["harnesses"] == [
            {
                "harness_kind": "opencode",
                "sources": [
                    {
                        "kind": "provider_config",
                        "config_kind": "aws_bedrock",
                        "env": {
                            "AWS_BEARER_TOKEN_BEDROCK": "bedrock-tok-loader",
                            "AWS_REGION": "us-east-1",
                        },
                    }
                ],
            }
        ]
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    @pytest.mark.asyncio
    async def test_revoked_typed_vault_entry_drops_the_source_through_the_loader(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        # Brief §6's "revoked/vanished typed vault entry drops the source"
        # loader case: get_agent_provider_config_decrypted scopes to
        # status='active', so a revoked row misses the same way a deleted
        # one would, and _load_state_inputs must drop the source (never
        # raise) rather than surface a KeyError from the render step.
        user_id = await _register_user_id(client)
        provider_config = await agent_gateway_store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Revoked Bedrock",
            kind="aws_bedrock",
            value={"region": "us-east-1", "bearerToken": "bedrock-tok-revoked"},
        )
        db_session.add(
            AgentAuthSelection(
                user_id=user_id,
                harness_kind="opencode",
                surface="cloud",
                source_kind="api_key",
                api_key_id=provider_config.id,
                env_var_name="UNUSED_FOR_TYPED_ENTRY",
                enabled=True,
            )
        )
        await db_session.flush()
        await agent_gateway_store.revoke_agent_api_key(
            db_session, user_id=user_id, api_key_id=provider_config.id
        )
        await db_session.flush()

        state, _ = await agent_auth.build_agent_auth_state(db_session, user_id)

        assert state["harnesses"] == [], (
            "a revoked typed vault entry must drop the source (and thus the "
            "whole harness, on this branch's omit-not-empty semantics), not "
            "raise or leak the last-known env values"
        )
