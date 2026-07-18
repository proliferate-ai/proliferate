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


def test_task_wrapper_opens_session_and_runs_domain_pass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []
    session = object()

    class _SessionContext:
        async def __aenter__(self) -> object:
            calls.append("enter")
            return session

        async def __aexit__(self, *_args: Any) -> None:
            calls.append("exit")

    async def _pass(db: object) -> None:
        calls.append(db)

    monkeypatch.setattr(reap_task, "async_session_factory", _SessionContext)
    monkeypatch.setattr(reap_task, "run_orphan_sandbox_reap_pass", _pass)

    assert reap_task.cloud_sandbox_orphan_reap() == "ok"
    assert calls == ["enter", session, "exit"]


def test_beat_registers_reaper_only_for_complete_e2b_configuration() -> None:
    configured = _settings(e2b_api_key="secret", e2b_template_name="team/template:production")
    missing_key = _settings(e2b_api_key="", e2b_template_name="team/template:production")
    missing_template = _settings(e2b_api_key="secret", e2b_template_name="")

    configured_schedule = build_beat_schedule(configured)
    assert configured_schedule["cloud-sandbox-orphan-reap"]["task"] == (
        CLOUD_SANDBOX_ORPHAN_REAP_TASK
    )
    assert "cloud-sandbox-orphan-reap" not in build_beat_schedule(missing_key)
    assert "cloud-sandbox-orphan-reap" not in build_beat_schedule(missing_template)


def test_reaper_grace_window_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        _settings(cloud_sandbox_reaper_grace_seconds=0)
