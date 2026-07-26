from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.server.catalogs.api import router
from proliferate.server.catalogs.domain.schema import agent_catalog_schema_version_is_supported
from proliferate.server.catalogs.service import CATALOG_PATH, read_agent_catalog


def test_agent_catalog_endpoint_returns_typed_catalog_with_etag() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents")

    assert response.status_code == 200
    assert response.headers["etag"]
    payload = response.json()
    assert payload["schemaVersion"] == 2
    assert payload["catalogVersion"] == read_agent_catalog().catalog.catalogVersion
    assert payload["agents"]
    sessions_by_kind = {agent["kind"]: agent["session"] for agent in payload["agents"]}
    assert sessions_by_kind["claude"]["unattendedModeId"] == "bypassPermissions"
    assert sessions_by_kind["codex"]["unattendedModeId"] == "full-access"
    assert sessions_by_kind["cursor"]["unattendedModeId"] is None

    not_modified = client.get(
        "/v1/catalogs/agents",
        headers={"If-None-Match": response.headers["etag"]},
    )
    assert not_modified.status_code == 304


def test_agent_catalog_rejects_unsupported_schema_version() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents?schemaVersion=1")

    assert response.status_code == 400


def test_agent_catalog_accepts_explicit_schema_version_two() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents?schemaVersion=2")

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == 2


def test_agent_catalog_schema_version_policy() -> None:
    assert agent_catalog_schema_version_is_supported(None)
    assert agent_catalog_schema_version_is_supported(2)
    assert not agent_catalog_schema_version_is_supported(1)
    assert not agent_catalog_schema_version_is_supported(3)


def test_agent_catalog_file_is_available_from_source_checkout() -> None:
    assert CATALOG_PATH.is_file()


def test_catalogs_service_exposes_no_heartbeat_version_advertiser() -> None:
    """The binary is the only catalog transport (agent-distribution.md,
    "Convergence"), so the server has no served-catalog-version to advertise on
    the worker heartbeat. Only the full-document read (the live agent picker's
    source) remains.
    """
    import proliferate.server.catalogs.service as catalogs_service

    assert not hasattr(catalogs_service, "served_agent_catalog_version")


def test_server_dockerfile_packages_agent_catalog() -> None:
    dockerfile = Path(__file__).resolve().parents[2] / "Dockerfile"

    assert "COPY catalogs/ catalogs/" in dockerfile.read_text(encoding="utf-8")
