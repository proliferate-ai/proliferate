from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.constants.cloud import RESERVED_CLOUD_REPO_ENV_VARS
from proliferate.server.catalogs.api import router
from proliferate.server.catalogs.domain.schema import agent_catalog_schema_version_is_supported
from proliferate.server.catalogs.service import (
    CATALOG_PATH,
    read_agent_catalog,
    served_agent_catalog_version,
)
from proliferate.server.cloud.worker.models import (
    WorkerDesiredVersionsResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
)
from proliferate.server.cloud.agent_auth.registry import (
    REGISTRY_PATH,
    _resolve_registry_path,
    registry_auth_slots,
)


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


def test_agent_catalog_schema_version_policy() -> None:
    assert agent_catalog_schema_version_is_supported(None)
    assert agent_catalog_schema_version_is_supported(1)
    assert not agent_catalog_schema_version_is_supported(2)


def test_agent_catalog_file_is_available_from_source_checkout() -> None:
    assert CATALOG_PATH.is_file()


def test_served_agent_catalog_version_matches_served_document() -> None:
    assert served_agent_catalog_version() == read_agent_catalog().catalog.catalogVersion


def test_served_agent_catalog_version_is_generation_agnostic(tmp_path: Path) -> None:
    document = tmp_path / "catalog.json"
    document.write_text(
        '{"schemaVersion": 2, "catalogVersion": "2026-07-01.1"}',
        encoding="utf-8",
    )

    assert served_agent_catalog_version(document) == "2026-07-01.1"


def test_served_agent_catalog_version_caches_until_mtime_changes(tmp_path: Path) -> None:
    document = tmp_path / "catalog.json"
    document.write_text('{"catalogVersion": "2026-06-10.6"}', encoding="utf-8")
    mtime_ns = document.stat().st_mtime_ns

    assert served_agent_catalog_version(document) == "2026-06-10.6"

    document.write_text('{"catalogVersion": "2026-06-10.7"}', encoding="utf-8")
    os.utime(document, ns=(mtime_ns, mtime_ns))
    assert served_agent_catalog_version(document) == "2026-06-10.6"

    os.utime(document, ns=(mtime_ns + 1, mtime_ns + 1))
    assert served_agent_catalog_version(document) == "2026-06-10.7"


def test_served_agent_catalog_version_handles_missing_or_invalid_document(
    tmp_path: Path,
) -> None:
    assert served_agent_catalog_version(tmp_path / "absent.json") is None

    broken = tmp_path / "broken.json"
    broken.write_text("not json", encoding="utf-8")
    assert served_agent_catalog_version(broken) is None

    versionless = tmp_path / "versionless.json"
    versionless.write_text('{"schemaVersion": 1}', encoding="utf-8")
    assert served_agent_catalog_version(versionless) is None


def test_worker_heartbeat_response_advertises_catalog_version() -> None:
    response = WorkerHeartbeatResponse(
        target_id="target",
        worker_id="worker",
        status="online",
        server_time="2026-06-10T00:00:00Z",
        desired_versions=WorkerDesiredVersionsResponse(
            should_update=False,
            update_channel="stable",
            update_generation=0,
        ),
        catalog_version="2026-06-10.6",
    )

    payload = response.model_dump(by_alias=True)
    assert payload["catalogVersion"] == "2026-06-10.6"

    # Pre-convergence behavior: the field defaults to null.
    assert WorkerHeartbeatResponse.model_fields["catalog_version"].default is None


def test_worker_heartbeat_request_accepts_catalog_version() -> None:
    request = WorkerHeartbeatRequest.model_validate(
        {"status": "online", "catalogVersion": "2026-06-10.6"}
    )
    assert request.catalog_version == "2026-06-10.6"

    legacy = WorkerHeartbeatRequest.model_validate({"status": "online"})
    assert legacy.catalog_version is None


def test_agent_registry_file_is_available_from_source_checkout() -> None:
    assert REGISTRY_PATH.is_file()


def test_cloud_repo_env_reservations_cover_agent_auth_protected_env_keys() -> None:
    protected_env_keys = set()
    for slot in registry_auth_slots():
        if slot.gateway_env is not None:
            protected_env_keys.update(slot.gateway_env.protected_env_keys)
        if slot.synced_files is not None:
            protected_env_keys.update(slot.synced_files.protected_env_keys)

    assert protected_env_keys <= RESERVED_CLOUD_REPO_ENV_VARS


def test_agent_registry_path_resolves_server_docker_layout(tmp_path: Path) -> None:
    app_root = tmp_path / "app"
    packaged_registry = app_root / "catalogs" / "agents" / "v1" / "registry.json"
    packaged_registry.parent.mkdir(parents=True)
    packaged_registry.write_text("{}", encoding="utf-8")
    service_path = app_root / "proliferate" / "server" / "cloud" / "agent_auth" / "registry.py"
    service_path.parent.mkdir(parents=True)
    service_path.write_text("", encoding="utf-8")

    assert _resolve_registry_path(service_path) == packaged_registry


def test_server_dockerfile_packages_agent_catalog() -> None:
    dockerfile = Path(__file__).resolve().parents[2] / "Dockerfile"

    assert "COPY catalogs/ catalogs/" in dockerfile.read_text(encoding="utf-8")
