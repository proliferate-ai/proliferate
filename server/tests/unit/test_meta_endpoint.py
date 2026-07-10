from __future__ import annotations

import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.config import Settings
from proliferate.integrations import desktop_downloads as downloads_module
from proliferate.server import meta as meta_module
from proliferate.server import version as version_module
from proliferate.server.health import router as health_router
from proliferate.server.meta import build_server_capabilities
from proliferate.server.meta import router as meta_router

# server/tests/unit/test_meta_endpoint.py -> repo root is four parents up.
REPO_VERSION = (Path(__file__).resolve().parents[3] / "VERSION").read_text().strip()

# The version pins reported by /meta, separate from the capabilities block.
_VERSION_FIELDS = (
    "serverVersion",
    "desktopVersion",
    "runtimeVersion",
    "workerVersion",
    "minDesktopVersion",
)

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


def test_meta_reports_stamped_pins(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("SERVER_VERSION", "0.3.0")
    monkeypatch.setenv("DESKTOP_VERSION", "0.3.2")
    monkeypatch.setenv("RUNTIME_VERSION", "0.3.1")
    monkeypatch.setenv("WORKER_VERSION", "0.3.4")
    monkeypatch.setenv("MIN_DESKTOP_VERSION", "0.3.0")

    body = _client().get("/meta").json()

    assert {field: body[field] for field in _VERSION_FIELDS} == {
        "serverVersion": "0.3.0",
        "desktopVersion": "0.3.2",
        "runtimeVersion": "0.3.1",
        "workerVersion": "0.3.4",
        "minDesktopVersion": "0.3.0",
    }
    # The capability contract rides alongside the version pins.
    assert isinstance(body["capabilities"], dict)


def test_meta_shape_and_types_without_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)

    body = _client().get("/meta").json()

    assert set(body) == set(_VERSION_FIELDS) | {"capabilities"}
    for field in _VERSION_FIELDS:
        assert isinstance(body[field], str) and body[field]
    assert isinstance(body["capabilities"], dict)


# T1-SH-3 (specs/developing/testing/self-hosting.md): the /meta wire contract.
#
# `/meta` is the shape the desktop's connect-to-a-server dialog reads to render
# its trust-confirmation screen ("Server version X"). A silent field rename or
# reorder breaks every desktop that talks to a self-hosted server, and no other
# test would notice. This golden test pins the exact field names AND their
# order, both on the response model and on the live JSON, so a rename mechanically
# fails here. Field-set membership is covered above; this is the rename guard.
_META_GOLDEN_FIELDS = [
    "serverVersion",
    "desktopVersion",
    "runtimeVersion",
    "workerVersion",
    "minDesktopVersion",
    "capabilities",
]


def test_meta_response_golden_contract(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # The declared response model is the contract of record.
    assert list(meta_module.MetaResponse.model_fields.keys()) == _META_GOLDEN_FIELDS

    _clear_pin_env(monkeypatch)
    body = _client().get("/meta").json()

    # The serialized wire order matches the model exactly (dict preserves
    # insertion order, so this catches a reorder as well as a rename).
    assert list(body.keys()) == _META_GOLDEN_FIELDS


def test_meta_pins_fall_back_to_server_version(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("SERVER_VERSION", "1.2.3")

    body = _client().get("/meta").json()

    assert body["desktopVersion"] == "1.2.3"
    assert body["runtimeVersion"] == "1.2.3"
    assert body["workerVersion"] == "1.2.3"
    assert body["minDesktopVersion"] == "1.2.3"


# --- Capability contract (server/proliferate/server/meta.py) ------------------
#
# The capabilities block is the source of truth the desktop renders from. These
# tests exercise the pure builder against a Settings instance so the behavior is
# deterministic regardless of ambient env. Every capability-relevant field is
# reset to a known base and then overridden per test, so ambient env / .env
# values cannot leak into the assertions.

_CAPABILITY_FIELDS = {
    "deployment": ("mode", "displayName", "logoUrl"),
    "billing": None,
    "usageMetering": None,
    "cloudWorkspaces": None,
    "agentGateway": None,
    "webApp": ("available", "baseUrl"),
    "support": ("kind", "email", "url"),
    "pricing": ("available", "url"),
}


def _cfg(**overrides):  # type: ignore[no-untyped-def]
    cfg = Settings()
    # Reset every capability-relevant field to a known base, then apply
    # overrides, so ambient env cannot leak into the assertion.
    base = {
        "telemetry_mode": "self_managed",
        "cloud_billing_mode": "off",
        "agent_gateway_enabled": False,
        "e2b_api_key": "",
        "e2b_template_name": "",
        "frontend_base_url": "",
        "instance_name": "",
        "instance_logo_url": "",
        "instance_support_email": "",
        "instance_support_url": "",
    }
    base.update(overrides)
    for key, value in base.items():
        setattr(cfg, key, value)
    return cfg


def test_capabilities_shape_and_version() -> None:
    caps = build_server_capabilities(_cfg())

    assert caps.contractVersion == 1
    dumped = caps.model_dump()
    assert set(dumped) == {
        "contractVersion",
        "deployment",
        "billing",
        "usageMetering",
        "cloudWorkspaces",
        "agentGateway",
        "webApp",
        "support",
        "pricing",
    }
    for field, subfields in _CAPABILITY_FIELDS.items():
        if subfields is not None:
            assert set(dumped[field]) == set(subfields)


def test_capabilities_hosted_product() -> None:
    caps = build_server_capabilities(
        _cfg(
            telemetry_mode="hosted_product",
            cloud_billing_mode="enforce",
            agent_gateway_enabled=True,
            e2b_api_key="e2b-key",
            e2b_template_name="proliferate-runtime-cloud",
            frontend_base_url="https://web.proliferate.com",
        )
    )

    assert caps.deployment.mode == "hosted_product"
    assert caps.deployment.displayName == "Proliferate"
    assert caps.billing is True
    assert caps.usageMetering is True
    assert caps.cloudWorkspaces is True
    assert caps.agentGateway is True
    assert caps.webApp.available is True
    assert caps.webApp.baseUrl == "https://web.proliferate.com"
    assert caps.support.kind == "vendor"
    assert caps.support.email == "support@proliferate.com"
    assert caps.pricing.available is True
    assert caps.pricing.url == "https://proliferate.com/pricing"


def test_capabilities_self_managed_base_is_all_off() -> None:
    caps = build_server_capabilities(_cfg(telemetry_mode="self_managed"))

    assert caps.deployment.mode == "self_managed"
    # No instance name configured -> empty, so the desktop uses the origin.
    assert caps.deployment.displayName == ""
    assert caps.deployment.logoUrl is None
    assert caps.billing is False
    assert caps.usageMetering is False
    assert caps.cloudWorkspaces is False
    assert caps.agentGateway is False
    assert caps.webApp.available is False
    assert caps.webApp.baseUrl is None
    assert caps.support.kind == "none"
    assert caps.support.email is None
    assert caps.pricing.available is False
    assert caps.pricing.url is None


def test_capabilities_self_managed_with_addons() -> None:
    caps = build_server_capabilities(
        _cfg(
            telemetry_mode="self_managed",
            cloud_billing_mode="observe",
            agent_gateway_enabled=True,
            e2b_api_key="e2b-key",
            e2b_template_name="company-runtime",
            instance_name="Acme Internal",
            instance_logo_url="https://acme.example.com/logo.svg",
            instance_support_email="it-help@acme.example.com",
        )
    )

    assert caps.deployment.mode == "self_managed"
    assert caps.deployment.displayName == "Acme Internal"
    assert caps.deployment.logoUrl == "https://acme.example.com/logo.svg"
    # Billing off but observe metering on: metering true, billing (mode != off) true.
    assert caps.billing is True
    assert caps.usageMetering is True
    assert caps.cloudWorkspaces is True
    assert caps.agentGateway is True
    # Web app is never self-hosted, even with add-ons configured.
    assert caps.webApp.available is False
    assert caps.support.kind == "operator"
    assert caps.support.email == "it-help@acme.example.com"
    assert caps.support.url is None
    # No vendor pricing on a self-managed deployment.
    assert caps.pricing.available is False


def test_capabilities_cloud_workspaces_requires_both_e2b_fields() -> None:
    only_key = build_server_capabilities(_cfg(e2b_api_key="e2b-key"))
    only_template = build_server_capabilities(_cfg(e2b_template_name="company-runtime"))

    assert only_key.cloudWorkspaces is False
    assert only_template.cloudWorkspaces is False


def test_capabilities_local_dev_is_self_managed_posture() -> None:
    caps = build_server_capabilities(_cfg(telemetry_mode="local_dev"))

    assert caps.deployment.mode == "local_dev"
    assert caps.billing is False
    assert caps.webApp.available is False
    assert caps.support.kind == "none"
    assert caps.pricing.available is False


def _stub_manifest_probe(monkeypatch, exists: bool) -> list[str]:  # type: ignore[no-untyped-def]
    probed: list[str] = []

    async def probe(url: str) -> bool:
        probed.append(url)
        return exists

    monkeypatch.setattr(meta_module, "_versioned_manifest_exists", probe)
    return probed


def test_updater_redirects_302_to_versioned_manifest(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("DESKTOP_VERSION", "0.3.2")
    _stub_manifest_probe(monkeypatch, exists=True)

    response = _client().get("/desktop/updater/latest.json")

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://downloads.proliferate.com/desktop/stable/0.3.2/latest.json"
    )


def test_updater_redirect_honors_downloads_base_override(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("DESKTOP_VERSION", "0.3.2")
    monkeypatch.setenv("DESKTOP_DOWNLOADS_BASE_URL", "https://cdn.example.com/")
    _stub_manifest_probe(monkeypatch, exists=True)

    response = _client().get("/desktop/updater/latest.json")

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://cdn.example.com/desktop/stable/0.3.2/latest.json"
    )


def test_updater_falls_back_to_flat_manifest_when_pin_unpublished(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("DESKTOP_VERSION", "0.3.2")
    probed = _stub_manifest_probe(monkeypatch, exists=False)

    response = _client().get("/desktop/updater/latest.json")

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://downloads.proliferate.com/desktop/stable/latest.json"
    )
    assert probed == ["https://downloads.proliferate.com/desktop/stable/0.3.2/latest.json"]


def test_manifest_probe_caches_results(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    downloads_module._manifest_probe_cache.clear()
    calls: list[str] = []

    class _Response:
        status_code = 200

    class _Client:
        def __init__(self, **kwargs) -> None:  # type: ignore[no-untyped-def]
            pass

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, *args):  # type: ignore[no-untyped-def]
            return None

        async def head(self, url: str) -> _Response:
            calls.append(url)
            return _Response()

    monkeypatch.setattr(downloads_module.httpx, "AsyncClient", _Client)

    import asyncio

    url = "https://downloads.proliferate.com/desktop/stable/9.9.9/latest.json"
    assert asyncio.run(downloads_module.versioned_manifest_exists(url)) is True
    assert asyncio.run(downloads_module.versioned_manifest_exists(url)) is True
    assert calls == [url]
    downloads_module._manifest_probe_cache.clear()


def test_health_reports_stamped_server_version(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("SERVER_VERSION", "9.9.9")

    body = _client().get("/health").json()

    assert body == {"status": "ok", "version": "9.9.9"}


def test_health_version_is_not_hardcoded_placeholder(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)

    body = _client().get("/health").json()

    # No env stamp: falls back to the repo VERSION file, never the old 0.1.0.
    assert body["version"] != "0.1.0"
    assert body["version"] == REPO_VERSION
    assert re.match(r"^\d+\.\d+\.\d+", body["version"])


def test_version_helper_dev_fallback(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setattr(version_module, "_read_version_file", lambda: None)

    assert version_module.server_version() == "0.0.0-dev"
