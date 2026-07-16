"""Tests for serving the compiled Web application from the server image.

Covers the WEB_DIST_DIR gate, fail-closed SPA fallback, reserved API/auth/setup
namespaces, static-asset serving, traversal rejection, cache headers, and both
empty and configured API_PATH_PREFIX behavior.
"""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from proliferate.config import settings
from proliferate.main import create_app


def _write_dist(tmp_path: Path, *, with_index: bool = True) -> Path:
    dist = tmp_path / "web-dist"
    (dist / "assets").mkdir(parents=True)
    if with_index:
        (dist / "index.html").write_text(
            "<!doctype html><html><body>"
            '<div id="root"></div>'
            '<script src="/assets/index-abc123.js"></script>'
            "</body></html>"
        )
    (dist / "assets" / "index-abc123.js").write_text("console.log('web');")
    (dist / "assets" / "index-abc123.css").write_text(".root{color:red}")
    (dist / "favicon.ico").write_text("icon-bytes")
    return dist


def test_empty_web_dist_dir_keeps_api_only_behavior(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(settings, "web_dist_dir", "")
    app = create_app()
    # No SPA fallback handler is installed when Web serving is disabled, and no
    # /assets static mount is added.
    handler_names = {
        getattr(handler, "__name__", "") for handler in app.exception_handlers.values()
    }
    assert "spa_fallback" not in handler_names
    assert not any(getattr(route, "name", "") == "web-assets" for route in app.routes)


def test_missing_index_html_fails_startup(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    dist = _write_dist(tmp_path, with_index=False)
    monkeypatch.setattr(settings, "web_dist_dir", str(dist))
    with pytest.raises(RuntimeError, match="does not contain index.html"):
        create_app()


@pytest.fixture()
def web_app(monkeypatch, tmp_path):  # type: ignore[no-untyped-def]
    dist = _write_dist(tmp_path)
    monkeypatch.setattr(settings, "web_dist_dir", str(dist))
    monkeypatch.setattr(settings, "api_path_prefix", "")
    return create_app()


async def _client(app):  # type: ignore[no-untyped-def]
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_root_and_client_routes_serve_index(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        for path in ("/", "/login", "/settings", "/some/deep/client/route"):
            resp = await client.get(path)
            assert resp.status_code == 200, path
            assert '<div id="root"></div>' in resp.text, path
            assert resp.headers["cache-control"] == "no-cache", path


@pytest.mark.asyncio
async def test_real_hashed_asset_served_with_immutable_cache(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        resp = await client.get("/assets/index-abc123.js")
        assert resp.status_code == 200
        assert "console.log" in resp.text
        assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert "javascript" in resp.headers["content-type"]

        css = await client.get("/assets/index-abc123.css")
        assert css.status_code == 200
        assert "text/css" in css.headers["content-type"]


@pytest.mark.asyncio
async def test_missing_asset_is_404_not_index(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        resp = await client.get("/assets/does-not-exist.js")
        assert resp.status_code == 404
        assert '<div id="root"></div>' not in resp.text


@pytest.mark.asyncio
async def test_root_level_static_file_served_directly(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        resp = await client.get("/favicon.ico")
        assert resp.status_code == 200
        assert resp.text == "icon-bytes"


@pytest.mark.asyncio
async def test_health_and_meta_win_over_fallback(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        health = await client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        meta = await client.get("/meta")
        assert meta.status_code == 200
        assert "serverVersion" in meta.json()


@pytest.mark.asyncio
async def test_unknown_api_routes_stay_api_404(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        for path in ("/v1/does-not-exist", "/auth/does-not-exist"):
            resp = await client.get(path)
            assert resp.status_code == 404, path
            assert '<div id="root"></div>' not in resp.text, path


@pytest.mark.asyncio
async def test_real_api_route_still_served(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        # A real /v1 route without auth returns its API failure (401), never the
        # SPA shell.
        resp = await client.get("/v1/organizations")
        assert resp.status_code in (401, 403)
        assert '<div id="root"></div>' not in resp.text


@pytest.mark.asyncio
async def test_non_navigation_methods_do_not_fall_back(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            resp = await client.request(method, "/some/client/route")
            assert resp.status_code != 200, method
            assert '<div id="root"></div>' not in resp.text, method


@pytest.mark.asyncio
async def test_head_navigation_falls_back(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        resp = await client.head("/login")
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_traversal_outside_dist_is_rejected(web_app) -> None:  # type: ignore[no-untyped-def]
    async with await _client(web_app) as client:
        # A traversal attempt resolves to the SPA shell (200 index), never a file
        # outside the distribution root.
        resp = await client.get("/../../etc/passwd")
        assert "root:" not in resp.text


@pytest.mark.asyncio
async def test_setup_and_register_win_over_fallback(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    dist = _write_dist(tmp_path)
    monkeypatch.setattr(settings, "web_dist_dir", str(dist))
    monkeypatch.setattr(settings, "api_path_prefix", "")
    monkeypatch.setattr(settings, "single_org_mode_override", True)
    app = create_app()
    async with await _client(app) as client:
        # /register is a server-owned HTML flow; a bogus token returns the
        # server page, not the SPA shell.
        resp = await client.get("/register?token=nope")
        assert '<div id="root"></div>' not in resp.text


@pytest.mark.asyncio
async def test_reserved_namespaces_respect_api_prefix(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    dist = _write_dist(tmp_path)
    monkeypatch.setattr(settings, "web_dist_dir", str(dist))
    monkeypatch.setattr(settings, "api_path_prefix", "/api")
    app = create_app()
    async with await _client(app) as client:
        # Under a configured prefix, /api/health wins and /api/v1/<missing> is an
        # API 404, while a bare client route still serves the shell.
        health = await client.get("/api/health")
        assert health.status_code == 200
        unknown = await client.get("/api/v1/nope")
        assert unknown.status_code == 404
        assert '<div id="root"></div>' not in unknown.text
        shell = await client.get("/login")
        assert shell.status_code == 200
        assert '<div id="root"></div>' in shell.text
