"""Integration tests for the agent gateway auth APIs (key vault, selections)."""

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
        for fragment in ("secret", "value", "ciphertext"):
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
    title: str = "Work key",
    value: str = SECRET,
) -> dict[str, object]:
    response = await client.post(
        "/v1/cloud/agent-gateway/keys",
        headers=headers,
        json={"title": title, "value": value},
    )
    assert response.status_code == 200, response.text
    _assert_no_secret(response)
    return response.json()


async def _put_selections(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    harness: str,
    surface: str,
    sources: list[dict[str, object]],
) -> Response:
    return await client.put(
        f"/v1/cloud/agent-gateway/selections/{harness}",
        headers=headers,
        params={"surface": surface},
        json={"sources": sources},
    )


class TestAgentApiKeys:
    @pytest.mark.asyncio
    async def test_create_list_revoke_happy_path(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)

        created = await _create_key(client, headers)
        assert created["title"] == "Work key"
        assert created["redactedHint"] == "sk-...abc4"
        assert created["status"] == "active"

        listed = await client.get("/v1/cloud/agent-gateway/keys", headers=headers)
        assert listed.status_code == 200
        _assert_no_secret(listed)
        keys = listed.json()
        assert [key["id"] for key in keys] == [created["id"]]

        revoked = await client.delete(
            f"/v1/cloud/agent-gateway/keys/{created['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200
        _assert_no_secret(revoked)
        assert revoked.json()["status"] == "revoked"

        listed_after = await client.get("/v1/cloud/agent-gateway/keys", headers=headers)
        assert listed_after.json() == []

        # Ciphertext lives in the DB; the raw value never does.
        row = (
            await db_session.execute(
                select(AgentApiKey).where(AgentApiKey.id == uuid.UUID(str(created["id"])))
            )
        ).scalar_one()
        assert row.value_ciphertext != SECRET
        assert SECRET not in row.value_ciphertext

    @pytest.mark.asyncio
    async def test_create_rejects_empty_title_and_value(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)

        blank_title = await client.post(
            "/v1/cloud/agent-gateway/keys",
            headers=headers,
            json={"title": "   ", "value": SECRET},
        )
        assert blank_title.status_code == 400
        assert blank_title.json()["detail"]["code"] == "invalid_agent_api_key_title"

        empty_value = await client.post(
            "/v1/cloud/agent-gateway/keys",
            headers=headers,
            json={"title": "Key", "value": "   "},
        )
        assert empty_value.status_code == 400
        assert empty_value.json()["detail"]["code"] == "invalid_agent_api_key_value"

    @pytest.mark.asyncio
    async def test_create_validation_error_never_echoes_value(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)

        missing_field = await client.post(
            "/v1/cloud/agent-gateway/keys",
            headers=headers,
            json={"value": SECRET},
        )
        assert missing_field.status_code == 422, missing_field.text
        assert SECRET not in missing_field.text

        wrong_type = await client.post(
            "/v1/cloud/agent-gateway/keys",
            headers=headers,
            json={"title": "Key", "value": [SECRET]},
        )
        assert wrong_type.status_code == 422, wrong_type.text
        assert SECRET not in wrong_type.text

    @pytest.mark.asyncio
    async def test_revoke_foreign_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await client.delete(
            f"/v1/cloud/agent-gateway/keys/{created['id']}",
            headers=other_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"

    @pytest.mark.asyncio
    async def test_revoke_referenced_key_is_409_with_harnesses(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert put.status_code == 200, put.text

        blocked = await client.delete(
            f"/v1/cloud/agent-gateway/keys/{created['id']}",
            headers=headers,
        )
        assert blocked.status_code == 409, blocked.text
        detail = blocked.json()["detail"]
        assert detail["code"] == "agent_api_key_referenced"
        assert detail["harnesses"] == ["claude"]

        # Disabling the referencing row frees the key for revocation.
        await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": False,
                }
            ],
        )
        freed = await client.delete(
            f"/v1/cloud/agent-gateway/keys/{created['id']}",
            headers=headers,
        )
        assert freed.status_code == 200, freed.text

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/v1/cloud/agent-gateway/keys")
        assert response.status_code == 401


class TestAgentAuthSelections:
    @pytest.mark.asyncio
    async def test_put_list_and_full_desired_state_replace(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="opencode",
            surface="local",
            sources=[
                {"sourceKind": "gateway", "enabled": True},
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "providerHint": "anthropic",
                    "enabled": True,
                },
            ],
        )
        assert put.status_code == 200, put.text
        rows = put.json()
        assert {(r["sourceKind"], r["enabled"]) for r in rows} == {
            ("gateway", True),
            ("api_key", True),
        }
        api_row = next(r for r in rows if r["sourceKind"] == "api_key")
        assert api_row["envVarName"] == "ANTHROPIC_API_KEY"
        assert api_row["providerHint"] == "anthropic"
        assert api_row["keyTitle"] == "Work key"

        listed = await client.get(
            "/v1/cloud/agent-gateway/selections",
            headers=headers,
            params={"surface": "local"},
        )
        assert listed.status_code == 200
        assert len(listed.json()) == 2

        # Full desired state: dropping the api_key source deletes just its row.
        replaced = await _put_selections(
            client,
            headers,
            harness="opencode",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert [r["sourceKind"] for r in replaced.json()] == ["gateway"]

    @pytest.mark.asyncio
    async def test_single_source_harness_rejects_two_enabled(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {"sourceKind": "gateway", "enabled": True},
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                },
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_invalid_env_var_name_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "lower_case",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_cursor_rejects_sources(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await _put_selections(
            client,
            headers,
            harness="cursor",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_unknown_harness_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        # A gateway source for a non-gateway-capable harness is rejected by the
        # validator up front (400, not a 500 on the String(64) column).
        response = await _put_selections(
            client,
            headers,
            harness="x" * 200,
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_malformed_api_key_id_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": "not-a-uuid",
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_foreign_api_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await _put_selections(
            client,
            other_headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"


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

        response = await client.get("/v1/cloud/agent-gateway/capabilities", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is False
        assert payload["publicBaseUrl"] is None
        assert payload["enrollmentStatus"] == "none"
        # The provider registry is UI-only now (contract §6): never on the wire.
        assert "providers" not in payload

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

        response = await client.get("/v1/cloud/agent-gateway/capabilities", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is True
        assert payload["publicBaseUrl"] == "https://llm.proliferate.ai"
        assert payload["enrollmentStatus"] == "pending"


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


async def _get_state(client: AsyncClient, headers: dict[str, str], surface: str) -> Response:
    return await client.get(
        "/v1/cloud/agent-gateway/state",
        headers=headers,
        params={"surface": surface},
    )


class TestAgentAuthState:
    @pytest.mark.asyncio
    async def test_empty_state_is_v2_no_harnesses(self, client: AsyncClient) -> None:
        user_id, headers = await _authed_user(client)
        empty = await _get_state(client, headers, "local")
        assert empty.status_code == 200, empty.text
        assert empty.json() == {
            "version": 2,
            "revision": 0,
            "user_id": user_id,
            "harnesses": [],
        }

    @pytest.mark.asyncio
    async def test_seeded_gateway_and_api_key_render_valid_v2(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Contract §8 e2e: a user with one gateway selection + one api_key
        # selection yields a valid v2 document carrying the caller's own keys.
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
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
            virtual_key="sk-litellm-vk",
            sync_fingerprint="fp",
        )
        await db_session.commit()

        created = await _create_key(client, headers)

        gateway = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert gateway.status_code == 200, gateway.text
        keyed = await _put_selections(
            client,
            headers,
            harness="codex",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "OPENAI_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert keyed.status_code == 200, keyed.text

        response = await _get_state(client, headers, "local")
        assert response.status_code == 200, response.text
        doc = response.json()
        assert doc["version"] == 2
        assert doc["user_id"] == user_id
        assert isinstance(doc["revision"], int) and doc["revision"] > 0
        assert doc["harnesses"] == [
            {
                "harness_kind": "claude",
                "sources": [
                    {
                        "kind": "gateway",
                        "base_url": "https://llm.proliferate.ai",
                        "key": "sk-litellm-vk",
                    }
                ],
            },
            {
                "harness_kind": "codex",
                "sources": [
                    {
                        "kind": "api_key",
                        "env_var_name": "OPENAI_API_KEY",
                        "value": SECRET,
                    }
                ],
            },
        ]

        # A different surface with no selections is still a valid empty v2 doc.
        cloud = await _get_state(client, headers, "cloud")
        assert cloud.status_code == 200
        assert cloud.json()["harnesses"] == []

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get(
            "/v1/cloud/agent-gateway/state",
            params={"surface": "local"},
        )
        assert response.status_code == 401
