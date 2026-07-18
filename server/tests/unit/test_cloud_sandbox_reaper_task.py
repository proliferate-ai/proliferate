"""Celery registration and Beat gating for orphan-sandbox cleanup."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.config import CLOUD_SANDBOX_ORPHAN_REAP_TASK
from proliferate.background.tasks import cloud_sandboxes as reap_task
from proliferate.config import Settings


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "_env_file": None,
        "debug": False,
        "jwt_secret": "test-secret",
        "cloud_secret_key": "test-cloud-secret",
    }
    values.update(overrides)
    return Settings(**values)


def test_task_is_registered_and_routed_to_periodic_worker_queue() -> None:
    from proliferate.background.celery_app import celery_app

    assert CLOUD_SANDBOX_ORPHAN_REAP_TASK in celery_app.tasks
    assert celery_app.conf.task_routes[CLOUD_SANDBOX_ORPHAN_REAP_TASK] == {
        "queue": "periodic.default"
    }


def test_task_wrapper_uses_fresh_disposed_engine_on_each_firing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []

    class _Engine:
        def __init__(self, number: int) -> None:
            self.number = number

        async def dispose(self) -> None:
            calls.append(("dispose", self.number))

    class _SessionContext:
        def __init__(self, engine: _Engine) -> None:
            self.engine = engine

        async def __aenter__(self) -> object:
            calls.append(("enter", self.engine.number))
            return self.engine.number

        async def __aexit__(self, *_args: Any) -> None:
            calls.append(("exit", self.engine.number))

    def _create_engine(*_args: object, **_kwargs: object) -> _Engine:
        engine = _Engine(1 + sum(call[0] == "engine" for call in calls if isinstance(call, tuple)))
        calls.append(("engine", engine.number))
        return engine

    def _sessionmaker(engine: _Engine, **_kwargs: object) -> object:
        return lambda: _SessionContext(engine)

    async def _pass(db: object) -> None:
        calls.append(("pass", db))

    monkeypatch.setattr(reap_task, "create_async_engine", _create_engine)
    monkeypatch.setattr(reap_task, "async_sessionmaker", _sessionmaker)
    monkeypatch.setattr(reap_task, "run_orphan_sandbox_reap_pass", _pass)

    assert reap_task.cloud_sandbox_orphan_reap() == "ok"
    assert reap_task.cloud_sandbox_orphan_reap() == "ok"
    assert calls == [
        ("engine", 1),
        ("enter", 1),
        ("pass", 1),
        ("exit", 1),
        ("dispose", 1),
        ("engine", 2),
        ("enter", 2),
        ("pass", 2),
        ("exit", 2),
        ("dispose", 2),
    ]


def test_beat_registers_reaper_only_for_complete_e2b_configuration() -> None:
    configured = _settings(e2b_api_key="secret", e2b_template_name="team/template:production")
    missing_key = _settings(e2b_api_key="", e2b_template_name="team/template:production")
    missing_template = _settings(e2b_api_key="secret", e2b_template_name="")
    whitespace_template = _settings(e2b_api_key="secret", e2b_template_name=" ")

    configured_schedule = build_beat_schedule(configured)
    assert configured_schedule["cloud-sandbox-orphan-reap"]["task"] == (
        CLOUD_SANDBOX_ORPHAN_REAP_TASK
    )
    assert "cloud-sandbox-orphan-reap" not in build_beat_schedule(missing_key)
    assert "cloud-sandbox-orphan-reap" not in build_beat_schedule(missing_template)
    assert "cloud-sandbox-orphan-reap" not in build_beat_schedule(whitespace_template)


def test_reaper_grace_window_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        _settings(cloud_sandbox_reaper_grace_seconds=0)
