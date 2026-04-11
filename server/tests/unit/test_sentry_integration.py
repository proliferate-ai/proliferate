from __future__ import annotations

from contextlib import contextmanager

import pytest

from proliferate.config import settings
from proliferate.integrations import sentry as sentry_integration


class _FakeScope:
    def __init__(self) -> None:
        self.level: str | None = None
        self.fingerprint: list[str] | None = None
        self.tags: dict[str, str] = {}
        self.extras: dict[str, object] = {}

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value

    def set_extra(self, key: str, value: object) -> None:
        self.extras[key] = value


class _FakeSentrySdk:
    def __init__(self) -> None:
        self.user: dict[str, str] | None = None
        self.current_scope: _FakeScope | None = None
        self.captured: list[tuple[Exception, _FakeScope | None]] = []

    def set_user(self, value: dict[str, str]) -> None:
        self.user = value

    @contextmanager
    def push_scope(self):
        previous = self.current_scope
        scope = _FakeScope()
        self.current_scope = scope
        try:
            yield scope
        finally:
            self.current_scope = previous

    def capture_exception(self, error: Exception) -> None:
        self.captured.append((error, self.current_scope))


def test_set_server_sentry_user_sets_id_only(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sdk = _FakeSentrySdk()

    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(sentry_integration, "sentry_sdk", fake_sdk)

    sentry_integration.set_server_sentry_user("user-123")

    assert fake_sdk.user == {"id": "user-123"}


def test_capture_server_sentry_exception_noops_when_vendor_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_sdk = _FakeSentrySdk()

    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "telemetry_mode", "self_managed")
    monkeypatch.setattr(sentry_integration, "sentry_sdk", fake_sdk)

    sentry_integration.capture_server_sentry_exception(RuntimeError("boom"))

    assert fake_sdk.captured == []


def test_capture_server_sentry_exception_scrubs_extras_and_sets_scope_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_sdk = _FakeSentrySdk()

    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(sentry_integration, "sentry_sdk", fake_sdk)

    sentry_integration.capture_server_sentry_exception(
        RuntimeError("boom"),
        level="warning",
        tags={
            "domain": "billing",
        },
        extras={
            "detail": "opened /Users/pablo/proliferate",
            "token": "Bearer secret-token",
        },
        fingerprint=["billing", "reconcile"],
    )

    assert len(fake_sdk.captured) == 1
    captured_error, scope = fake_sdk.captured[0]
    assert str(captured_error) == "boom"
    assert scope is not None
    assert scope.level == "warning"
    assert scope.fingerprint == ["billing", "reconcile"]
    assert scope.tags == {"domain": "billing"}
    assert scope.extras == {
        "detail": "opened [redacted-path]",
        "token": "[redacted]",
    }


def test_init_server_sentry_disables_logging_event_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    init_kwargs: dict[str, object] = {}
    tags: dict[str, str] = {}

    class _FakeInitSentrySdk:
        def init(self, **kwargs: object) -> None:
            init_kwargs.update(kwargs)

        def set_tag(self, key: str, value: str) -> None:
            tags[key] = value

    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(sentry_integration, "_sentry_initialized", False)
    monkeypatch.setattr(sentry_integration, "sentry_sdk", _FakeInitSentrySdk())
    monkeypatch.setattr(
        sentry_integration,
        "LoggingIntegration",
        lambda **kwargs: kwargs,
    )
    monkeypatch.setattr(
        sentry_integration,
        "StarletteIntegration",
        lambda **kwargs: ("starlette", kwargs),
    )
    monkeypatch.setattr(
        sentry_integration,
        "FastApiIntegration",
        lambda **kwargs: ("fastapi", kwargs),
    )

    sentry_integration.init_server_sentry()

    integrations = init_kwargs["integrations"]
    assert isinstance(integrations, list)
    assert integrations[0]["level"] == sentry_integration.logging.INFO
    assert integrations[0]["event_level"] is None
    assert tags == {
        "surface": "cloud_api",
        "telemetry_mode": "hosted_product",
    }
