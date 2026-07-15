"""GitHub App callback return targets + stateless setup handling (T1).

Regressions on an API-only self-hosted deployment:
  * the install/setup callback landed on a ``/settings/organization`` web route
    that does not exist (404) when no web app is configured;
  * GitHub's Setup URL is called WITHOUT a signed ``state`` after later
    repository-selection changes, and the callback rejected that with 422 —
    so the server's effective repo scope was never refreshed.

The callback now returns a server-rendered self-host-safe page when there is no
web frontend, and a stateless setup callback refreshes installation scope
instead of failing.
"""

from __future__ import annotations

import pytest

from proliferate.server.cloud.github_app import service


def test_default_return_uses_frontend_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "frontend_base_url", "https://app.example.test")
    assert (
        service._default_return_after_callback("organization")
        == "https://app.example.test/settings/organization"
    )


def test_default_return_is_self_host_safe_page_without_frontend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # API-only self-host: no web frontend, but a callback base is configured
    # (GitHub reached us, so one must be).
    monkeypatch.setattr(service.settings, "frontend_base_url", "")
    monkeypatch.setattr(
        service.settings, "github_app_callback_base_url", "https://api.example.test"
    )
    monkeypatch.setattr(service.settings, "api_base_url", "")

    for section in ("account", "organization"):
        target = service._default_return_after_callback(section)  # type: ignore[arg-type]
        # A route the API itself serves — never a 404 web settings route.
        assert target.endswith(service.GITHUB_APP_CONNECTED_PAGE_PATH)
        assert "/settings/" not in target


@pytest.mark.asyncio
async def test_setup_callback_without_state_refreshes_scope_and_returns_safe_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "frontend_base_url", "")
    monkeypatch.setattr(
        service.settings, "github_app_callback_base_url", "https://api.example.test"
    )
    monkeypatch.setattr(service.settings, "api_base_url", "")

    refreshed: list[bool] = []

    async def fake_refresh(db: object) -> None:
        del db
        refreshed.append(True)

    async def fail_stateful(*_a: object, **_k: object) -> str:
        raise AssertionError("stateless callback must not run the stateful bind path")

    monkeypatch.setattr(service, "refresh_github_app_installation_cache", fake_refresh)
    monkeypatch.setattr(service, "complete_github_app_installation_callback", fail_stateful)

    url = await service.complete_github_app_installation_redirect(
        object(),
        installation_id="145560428",
        setup_action="update",
        state=None,
    )

    # Effective repo scope refreshed (item: installation updates refresh scope).
    assert refreshed == [True]
    # And no 422 — a valid self-host-safe landing instead.
    assert url.endswith(service.GITHUB_APP_CONNECTED_PAGE_PATH)


@pytest.mark.asyncio
async def test_setup_callback_with_state_delegates_to_stateful_bind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str | None, str | None, str | None]] = []

    async def fake_stateful(
        db: object,
        *,
        installation_id: str | None,
        setup_action: str | None,
        state: str,
    ) -> str:
        del db
        calls.append((installation_id, setup_action, state))
        return "https://app.example.test/settings/organization"

    async def fail_refresh(db: object) -> None:
        del db
        raise AssertionError("stateful callback must not use the stateless refresh path")

    monkeypatch.setattr(service, "complete_github_app_installation_callback", fake_stateful)
    monkeypatch.setattr(service, "refresh_github_app_installation_cache", fail_refresh)

    url = await service.complete_github_app_installation_redirect(
        object(),
        installation_id="123",
        setup_action="install",
        state="signed-state",
    )

    assert url == "https://app.example.test/settings/organization"
    assert calls == [("123", "install", "signed-state")]
