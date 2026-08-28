from __future__ import annotations

import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.integrations import desktop_downloads as downloads_module
from proliferate.server import meta as meta_module
from proliferate.server import version as version_module
from proliferate.server.health import router as health_router
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
    "ENFORCE_MIN_DESKTOP_VERSION",
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
    # Unset by default: enforcement is opt-in, not implied by a min-version pin.
    assert body["minDesktopVersionEnforced"] is False


def test_meta_shape_and_types_without_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)

    body = _client().get("/meta").json()

    assert set(body) == set(_VERSION_FIELDS) | {
        "capabilities",
        "minDesktopVersionEnforced",
        "desktopUpdater",
        "agentCatalog",
    }
    for field in _VERSION_FIELDS:
        assert isinstance(body[field], str) and body[field]
    assert isinstance(body["capabilities"], dict)
    assert isinstance(body["minDesktopVersionEnforced"], bool)


def test_meta_enforce_min_desktop_version_opt_in(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("ENFORCE_MIN_DESKTOP_VERSION", "true")
    assert _client().get("/meta").json()["minDesktopVersionEnforced"] is True


def test_meta_enforce_min_desktop_version_default_permissive(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # Even with an explicit MIN_DESKTOP_VERSION floor stamped, enforcement stays
    # off unless the operator explicitly opts in — the pin alone must never
    # start blocking clients.
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("MIN_DESKTOP_VERSION", "9.9.9")

    body = _client().get("/meta").json()

    assert body["minDesktopVersion"] == "9.9.9"
    assert body["minDesktopVersionEnforced"] is False


def test_meta_enforce_min_desktop_version_garbage_is_permissive(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _clear_pin_env(monkeypatch)
    monkeypatch.setenv("ENFORCE_MIN_DESKTOP_VERSION", "not-a-bool")
    assert _client().get("/meta").json()["minDesktopVersionEnforced"] is False


# T1-SH-3 (delivery/testing-cicd/archive/self-hosting.md): the /meta wire contract.
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
    "minDesktopVersionEnforced",
    "capabilities",
    # Additive (FR-2): optional desktop updater cadence override, null unless
    # the deployment configured it.
    "desktopUpdater",
    "agentCatalog",
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


def _clear_cadence_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    for name in ("DESKTOP_UPDATER_CHECK_INTERVAL_MS", "DESKTOP_UPDATER_STALL_THRESHOLD_MS"):
        monkeypatch.delenv(name, raising=False)


def test_meta_desktop_updater_cadence_absent_by_default(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # Additive field: present but null unless a deployment configured overrides.
    _clear_cadence_env(monkeypatch)
    assert _client().get("/meta").json()["desktopUpdater"] is None


def test_desktop_updater_cadence_builder_is_env_driven(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from proliferate.server.meta import _desktop_updater_cadence

    _clear_cadence_env(monkeypatch)  # No env overrides -> None.
    assert _desktop_updater_cadence() is None

    monkeypatch.setenv("DESKTOP_UPDATER_CHECK_INTERVAL_MS", "900000")  # one set -> populated
    cadence = _desktop_updater_cadence()
    assert cadence is not None
    assert cadence.checkIntervalMs == 900_000
    assert cadence.stallThresholdMs is None

    # Garbage / non-positive env values are ignored (tolerant read -> None).
    _clear_cadence_env(monkeypatch)
    monkeypatch.setenv("DESKTOP_UPDATER_CHECK_INTERVAL_MS", "not-a-number")
    monkeypatch.setenv("DESKTOP_UPDATER_STALL_THRESHOLD_MS", "0")
    assert _desktop_updater_cadence() is None
