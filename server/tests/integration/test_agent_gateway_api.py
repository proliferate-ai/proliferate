"""Integration tests for the agent gateway auth APIs (key pool, selections)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud.agent_gateway import AgentApiKey
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from tests.helpers.desktop_auth import mint_desktop_token_payload

SECRET = "sk-ant-api03-super-secret-payload-abc4"


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Gateway Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="agent-gateway",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"agent-gateway-api-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


def _assert_no_secret(response: Response) -> None:
    assert SECRET not in response.text
    for key in _iter_keys(response.json()):
        for fragment in ("secret", "payload", "ciphertext"):
            assert fragment not in key.lower(), f"response leaks field {key}"


def _iter_keys(value: object) -> list[str]:
    keys: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            keys.append(str(key))
            keys.extend(_iter_keys(child))
    elif isinstance(value, list):
        for child in value:
            keys.extend(_iter_keys(child))
    return keys


async def _create_key(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    provider: str = "anthropic",
    secret: str = SECRET,
) -> dict[str, object]:
    response = await client.post(
        "/v1/cloud/agent-gateway/api-keys",
        headers=headers,
        json={"provider": provider, "displayName": "Work key", "secret": secret},
    )
    assert response.status_code == 200, response.text
    _assert_no_secret(response)
    return response.json()


class TestAgentApiKeys:
    @pytest.mark.asyncio
    async def test_create_list_revoke_happy_path(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)

        created = await _create_key(client, headers)
        assert created["provider"] == "anthropic"
        assert created["displayName"] == "Work key"
        assert created["redactedHint"] == "sk-...abc4"
        assert created["status"] == "active"

        listed = await client.get("/v1/cloud/agent-gateway/api-keys", headers=headers)
        assert listed.status_code == 200
        _assert_no_secret(listed)
        keys = listed.json()["keys"]
        assert [key["id"] for key in keys] == [created["id"]]

        revoked = await client.delete(
            f"/v1/cloud/agent-gateway/api-keys/{created['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200
        _assert_no_secret(revoked)
        assert revoked.json()["status"] == "revoked"

        listed_after = await client.get("/v1/cloud/agent-gateway/api-keys", headers=headers)
        assert listed_after.json()["keys"] == []

        # Ciphertext lives in the DB; the raw secret never does.
        row = (
            await db_session.execute(
                select(AgentApiKey).where(AgentApiKey.id == uuid.UUID(str(created["id"])))
            )
        ).scalar_one()
        assert row.payload_ciphertext != SECRET
        assert SECRET not in row.payload_ciphertext

    @pytest.mark.asyncio
    async def test_create_rejects_unknown_provider_and_empty_secret(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)

        bad_provider = await client.post(
            "/v1/cloud/agent-gateway/api-keys",
            headers=headers,
            json={"provider": "bedrock", "displayName": "Key", "secret": SECRET},
        )
        assert bad_provider.status_code == 400
        assert bad_provider.json()["detail"]["code"] == "invalid_agent_api_key_provider"

        empty_secret = await client.post(
            "/v1/cloud/agent-gateway/api-keys",
            headers=headers,
            json={"provider": "anthropic", "displayName": "Key", "secret": "   "},
        )
        assert empty_secret.status_code == 400
        assert empty_secret.json()["detail"]["code"] == "invalid_agent_api_key_secret"

    @pytest.mark.asyncio
    async def test_create_validation_error_never_echoes_secret(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)

        # A single unrelated invalid field (missing displayName) must not cause
        # FastAPI's 422 handler to reflect the plaintext secret back to the caller.
        missing_field = await client.post(
            "/v1/cloud/agent-gateway/api-keys",
            headers=headers,
            json={"provider": "anthropic", "secret": SECRET},
        )
        assert missing_field.status_code == 422, missing_field.text
        assert SECRET not in missing_field.text

        # Same guarantee when the secret field itself is the wrong type.
        wrong_type = await client.post(
            "/v1/cloud/agent-gateway/api-keys",
            headers=headers,
            json={"provider": "anthropic", "displayName": "Key", "secret": [SECRET]},
        )
        assert wrong_type.status_code == 422, wrong_type.text
        assert SECRET not in wrong_type.text

        # And when the whole body is a malformed shape carrying the secret.
        malformed_body = await client.post(
            "/v1/cloud/agent-gateway/api-keys",
            headers=headers,
            json=[SECRET],
        )
        assert malformed_body.status_code == 422, malformed_body.text
        assert SECRET not in malformed_body.text

    @pytest.mark.asyncio
    async def test_revoke_foreign_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await client.delete(
            f"/v1/cloud/agent-gateway/api-keys/{created['id']}",
            headers=other_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/v1/cloud/agent-gateway/api-keys")
        assert response.status_code == 401


class TestAgentRouteSelections:
    @pytest.mark.asyncio
    async def test_upsert_list_clear_happy_path(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        upserted = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "api_key", "apiKeyId": created["id"]},
        )
        assert upserted.status_code == 200, upserted.text
        payload = upserted.json()
        assert payload["harnessKind"] == "claude"
        assert payload["surface"] == "cloud"
        assert payload["slot"] == "primary"
        assert payload["route"] == "api_key"
        assert payload["apiKeyId"] == created["id"]
        assert payload["revision"] == 1

        changed = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "gateway"},
        )
        assert changed.status_code == 200
        assert changed.json()["revision"] == 2

        listed = await client.get(
            "/v1/cloud/agent-gateway/route-selections",
            headers=headers,
        )
        assert listed.status_code == 200
        selections = listed.json()["selections"]
        assert len(selections) == 1
        assert selections[0]["route"] == "gateway"

        cleared = await client.delete(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
        )
        assert cleared.status_code == 204

        empty = await client.get(
            "/v1/cloud/agent-gateway/route-selections",
            headers=headers,
        )
        assert empty.json()["selections"] == []

        missing = await client.delete(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
        )
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "agent_route_selection_not_found"

    @pytest.mark.asyncio
    async def test_cloud_native_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "native"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_route_selection"

    @pytest.mark.asyncio
    async def test_api_key_route_without_key_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "api_key"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_route_selection"

    @pytest.mark.asyncio
    async def test_foreign_api_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=other_headers,
            json={"route": "api_key", "apiKeyId": created["id"]},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"

    @pytest.mark.asyncio
    async def test_unknown_harness_kind_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)

        unknown = await client.put(
            "/v1/cloud/agent-gateway/route-selections/bogus/cloud",
            headers=headers,
            json={"route": "gateway"},
        )
        assert unknown.status_code == 400
        assert unknown.json()["detail"]["code"] == "invalid_agent_route_selection"

        # An over-length harness must be rejected up front rather than tripping a
        # String(64) truncation error (500) and persisting junk.
        overlong = await client.put(
            f"/v1/cloud/agent-gateway/route-selections/{'x' * 200}/cloud",
            headers=headers,
            json={"route": "gateway"},
        )
        assert overlong.status_code == 400
        assert overlong.json()["detail"]["code"] == "invalid_agent_route_selection"

    @pytest.mark.asyncio
    async def test_opencode_slots_compose_and_clear_independently(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        gateway = await client.put(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=headers,
            json={"route": "gateway", "slot": "gateway"},
        )
        assert gateway.status_code == 200, gateway.text
        assert gateway.json()["slot"] == "gateway"

        direct = await client.put(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=headers,
            json={"route": "api_key", "apiKeyId": created["id"], "slot": "anthropic"},
        )
        assert direct.status_code == 200, direct.text
        assert direct.json()["slot"] == "anthropic"

        listed = await client.get(
            "/v1/cloud/agent-gateway/route-selections",
            headers=headers,
        )
        assert [entry["slot"] for entry in listed.json()["selections"]] == [
            "anthropic",
            "gateway",
        ]

        cleared = await client.delete(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=headers,
            params={"slot": "anthropic"},
        )
        assert cleared.status_code == 204
        remaining = await client.get(
            "/v1/cloud/agent-gateway/route-selections",
            headers=headers,
        )
        assert [entry["slot"] for entry in remaining.json()["selections"]] == ["gateway"]

    @pytest.mark.asyncio
    async def test_slot_validation_errors_are_typed(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)  # anthropic key

        single_source = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/cloud",
            headers=headers,
            json={"route": "gateway", "slot": "gateway"},
        )
        assert single_source.status_code == 400
        assert single_source.json()["detail"]["code"] == "invalid_agent_route_selection"

        default_slot_for_opencode = await client.put(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=headers,
            json={"route": "gateway"},
        )
        assert default_slot_for_opencode.status_code == 400
        assert (
            default_slot_for_opencode.json()["detail"]["code"] == "invalid_agent_route_selection"
        )

        provider_mismatch = await client.put(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=headers,
            json={"route": "api_key", "apiKeyId": created["id"], "slot": "openai"},
        )
        assert provider_mismatch.status_code == 400
        assert provider_mismatch.json()["detail"]["code"] == "invalid_agent_route_selection"

    @pytest.mark.asyncio
    async def test_unknown_surface_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.put(
            "/v1/cloud/agent-gateway/route-selections/claude/orbital",
            headers=headers,
            json={"route": "gateway"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_route_selection"


class TestAgentGatewayCapabilities:
    @pytest.mark.asyncio
    async def test_capabilities_gateway_off(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", False)
        monkeypatch.setattr(settings, "agent_gateway_litellm_public_base_url", "")
        _, headers = await _authed_user(client)

        response = await client.get(
            "/v1/cloud/agent-gateway/capabilities",
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is False
        assert payload["publicBaseUrl"] is None
        assert payload["enrollmentStatus"] == "none"
        # The provider registry rides along so UIs never hardcode metadata.
        providers = {entry["id"]: entry for entry in payload["providers"]}
        assert set(providers) == {"anthropic", "openai", "xai", "google"}
        anthropic = providers["anthropic"]
        assert anthropic["label"] == "Anthropic"
        assert anthropic["envKey"] == "ANTHROPIC_API_KEY"
        assert anthropic["keyUrl"].startswith("https://")
        assert "opencode" in anthropic["harnesses"]
        assert "opencode" in anthropic["recommendedFor"]

    @pytest.mark.asyncio
    async def test_capabilities_gateway_on_with_enrollment(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", True)
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
        user_id, headers = await _authed_user(client)

        subject = await ensure_personal_billing_subject(db_session, uuid.UUID(user_id))
        await store.ensure_enrollment_row(
            db_session,
            subject_kind="user",
            billing_subject_id=subject.id,
            user_id=uuid.UUID(user_id),
        )
        await db_session.commit()

        response = await client.get(
            "/v1/cloud/agent-gateway/capabilities",
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is True
        assert payload["publicBaseUrl"] == "https://llm.proliferate.ai"
        assert payload["enrollmentStatus"] == "pending"
        assert len(payload["providers"]) == 4


class TestAgentGatewayEnrollment:
    @pytest.mark.asyncio
    async def test_enrollment_summary_never_leaks_virtual_key(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        subject = await ensure_personal_billing_subject(db_session, uuid.UUID(user_id))
        enrollment = await store.ensure_enrollment_row(
            db_session,
            subject_kind="user",
            billing_subject_id=subject.id,
            user_id=uuid.UUID(user_id),
        )
        await store.mark_enrollment_synced(
            db_session,
            enrollment_id=enrollment.id,
            litellm_team_id="team-1",
            litellm_user_id=f"user-{user_id}",
            virtual_key_id="token-1",
            virtual_key="sk-litellm-virtual-key-plaintext",
            sync_fingerprint="fp",
        )
        await db_session.commit()

        response = await client.get("/v1/cloud/agent-gateway/enrollment", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["subjectKind"] == "user"
        assert payload["litellmTeamId"] == "team-1"
        assert payload["syncStatus"] == "synced"
        assert "sk-litellm-virtual-key-plaintext" not in response.text
        for key in _iter_keys(payload):
            assert "key" not in key.lower(), f"enrollment response exposes field {key}"

    @pytest.mark.asyncio
    async def test_enrollment_missing_is_404(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.get("/v1/cloud/agent-gateway/enrollment", headers=headers)
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_gateway_enrollment_not_found"
