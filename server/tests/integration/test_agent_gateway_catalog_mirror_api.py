"""Integration tests for the runtime catalog mirror endpoint (P3 contract §4).

Split out from ``test_agent_gateway_catalog_api.py`` to keep that file under
its repo-shape line budget; this endpoint is the runtime-pushed read-model
twin of the user-triggered ``.../refresh`` covered there.
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.store import agent_gateway as store
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
                    display_name="Catalog Mirror Tester",
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
        state_prefix="agent-catalog-mirror",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"agent-catalog-mirror-api-{uuid.uuid4().hex[:8]}@example.com",
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


def _model_ids(payload: dict) -> list[str]:
    return [entry["id"] for entry in payload["models"]]


class TestMirror:
    """The runtime-pushed read-model snapshot (contract §4), not user-triggered."""

    @pytest.mark.asyncio
    async def test_mirror_stores_runtime_mirror_snapshot(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        probed_at = "2026-07-02T10:00:00+00:00"

        response = await client.post(
            f"{CATALOG_PATH}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["claude-sonnet-4-5", "claude-haiku-4-5"]),
                "probedAt": probed_at,
            },
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["source"] == "runtime-mirror"
        assert _model_ids(payload) == ["claude-sonnet-4-5", "claude-haiku-4-5"]
        assert payload["probedAt"] == probed_at

        stored = await store.get_latest_catalog_snapshot(
            db_session,
            harness_kind=HARNESS,
            surface="local",
            route="gateway",
            owner_user_id=uuid.UUID(user_id),
        )
        assert stored is not None
        assert stored.source == "runtime-mirror"
        assert stored.probed_at.isoformat() == probed_at

        # Served by the plain layered GET too — mirror rows are just snapshots.
        get_response = await client.get(
            CATALOG_PATH,
            params={"surface": "local", "route": "gateway"},
            headers=headers,
        )
        assert get_response.json()["source"] == "runtime-mirror"

    @pytest.mark.asyncio
    async def test_mirror_is_owner_scoped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers_a = await _authed_user(client)
        _, headers_b = await _authed_user(client)
        await _seed_snapshot(db_session, models=["seed-model"])

        mirror = await client.post(
            f"{CATALOG_PATH}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["a-only-model"]),
                "probedAt": "2026-07-02T10:00:00+00:00",
            },
            headers=headers_a,
        )
        assert mirror.status_code == 200

        response_b = await client.get(
            CATALOG_PATH,
            params={"surface": "local", "route": "gateway"},
            headers=headers_b,
        )
        assert _model_ids(response_b.json()) == ["seed-model"]

    @pytest.mark.asyncio
    async def test_mirror_replaces_prior_active_snapshot(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        for models in (["a"], ["b", "c"]):
            response = await client.post(
                f"{CATALOG_PATH}/mirror",
                json={
                    "surface": "local",
                    "route": "gateway",
                    "modelsJson": json.dumps(models),
                    "probedAt": "2026-07-02T10:00:00+00:00",
                },
                headers=headers,
            )
            assert response.status_code == 200

        response = await client.get(
            CATALOG_PATH,
            params={"surface": "local", "route": "gateway"},
            headers=headers,
        )
        assert _model_ids(response.json()) == ["b", "c"]

    @pytest.mark.asyncio
    async def test_mirror_requires_probed_at(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            f"{CATALOG_PATH}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["m"]),
            },
            headers=headers,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_mirror_rejects_invalid_probed_at(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            f"{CATALOG_PATH}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["m"]),
                "probedAt": "not-a-timestamp",
            },
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_catalog_mirror"

    @pytest.mark.asyncio
    async def test_mirror_rejects_invalid_models_payload(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        for bad in ("not-json", json.dumps({"id": "x"}), json.dumps([{"name": "no-id"}])):
            response = await client.post(
                f"{CATALOG_PATH}/mirror",
                json={
                    "surface": "local",
                    "route": "gateway",
                    "modelsJson": bad,
                    "probedAt": "2026-07-02T10:00:00+00:00",
                },
                headers=headers,
            )
            assert response.status_code == 400
            assert response.json()["detail"]["code"] == "invalid_agent_catalog_models"

    @pytest.mark.asyncio
    async def test_mirror_rejects_overlong_harness_kind(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        long_harness = "x" * 65
        response = await client.post(
            f"/v1/cloud/agent-gateway/catalog/{long_harness}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["m"]),
                "probedAt": "2026-07-02T10:00:00+00:00",
            },
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_harness_kind"

    @pytest.mark.asyncio
    async def test_mirror_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.post(
            f"{CATALOG_PATH}/mirror",
            json={
                "surface": "local",
                "route": "gateway",
                "modelsJson": json.dumps(["m"]),
                "probedAt": "2026-07-02T10:00:00+00:00",
            },
        )
        assert response.status_code == 401
