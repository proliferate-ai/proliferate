from proliferate.config import settings
from proliferate.main import create_app


def _route_paths() -> set[str]:
    return {getattr(route, "path", "") for route in create_app().router.routes}


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
