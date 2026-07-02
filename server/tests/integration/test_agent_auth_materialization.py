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

from proliferate.server.cloud.materialization import service as materialization_service
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
