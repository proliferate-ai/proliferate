"""Publisher lane channel advertisement on GET /meta (Update Flow ADR, FR-1).

Split out of test_meta_endpoint.py to keep that file under the repo's
max-lines threshold; shares its fixtures/helpers by importing them directly.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.config import Settings
from proliferate.server import meta as meta_module
from proliferate.server.health import router as health_router
from proliferate.server.meta import router as meta_router

_PIN_ENV_VARS = (
    "SERVER_VERSION",
    "DESKTOP_VERSION",
    "RUNTIME_VERSION",
    "WORKER_VERSION",
    "MIN_DESKTOP_VERSION",
    "DESKTOP_DOWNLOADS_BASE_URL",
)


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(health_router)
    app.include_router(meta_router)
    return TestClient(app, follow_redirects=False)


def _clear_pin_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    for name in _PIN_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_agent_catalog_channel_is_none_by_default() -> None:
    cfg = Settings(agent_catalog_artifact_base_url="", agent_catalog_channel="stable")
    assert meta_module._agent_catalog_channel(cfg) is None


def test_agent_catalog_channel_reports_configured_base_url_and_channel() -> None:
    cfg = Settings(
        agent_catalog_artifact_base_url="https://downloads.proliferate.com",
        agent_catalog_channel="canary",
    )
    channel = meta_module._agent_catalog_channel(cfg)
    assert channel is not None
    assert channel.artifactBaseUrl == "https://downloads.proliferate.com"
    assert channel.channel == "canary"


def test_agent_catalog_channel_defaults_channel_to_stable_when_blank() -> None:
    cfg = Settings(
        agent_catalog_artifact_base_url="https://downloads.proliferate.com",
        agent_catalog_channel="  ",
    )
    channel = meta_module._agent_catalog_channel(cfg)
    assert channel is not None
    assert channel.channel == "stable"


def test_meta_endpoint_agent_catalog_is_null_without_operator_configuration(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.delenv("AGENT_CATALOG_ARTIFACT_BASE_URL", raising=False)

    body = _client().get("/meta").json()

    assert body["agentCatalog"] is None
