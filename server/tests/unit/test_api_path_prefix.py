from starlette.requests import Request

from proliferate.auth.identity.api import _web_session_cookie_path
from proliferate.auth.identity.providers import provider_callback_url
from proliferate.config import settings
from proliferate.main import create_app


def _route_paths() -> set[str]:
    return {getattr(route, "path", "") for route in create_app().router.routes}


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
    assert "/v1/telemetry/anonymous" in paths
    assert "/v1/automations" in paths


def test_create_app_mounts_routes_under_api_prefix_when_configured(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    paths = _route_paths()

    assert "/api/health" in paths
    assert "/api/auth/desktop/token" in paths
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
        == "https://app.proliferate.com/api/auth/web/github/callback"
    )


def test_identity_provider_callback_url_does_not_double_existing_api_prefix(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com/api")
    monkeypatch.setattr(settings, "api_path_prefix", "/api")

    assert (
        provider_callback_url(_request(), provider="github", surface="web")
        == "https://app.proliferate.com/api/auth/web/github/callback"
    )
