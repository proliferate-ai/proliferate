import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from proliferate.auth.desktop.service import build_github_callback_url
from proliferate.auth.identity.api import _web_session_cookie_path
from proliferate.auth.identity.providers import provider_callback_url
from proliferate.config import settings
from proliferate.main import create_app


def _route_paths() -> set[str]:
    # Resolve mounted paths via the OpenAPI schema rather than walking
    # ``router.routes`` directly. Starlette >= 1.3 keeps included sub-routers as
    # opaque ``_IncludedRouter`` objects whose nested paths no longer surface as
    # top-level ``route.path`` values, so naive introspection silently misses
    # every mounted route. ``openapi()`` reconstructs the full, prefix-aware paths
    # the same way across Starlette versions.
    return set(create_app().openapi()["paths"].keys())


def _request(path: str = "/api/auth/web/github/start") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "scheme": "http",
            "server": ("test", 80),
            "client": ("testclient", 50000),
            "root_path": "",
        }
    )


def test_create_app_mounts_routes_without_api_prefix_by_default(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_path_prefix", "")

    paths = _route_paths()

    assert "/health" in paths
    assert "/auth/desktop/token" in paths
    assert "/auth/sso/discover" in paths
    assert "/auth/{surface}/sso/start" in paths
    assert "/auth/sso/oidc/callback" in paths
    assert "/v1/telemetry/anonymous" in paths
    assert "/v1/automations" in paths


def test_slack_bot_routes_are_parked() -> None:
    paths = _route_paths()

    assert "/v1/cloud/slack/events" not in paths
    assert "/v1/cloud/slack/oauth/start" not in paths
    assert "/v1/cloud/slack/bot-config" not in paths


@pytest.mark.asyncio
async def test_slack_bot_routes_return_404_while_parked() -> None:
    transport = ASGITransport(app=create_app())  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        events = await client.post("/v1/cloud/slack/events")
        oauth_start = await client.get("/v1/cloud/slack/oauth/start")
        bot_config = await client.get("/v1/cloud/slack/bot-config")

    assert events.status_code == 404
    assert oauth_start.status_code == 404
    assert bot_config.status_code == 404


def test_create_app_mounts_routes_under_api_prefix_when_configured(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    paths = _route_paths()

    assert "/api/health" in paths
    assert "/api/auth/desktop/token" in paths
    assert "/api/auth/sso/discover" in paths
    assert "/api/auth/{surface}/sso/start" in paths
    assert "/api/auth/sso/oidc/callback" in paths
    assert "/api/v1/telemetry/anonymous" in paths
    assert "/api/v1/automations" in paths


def test_identity_web_session_cookie_path_uses_api_prefix(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert _web_session_cookie_path() == "/api/auth/web/session"


def test_identity_provider_callback_url_uses_api_prefix_when_base_is_origin(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com")
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert (
        provider_callback_url(_request(), provider="github", surface="web")
        == "https://app.proliferate.com/api/auth/github/callback"
    )


def test_identity_provider_callback_url_does_not_double_existing_api_prefix(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com/api")
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert (
        provider_callback_url(_request(), provider="github", surface="web")
        == "https://app.proliferate.com/api/auth/github/callback"
    )


def test_desktop_github_callback_url_uses_api_prefix_when_base_is_origin(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com")
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert (
        build_github_callback_url(_request("/api/auth/desktop/github/authorize"))
        == "https://app.proliferate.com/api/auth/desktop/github/callback"
    )


def test_desktop_github_callback_url_does_not_double_existing_api_prefix(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com/api")
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert (
        build_github_callback_url(_request("/api/auth/desktop/github/authorize"))
        == "https://app.proliferate.com/api/auth/desktop/github/callback"
    )
