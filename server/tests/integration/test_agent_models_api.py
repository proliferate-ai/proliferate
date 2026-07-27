"""Integration tests for the layered model-snapshot read (composed re-key, B-3).

Tier 2 (real postgres, real routing, no external services). Covers the read-time
shipped fallback, the (harness, owner) soft-versioning scope, and override
layering. One composed observation per harness: there is no ``authContextId``
parameter anywhere on this surface. The Worker ingest path has its own suite in
``test_agent_models_ingest_api.py``.
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import agent_gateway as store
from proliferate.server.cloud.agent_models.snapshots import shipped_models
from tests.helpers.agent_models import (
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
        response = await client.get(MODELS_PATH, headers=headers)
        assert response.status_code == 200, response.text
        payload = response.json()

        expected = [model["id"] for model in shipped_models(HARNESS)]
        assert expected, "the shipped catalog must declare claude models"
        assert model_ids(payload) == expected
        assert payload["origin"] == "catalog"
        assert payload["snapshotId"] is None
        assert payload["probedAt"] is None
        assert payload["modes"], "modes fall back to the catalog too"

    @pytest.mark.asyncio
    async def test_the_seed_is_the_harness_whole_model_list(
        self,
        client: AsyncClient,
    ) -> None:
        """No per-context slice survives the re-key.

        The observation is one composed document per harness, so the seed that
        fills its absence is the harness's full curated list — not a subset
        scoped by which auth context once observed a model.
        """
        _, headers = await authed_user(client)
        response = await client.get(MODELS_PATH, headers=headers)
        assert model_ids(response.json()) == [model["id"] for model in shipped_models(HARNESS)]

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
        response = await client.get(MODELS_PATH, headers=headers)
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
            owner_user_id=uuid.UUID(user_id),
            snapshot_json="{ not-a-document",
            probed_at=None,
        )
        await db_session.commit()

        response = await client.get(MODELS_PATH, headers=headers)
        assert response.status_code == 200
        payload = response.json()
        # Better than an empty list: the seed tier fills the absence.
        assert payload["origin"] == "catalog"
        assert model_ids(payload) == [model["id"] for model in shipped_models(HARNESS)]

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
        response_b = await client.get(MODELS_PATH, headers=headers_b)
        assert "a-only-model" not in model_ids(response_b.json())
        assert response_b.json()["origin"] == "catalog"

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get(MODELS_PATH)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_read_takes_no_auth_context_parameter(self, client: AsyncClient) -> None:
        """A leftover per-context caller must not select anything.

        One composed observation per harness: an ``authContextId`` query param
        is an unknown parameter FastAPI ignores, and the response is identical
        to the plain read — never a context-scoped slice.
        """
        _, headers = await authed_user(client)
        plain = await client.get(MODELS_PATH, headers=headers)
        with_param = await client.get(
            MODELS_PATH,
            params={"authContextId": "gateway"},
            headers=headers,
        )
        assert with_param.status_code == 200
        assert with_param.json() == plain.json()
        assert "authContextId" not in with_param.json()

    @pytest.mark.asyncio
    async def test_overlong_harness_kind_is_4xx_not_500(self, client: AsyncClient) -> None:
        _, headers = await authed_user(client)
        long_harness = await client.get(
            f"/v1/cloud/agent-models/{'x' * 65}",
            headers=headers,
        )
        assert long_harness.status_code == 400
        assert long_harness.json()["detail"]["code"] == "invalid_agent_harness_kind"


class TestSoftVersioningScope:
    """The scope is (harness_kind, owner_user_id) — nothing else."""

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

        claude = await client.get(MODELS_PATH, headers=headers)
        codex = await client.get("/v1/cloud/agent-models/codex", headers=headers)
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
        response = await client.get(MODELS_PATH, headers=headers)
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
        seeded = await client.get(MODELS_PATH, headers=headers)
        assert seeded.json()["origin"] == "catalog"
        assert seeded.json()["overrideApplied"] is True
        assert "extra" in model_ids(seeded.json())

        # Over a snapshot: the override survives the write that replaced the base.
        await store_snapshot(
            db_session,
            owner_user_id=uuid.UUID(user_id),
            models=["keep", "drop"],
        )
        layered = await client.get(MODELS_PATH, headers=headers)
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

        response = await client.get(MODELS_PATH, headers=headers)
        assert "two" in model_ids(response.json())
        assert "one" not in model_ids(response.json())

        delete = await client.delete(f"{MODELS_PATH}/override", headers=headers)
        assert delete.status_code == 204
        after = await client.get(MODELS_PATH, headers=headers)
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

        response_b = await client.get(MODELS_PATH, headers=headers_b)
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

    def test_no_server_module_or_test_names_the_deleted_prober(self) -> None:
        """Scan the tests too, not just the package.

        A stale reference in a test is not harmless: it is the only remaining
        documentation a reader will find of a function that no longer exists, so
        it teaches the wrong architecture. Scoping the scan to ``proliferate/``
        let exactly that survive in
        ``test_agent_auth_org_member_gateway.py`` through the first pass.
        """
        import pathlib

        import proliferate

        package_root = pathlib.Path(proliferate.__file__ or "").parent
        tests_root = pathlib.Path(__file__).resolve().parents[1]
        offenders = [
            path.as_posix()
            for root in (package_root, tests_root)
            for path in root.rglob("*.py")
            if path != pathlib.Path(__file__).resolve()
            and "_probe_gateway_models" in path.read_text()
        ]
        assert offenders == []

    def test_the_cloud_snapshot_surface_is_context_free(self) -> None:
        """Grep gate for the composed re-key (model-catalog.md §Storage).

        ``auth_context_id`` must be gone from the cloud snapshot store, model
        and routes — code, not prose: a docstring may still explain that the
        column is deliberately absent. Legitimate uses elsewhere in the
        codebase (auth-context concepts outside this surface) are not this
        gate's business.
        """
        import ast
        import pathlib

        import proliferate

        package_root = pathlib.Path(proliferate.__file__ or "").parent
        surface = [
            package_root / "db" / "models" / "cloud" / "agent_gateway.py",
            package_root / "db" / "store" / "agent_gateway" / "model_snapshots.py",
            package_root / "db" / "store" / "agent_gateway" / "records.py",
            package_root / "db" / "store" / "agent_gateway" / "mappers.py",
            package_root / "server" / "cloud" / "agent_models" / "api.py",
            package_root / "server" / "cloud" / "agent_models" / "models.py",
            package_root / "server" / "cloud" / "agent_models" / "snapshots.py",
            package_root / "server" / "cloud" / "agent_models" / "overrides.py",
        ]
        offenders: list[str] = []
        for path in surface:
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                line = getattr(node, "lineno", "?")
                name = (
                    getattr(node, "id", None)
                    or getattr(node, "attr", None)
                    or getattr(node, "arg", None)
                )
                if isinstance(name, str) and "auth_context" in name:
                    offenders.append(f"{path.name}:{line}:{name}")
                is_short_string = (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, str)
                    and len(node.value) < 64
                )
                if is_short_string and "authContextId" in node.value:  # type: ignore[attr-defined]
                    offenders.append(f"{path.name}:{line}:{node.value!r}")  # type: ignore[attr-defined]
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

    def test_no_two_routes_share_a_method_and_path(self) -> None:
        """A duplicate method+path would silently shadow, taking its auth with it.

        FastAPI resolves the collision to whichever registered first and logs
        nothing, so this is the only place the property is observable. It also
        pins the single-router shape: two routers sharing the ``/agent-models``
        prefix would make "which auth guards this path" a function of include
        order in ``cloud/api.py``.
        """
        from proliferate.main import app

        spec = app.openapi()
        registered = [
            (method.upper(), path)
            for path, operations in spec["paths"].items()
            for method in operations
        ]
        assert len(registered) == len(set(registered))

        agent_models = sorted(pair for pair in registered if "/agent-models/" in pair[1])
        assert agent_models == [
            ("DELETE", "/v1/cloud/agent-models/{harness_kind}/override"),
            ("GET", "/v1/cloud/agent-models/{harness_kind}"),
            ("POST", "/v1/cloud/agent-models/{harness_kind}/refresh"),
            ("PUT", "/v1/cloud/agent-models/{harness_kind}/override"),
        ]

    def test_the_mirror_wire_model_is_gone(self) -> None:
        """No second write shape survives the collapse to one ingest route."""
        from proliferate.server.cloud.agent_gateway import models as gateway_models

        assert not hasattr(gateway_models, "AgentGatewayCatalogMirrorRequest")
        assert not hasattr(gateway_models, "AgentGatewayCatalogRefreshRequest")
        assert not hasattr(gateway_models, "AgentGatewayCatalogResponse")
