"""Integration tests for the layered model-snapshot read (B4 re-key).

Tier 2 (real postgres, real routing, no external services). Covers the read-time
shipped fallback, the soft-versioning scope, and override layering. The Worker
ingest path has its own suite in ``test_agent_models_ingest_api.py``.
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import agent_gateway as store
from proliferate.server.cloud.agent_models.snapshots import shipped_models_for_context
from tests.helpers.agent_models import (
    CONTEXT,
    HARNESS,
    MODELS_PATH,
    authed_user,
    model_ids,
    store_snapshot,
)


class TestShippedFallback:
    """Read-time seed: no row → shipped catalog; row present → snapshot wins."""

    @pytest.mark.asyncio
    async def test_no_snapshot_serves_shipped_catalog_models(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await authed_user(client)
        response = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        payload = response.json()

        expected = [model["id"] for model in shipped_models_for_context(HARNESS, CONTEXT)]
        assert expected, "the shipped catalog must declare claude/gateway models"
        assert model_ids(payload) == expected
        assert payload["origin"] == "catalog"
        assert payload["snapshotId"] is None
        assert payload["probedAt"] is None
        assert payload["modes"], "modes fall back to the catalog too"

    @pytest.mark.asyncio
    async def test_shipped_fallback_is_scoped_to_the_auth_context(
        self,
        client: AsyncClient,
    ) -> None:
        """The seed is per context, not the harness's whole model list.

        The catalog's ``availability.anyOf`` names which contexts observed a
        model, so a gateway read must not leak the anthropic-api-only models.
        """
        _, headers = await authed_user(client)
        gateway = await client.get(
            MODELS_PATH,
            params={"authContextId": "gateway"},
            headers=headers,
        )
        api_key = await client.get(
            MODELS_PATH,
            params={"authContextId": "anthropic-api"},
            headers=headers,
        )
        assert set(model_ids(gateway.json())) != set(model_ids(api_key.json()))

    @pytest.mark.asyncio
    async def test_unknown_context_serves_nothing_rather_than_everything(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await authed_user(client)
        response = await client.get(
            MODELS_PATH,
            params={"authContextId": "not-a-context"},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["models"] == []
        assert response.json()["origin"] == "catalog"

    @pytest.mark.asyncio
    async def test_snapshot_wins_over_the_shipped_catalog(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["observed-only-model"],
        )
        response = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        payload = response.json()
        assert model_ids(payload) == ["observed-only-model"]
        assert payload["origin"] == "snapshot"
        assert payload["snapshotId"] is not None
        assert payload["probedAt"] is not None

    @pytest.mark.asyncio
    async def test_malformed_stored_row_falls_back_instead_of_500ing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        await store.create_model_snapshot(
            db_session,
            harness_kind=HARNESS,
            auth_context_id=CONTEXT,
            owner_user_id=uuid.UUID(user_id),
            snapshot_json="{ not-an-entry",
            probed_at=None,
        )
        await db_session.commit()

        response = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.json()
        # Better than the pre-B4 empty list: the seed tier fills the absence.
        assert payload["origin"] == "catalog"
        assert model_ids(payload) == [
            model["id"] for model in shipped_models_for_context(HARNESS, CONTEXT)
        ]

    @pytest.mark.asyncio
    async def test_snapshots_are_owner_scoped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_a, _ = await authed_user(client)
        _, headers_b = await authed_user(client)
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_a),
            models=["a-only-model"],
        )
        response_b = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers_b,
        )
        assert "a-only-model" not in model_ids(response_b.json())
        assert response_b.json()["origin"] == "catalog"

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get(MODELS_PATH, params={"authContextId": CONTEXT})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_auth_context_id_is_required(self, client: AsyncClient) -> None:
        _, headers = await authed_user(client)
        response = await client.get(MODELS_PATH, headers=headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_overlong_ids_are_4xx_not_500(self, client: AsyncClient) -> None:
        _, headers = await authed_user(client)
        long_harness = await client.get(
            f"/v1/cloud/agent-models/{'x' * 65}",
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert long_harness.status_code == 400
        assert long_harness.json()["detail"]["code"] == "invalid_agent_harness_kind"

        long_context = await client.get(
            MODELS_PATH,
            params={"authContextId": "x" * 65},
            headers=headers,
        )
        assert long_context.status_code == 400
        assert long_context.json()["detail"]["code"] == "invalid_agent_auth_context_id"


class TestSoftVersioningScope:
    """The new scope is (harness_kind, auth_context_id, owner_user_id)."""

    @pytest.mark.asyncio
    async def test_auth_context_is_part_of_the_scope(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Two contexts for one harness coexist; neither write retires the other."""
        user_id, headers = await authed_user(client)
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["gateway-model"],
            auth_context_id="gateway",
        )
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["api-model"],
            auth_context_id="anthropic-api",
        )

        gateway = await client.get(
            MODELS_PATH,
            params={"authContextId": "gateway"},
            headers=headers,
        )
        api = await client.get(
            MODELS_PATH,
            params={"authContextId": "anthropic-api"},
            headers=headers,
        )
        assert model_ids(gateway.json()) == ["gateway-model"]
        assert model_ids(api.json()) == ["api-model"]

    @pytest.mark.asyncio
    async def test_harness_is_part_of_the_scope(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["claude-observed"],
        )
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["codex-observed"],
            harness_kind="codex",
        )

        claude = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        codex = await client.get(
            "/v1/cloud/agent-models/codex",
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert model_ids(claude.json()) == ["claude-observed"]
        assert model_ids(codex.json()) == ["codex-observed"]

    @pytest.mark.asyncio
    async def test_store_write_retires_the_prior_active_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        for models in (["a"], ["b"], ["c"]):
            await store_snapshot(
                db_session,
                owner_user_id=uuid.UUID(user_id),
                models=models,
            )
        response = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert model_ids(response.json()) == ["c"]


class TestOverrideLayering:
    @pytest.mark.asyncio
    async def test_override_layers_over_snapshot_and_over_the_seed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await authed_user(client)
        patch = {
            "remove": ["drop"],
            "update": {"keep": {"displayName": "Kept"}},
            "add": [{"id": "extra"}],
        }
        put = await client.put(
            f"{MODELS_PATH}/override",
            json={"patchJson": json.dumps(patch)},
            headers=headers,
        )
        assert put.status_code == 200
        assert put.json()["harnessKind"] == HARNESS

        # Over the read-time seed: the patch's add still shows with no snapshot.
        seeded = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert seeded.json()["origin"] == "catalog"
        assert seeded.json()["overrideApplied"] is True
        assert "extra" in model_ids(seeded.json())

        # Over a snapshot: the override survives the write that replaced the base.
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["keep", "drop"],
        )
        layered = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        payload = layered.json()
        assert payload["origin"] == "snapshot"
        assert payload["overrideApplied"] is True
        assert model_ids(payload) == ["keep", "extra"]
        assert payload["models"][0]["displayName"] == "Kept"

    @pytest.mark.asyncio
    async def test_override_upsert_replaces_and_delete_removes(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await authed_user(client)
        first = await client.put(
            f"{MODELS_PATH}/override",
            json={"patchJson": json.dumps({"add": ["one"]})},
            headers=headers,
        )
        second = await client.put(
            f"{MODELS_PATH}/override",
            json={"patchJson": json.dumps({"add": ["two"]})},
            headers=headers,
        )
        assert first.json()["id"] == second.json()["id"]

        response = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert "two" in model_ids(response.json())
        assert "one" not in model_ids(response.json())

        delete = await client.delete(f"{MODELS_PATH}/override", headers=headers)
        assert delete.status_code == 204
        after = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers,
        )
        assert after.json()["overrideApplied"] is False

        missing = await client.delete(f"{MODELS_PATH}/override", headers=headers)
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "agent_catalog_override_not_found"

    @pytest.mark.asyncio
    async def test_overrides_are_owner_scoped(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers_a = await authed_user(client)
        _, headers_b = await authed_user(client)
        put = await client.put(
            f"{MODELS_PATH}/override",
            json={"patchJson": json.dumps({"add": ["a-added"]})},
            headers=headers_a,
        )
        assert put.status_code == 200

        response_b = await client.get(
            MODELS_PATH,
            params={"authContextId": CONTEXT},
            headers=headers_b,
        )
        assert response_b.json()["overrideApplied"] is False
        assert "a-added" not in model_ids(response_b.json())

    @pytest.mark.asyncio
    async def test_invalid_patch_rejected(self, client: AsyncClient) -> None:
        _, headers = await authed_user(client)
        for bad_patch in ("not-json", json.dumps([1]), json.dumps({"nuke": True})):
            response = await client.put(
                f"{MODELS_PATH}/override",
                json={"patchJson": bad_patch},
                headers=headers,
            )
            assert response.status_code == 400
            assert response.json()["detail"]["code"] == "invalid_agent_catalog_override"


class TestDeletedServerProber:
    """``_probe_gateway_models`` is gone; the server never generates snapshots."""

    def test_the_old_catalog_service_module_is_deleted(self) -> None:
        with pytest.raises(ModuleNotFoundError):
            __import__("proliferate.server.cloud.agent_gateway.catalog")

    def test_no_server_module_probes_the_gateway_for_models(self) -> None:
        import pathlib

        import proliferate

        package_root = pathlib.Path(proliferate.__file__ or "").parent
        offenders = [
            path.as_posix()
            for path in package_root.rglob("*.py")
            if "_probe_gateway_models" in path.read_text()
        ]
        assert offenders == []

    def test_snapshot_ingest_never_reaches_litellm(self) -> None:
        """The ingest module must not import the gateway client at all.

        The prober's deletion is only real if the ingest path cannot reach
        LiteLLM: an import here would be the seam growing back.
        """
        import pathlib

        from proliferate.server.cloud.agent_models import snapshots

        source = pathlib.Path(snapshots.__file__ or "").read_text()
        assert "litellm" not in source

    @pytest.mark.asyncio
    async def test_the_old_catalog_routes_are_gone(self, client: AsyncClient) -> None:
        _, headers = await authed_user(client)
        for path, method in (
            (f"/v1/cloud/agent-gateway/catalog/{HARNESS}", "get"),
            (f"/v1/cloud/agent-gateway/catalog/{HARNESS}/refresh", "post"),
            (f"/v1/cloud/agent-gateway/catalog/{HARNESS}/mirror", "post"),
        ):
            response = await getattr(client, method)(path, headers=headers)
            assert response.status_code == 404, f"{method} {path}"

    def test_the_mirror_wire_model_is_gone(self) -> None:
        """No second write shape survives the collapse to one ingest route."""
        from proliferate.server.cloud.agent_gateway import models as gateway_models

        assert not hasattr(gateway_models, "AgentGatewayCatalogMirrorRequest")
        assert not hasattr(gateway_models, "AgentGatewayCatalogRefreshRequest")
        assert not hasattr(gateway_models, "AgentGatewayCatalogResponse")
