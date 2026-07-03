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
