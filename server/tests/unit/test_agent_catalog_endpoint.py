from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.server.catalogs.api import router
from proliferate.server.catalogs.service import CATALOG_PATH, read_agent_catalog


def test_agent_catalog_endpoint_returns_typed_catalog_with_etag() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents")

    assert response.status_code == 200
    assert response.headers["etag"]
    payload = response.json()
    assert payload["schemaVersion"] == 1
    assert payload["catalogVersion"] == read_agent_catalog().catalog.catalogVersion
    assert payload["agents"]

    not_modified = client.get(
        "/v1/catalogs/agents",
        headers={"If-None-Match": response.headers["etag"]},
    )
    assert not_modified.status_code == 304


def test_agent_catalog_rejects_unsupported_schema_version() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents?schemaVersion=2")

    assert response.status_code == 400


def test_agent_catalog_file_is_available_from_source_checkout() -> None:
    assert CATALOG_PATH.is_file()


def test_server_dockerfile_packages_agent_catalog() -> None:
    dockerfile = Path(__file__).resolve().parents[2] / "Dockerfile"

    assert "COPY catalogs/ catalogs/" in dockerfile.read_text(encoding="utf-8")
