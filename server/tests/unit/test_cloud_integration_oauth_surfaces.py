from __future__ import annotations

import pytest

from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections.oauth import surfaces


def test_oauth_return_target_defaults_to_desktop() -> None:
    target = surfaces.normalize_return_target(
        callback_surface=None,
        final_surface=None,
        return_path=None,
    )

    assert target.callback_surface == "desktop"
    assert target.final_surface == "desktop"
    assert target.return_path is None


@pytest.mark.parametrize(
    ("callback_surface", "final_surface", "return_path"),
    [
        ("unknown", None, None),
        ("desktop", "web", None),
        ("desktop", "desktop", surfaces.OAUTH_WEB_COMPLETION_PATH),
    ],
)
def test_oauth_return_target_rejects_unsupported_desktop_shapes(
    callback_surface: str,
    final_surface: str | None,
    return_path: str | None,
) -> None:
    with pytest.raises(CloudApiError) as raised:
        surfaces.normalize_return_target(
            callback_surface=callback_surface,
            final_surface=final_surface,
            return_path=return_path,
        )

    assert raised.value.code == "invalid_payload"


def test_oauth_return_target_requires_web_completion_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(surfaces.app_settings, "frontend_base_url", "https://app.example.com")

    with pytest.raises(CloudApiError):
        surfaces.normalize_return_target(
            callback_surface="web",
            final_surface="web",
            return_path=None,
        )


def test_oauth_return_target_accepts_configured_web_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(surfaces.app_settings, "frontend_base_url", "https://app.example.com/")

    target = surfaces.normalize_return_target(
        callback_surface="web",
        final_surface="web",
        return_path=surfaces.OAUTH_WEB_COMPLETION_PATH,
    )

    assert target.callback_surface == "web"
    assert target.final_surface == "web"
    assert target.return_path == surfaces.OAUTH_WEB_COMPLETION_PATH
