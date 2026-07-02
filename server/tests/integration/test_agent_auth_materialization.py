"""Integration tests: agent-auth changes schedule cloud sandbox materialization.

The sandbox side is covered by unit tests (mocked ``sandbox_io``); here we
prove the service-layer wiring — cloud route-selection upserts/clears and key
revocation invoke the materialization scheduler for the affected user, while
local-surface changes do not.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.materialization.materialize import agent_auth
from tests.integration.test_agent_gateway_api import _authed_user, _create_key


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
    async def test_cloud_selection_upsert_and_clear_trigger_scheduler(
        self,
        client: AsyncClient,
        scheduled: list[uuid.UUID],
    ) -> None:
        user_id, headers = await _authed_user(client)

        upserted = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "gateway"},
        )
        assert upserted.status_code == 200, upserted.text
        assert scheduled == [uuid.UUID(user_id)]

        cleared = await client.delete(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
        )
        assert cleared.status_code == 204
        assert scheduled == [uuid.UUID(user_id)] * 2

    @pytest.mark.asyncio
    async def test_local_selection_changes_do_not_trigger_scheduler(
        self,
        client: AsyncClient,
        scheduled: list[uuid.UUID],
    ) -> None:
        _, headers = await _authed_user(client)

        upserted = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/local",
            headers=headers,
            json={"route": "native"},
        )
        assert upserted.status_code == 200, upserted.text
        cleared = await client.delete(
            "/v1/cloud/agent-gateway/route-selections/claude/local",
            headers=headers,
        )
        assert cleared.status_code == 204
        assert scheduled == []

    @pytest.mark.asyncio
    async def test_api_key_revoke_triggers_scheduler(
        self,
        client: AsyncClient,
        scheduled: list[uuid.UUID],
    ) -> None:
        user_id, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        revoked = await client.delete(
            f"/v1/cloud/agent-gateway/api-keys/{created['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200, revoked.text
        assert scheduled == [uuid.UUID(user_id)]


async def _register_user_id(client: AsyncClient) -> uuid.UUID:
    user_id, _ = await _authed_user(client)
    return uuid.UUID(user_id)


class TestBuildAgentAuthStateSyncedGateway:
    """End-to-end: a synced enrollment's cloud gateway selection renders.

    Drives ``build_agent_auth_state`` through ``_load_state_inputs`` against a
    real DB (route-selection rows, enrollment row, encrypted virtual key) rather
    than the pure ``render_agent_auth_state`` unit path, guarding the full load →
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
        # Register the user through the API so the row exists in the shared DB
        # the db_session fixture also reads from.
        user_id = await _register_user_id(client)

        # A cloud gateway selection (materialized) and a local gateway selection
        # (never materialized on the cloud surface): only the cloud one renders.
        await agent_gateway_store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="cloud",
            route="gateway",
        )
        await agent_gateway_store.upsert_route_selection(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            route="gateway",
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
            virtual_key_id="tok-1",
            virtual_key="sk-litellm-vk",
            sync_fingerprint="fp-1",
        )
        await db_session.flush()

        state, fingerprint = await agent_auth.build_agent_auth_state(db_session, user_id)

        assert state is not None
        assert state["selections"] == [
            {
                "harness": "claude",
                "route": "gateway",
                "slot": "primary",
                "base_url": "https://llm.proliferate.ai",
                "key": "sk-litellm-vk",
            }
        ]
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)
