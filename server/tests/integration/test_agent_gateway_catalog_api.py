"""Integration tests for the agent gateway catalog APIs (layering, refresh, overrides)."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import func, select

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud.agent_gateway import AgentCatalogSnapshot
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.cloud.agent_gateway import catalog as catalog_service
from tests.helpers.desktop_auth import mint_desktop_token_payload

HARNESS = "claude"
CATALOG_PATH = f"/v1/cloud/agent-gateway/catalog/{HARNESS}"


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
                    display_name="Catalog Tester",
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
        state_prefix="agent-catalog",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"agent-catalog-api-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


async def _seed_snapshot(
    db_session: AsyncSession,
    *,
    models: list[str],
    surface: str = "local",
    route: str = "gateway",
    owner_user_id: uuid.UUID | None = None,
    source: str = "seed",
) -> None:
    await store.create_catalog_snapshot(
        db_session,
        harness_kind=HARNESS,
        surface=surface,
        route=route,
        owner_user_id=owner_user_id,
        models_json=json.dumps([{"id": model} for model in models]),
        source=source,
    )
    await db_session.commit()


async def _synced_enrollment(db_session: AsyncSession, user_id: str) -> None:
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
        virtual_key="sk-litellm-virtual-key",
        sync_fingerprint="fp",
    )
    await db_session.commit()


def _model_ids(payload: dict) -> list[str]:
    return [entry["id"] for entry in payload["models"]]


class TestGetCatalog:
    @pytest.mark.asyncio
    async def test_empty_catalog_when_no_snapshot(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["models"] == []
        assert payload["snapshotId"] is None
        assert payload["overrideApplied"] is False

    @pytest.mark.asyncio
    async def test_seed_fallback_and_owner_snapshot_preference(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        await _seed_snapshot(db_session, models=["seed-model"])

        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert response.status_code == 200
        assert _model_ids(response.json()) == ["seed-model"]
        assert response.json()["source"] == "seed"

        await _seed_snapshot(
            db_session,
            models=["owner-model"],
            owner_user_id=uuid.UUID(user_id),
            source="probe",
        )
        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert _model_ids(response.json()) == ["owner-model"]
        assert response.json()["source"] == "probe"

    @pytest.mark.asyncio
    async def test_owner_scoping_isolates_users(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_a, headers_a = await _authed_user(client)
        _, headers_b = await _authed_user(client)
        await _seed_snapshot(db_session, models=["seed-model"])
        await _seed_snapshot(
            db_session,
            models=["a-only-model"],
            owner_user_id=uuid.UUID(user_a),
            source="probe",
        )
        put = await client.put(
            f"{CATALOG_PATH}/override",
            json={"patchJson": json.dumps({"add": ["a-added"]})},
            headers=headers_a,
        )
        assert put.status_code == 200

        response_b = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers_b)
        payload_b = response_b.json()
        assert _model_ids(payload_b) == ["seed-model"]
        assert payload_b["overrideApplied"] is False

    @pytest.mark.asyncio
    async def test_invalid_surface_rejected(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.get(CATALOG_PATH, params={"surface": "sky"}, headers=headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get(CATALOG_PATH, params={"surface": "local"})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_overlong_harness_kind_is_4xx_not_500(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        long_harness = "x" * 65
        response = await client.get(
            f"/v1/cloud/agent-gateway/catalog/{long_harness}",
            params={"surface": "local"},
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_harness_kind"

    @pytest.mark.asyncio
    async def test_get_tolerates_malformed_stored_snapshot(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        # A single corrupt stored row must not 500 the catalog for the scope.
        _, headers = await _authed_user(client)
        await store.create_catalog_snapshot(
            db_session,
            harness_kind=HARNESS,
            surface="local",
            route="gateway",
            owner_user_id=None,
            models_json="{ not-an-array",
            source="seed",
        )
        await db_session.commit()

        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert response.status_code == 200
        assert response.json()["models"] == []


class TestOverrideLayering:
    @pytest.mark.asyncio
    async def test_override_layers_and_survives_refresh(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        await _seed_snapshot(db_session, models=["keep", "drop"], route="native")

        patch = {
            "remove": ["drop"],
            "update": {"keep": {"displayName": "Kept"}},
            "add": [{"id": "extra"}],
        }
        put = await client.put(
            f"{CATALOG_PATH}/override",
            json={"patchJson": json.dumps(patch)},
            headers=headers,
        )
        assert put.status_code == 200
        assert put.json()["harnessKind"] == HARNESS

        response = await client.get(
            CATALOG_PATH,
            params={"surface": "local", "route": "native"},
            headers=headers,
        )
        payload = response.json()
        assert payload["overrideApplied"] is True
        assert _model_ids(payload) == ["keep", "extra"]
        assert payload["models"][0]["displayName"] == "Kept"

        # A refresh replaces the base snapshot; the override keeps applying.
        refresh = await client.post(
            f"{CATALOG_PATH}/refresh",
            json={
                "surface": "local",
                "route": "native",
                "modelsJson": json.dumps(["fresh", "drop", "keep"]),
            },
            headers=headers,
        )
        assert refresh.status_code == 200
        refreshed = refresh.json()
        assert refreshed["source"] == "probe"
        assert _model_ids(refreshed) == ["fresh", "keep", "extra"]
        assert refreshed["overrideApplied"] is True

    @pytest.mark.asyncio
    async def test_override_upsert_replaces_and_delete_removes(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        await _seed_snapshot(db_session, models=["base"])

        first = await client.put(
            f"{CATALOG_PATH}/override",
            json={"patchJson": json.dumps({"add": ["one"]})},
            headers=headers,
        )
        second = await client.put(
            f"{CATALOG_PATH}/override",
            json={"patchJson": json.dumps({"add": ["two"]})},
            headers=headers,
        )
        assert first.json()["id"] == second.json()["id"]

        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert _model_ids(response.json()) == ["base", "two"]

        delete = await client.delete(f"{CATALOG_PATH}/override", headers=headers)
        assert delete.status_code == 204
        response = await client.get(CATALOG_PATH, params={"surface": "local"}, headers=headers)
        assert _model_ids(response.json()) == ["base"]
        assert response.json()["overrideApplied"] is False

        missing = await client.delete(f"{CATALOG_PATH}/override", headers=headers)
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "agent_catalog_override_not_found"

    @pytest.mark.asyncio
    async def test_invalid_patch_rejected(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        for bad_patch in ("not-json", json.dumps([1]), json.dumps({"nuke": True})):
            response = await client.put(
                f"{CATALOG_PATH}/override",
                json={"patchJson": bad_patch},
                headers=headers,
            )
            assert response.status_code == 400
            assert response.json()["detail"]["code"] == "invalid_agent_catalog_override"


class TestRefresh:
    @pytest.mark.asyncio
    async def test_gateway_refresh_probes_litellm(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        user_id, headers = await _authed_user(client)
        await _synced_enrollment(db_session, user_id)

        seen: dict[str, str] = {}

        async def fake_list_models(*, virtual_key: str) -> list[str]:
            seen["virtual_key"] = virtual_key
            return ["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4"]

        monkeypatch.setattr(catalog_service.litellm, "list_models", fake_list_models)

        response = await client.post(
            f"{CATALOG_PATH}/refresh",
            json={"surface": "cloud", "route": "gateway"},
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.json()
        assert seen["virtual_key"] == "sk-litellm-virtual-key"
        assert _model_ids(payload) == [
            "anthropic/claude-haiku-4",
            "anthropic/claude-sonnet-4-5",
        ]
        assert payload["source"] == "probe"
        assert payload["snapshotId"] is not None

        stored = await store.get_latest_catalog_snapshot(
            db_session,
            harness_kind=HARNESS,
            surface="cloud",
            route="gateway",
            owner_user_id=uuid.UUID(user_id),
        )
        assert stored is not None
        assert stored.source == "probe"

    @pytest.mark.asyncio
    async def test_gateway_refresh_without_enrollment_is_409(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            f"{CATALOG_PATH}/refresh",
            json={"surface": "cloud", "route": "gateway"},
            headers=headers,
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "agent_gateway_enrollment_not_ready"

    @pytest.mark.asyncio
    async def test_gateway_refresh_rejects_uploaded_models(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            f"{CATALOG_PATH}/refresh",
            json={
                "surface": "cloud",
                "route": "gateway",
                "modelsJson": json.dumps(["sneaky"]),
            },
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_catalog_refresh"

    @pytest.mark.asyncio
    async def test_refresh_keeps_a_single_active_snapshot_per_scope(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)

        async def active_count() -> int:
            result = await db_session.execute(
                select(func.count())
                .select_from(AgentCatalogSnapshot)
                .where(
                    AgentCatalogSnapshot.harness_kind == HARNESS,
                    AgentCatalogSnapshot.surface == "local",
                    AgentCatalogSnapshot.route == "native",
                    AgentCatalogSnapshot.owner_user_id == uuid.UUID(user_id),
                    AgentCatalogSnapshot.status == "active",
                )
            )
            return int(result.scalar_one())

        for models in (["a", "b"], ["c"], ["d", "e", "f"]):
            refresh = await client.post(
                f"{CATALOG_PATH}/refresh",
                json={
                    "surface": "local",
                    "route": "native",
                    "modelsJson": json.dumps(models),
                },
                headers=headers,
            )
            assert refresh.status_code == 200

        # Three refreshes, but the prior active rows were deactivated: exactly
        # one active snapshot remains and it reflects the latest probe.
        db_session.expire_all()
        assert await active_count() == 1
        response = await client.get(
            CATALOG_PATH,
            params={"surface": "local", "route": "native"},
            headers=headers,
        )
        assert _model_ids(response.json()) == ["d", "e", "f"]

    @pytest.mark.asyncio
    async def test_refresh_rejects_overlong_harness_kind(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        long_harness = "x" * 65
        response = await client.post(
            f"/v1/cloud/agent-gateway/catalog/{long_harness}/refresh",
            json={
                "surface": "local",
                "route": "native",
                "modelsJson": json.dumps(["m"]),
            },
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_harness_kind"

    @pytest.mark.asyncio
    async def test_native_refresh_requires_uploaded_models(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            f"{CATALOG_PATH}/refresh",
            json={"surface": "local", "route": "native"},
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_catalog_refresh"

    @pytest.mark.asyncio
    async def test_native_refresh_rejects_invalid_payload(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        for bad in ("not-json", json.dumps({"id": "x"}), json.dumps([{"name": "no-id"}])):
            response = await client.post(
                f"{CATALOG_PATH}/refresh",
                json={"surface": "local", "route": "native", "modelsJson": bad},
                headers=headers,
            )
            assert response.status_code == 400
            assert response.json()["detail"]["code"] == "invalid_agent_catalog_models"
