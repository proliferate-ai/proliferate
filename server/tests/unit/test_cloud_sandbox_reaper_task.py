"""Beat-fired orphan-reap task wrapper + schedule gate (P2-002)."""

from __future__ import annotations

import pytest

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.config import CLOUD_SANDBOX_ORPHAN_REAP_TASK
from proliferate.background.tasks import cloud_sandboxes as reap_task
from proliferate.config import Settings


def _test_settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "_env_file": None,
        "debug": True,
        "jwt_secret": "test-secret",
        "cloud_secret_key": "test-cloud-secret",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def test_task_registered_on_celery_app() -> None:
    from proliferate.background.celery_app import celery_app

    assert CLOUD_SANDBOX_ORPHAN_REAP_TASK in celery_app.tasks


def test_task_wrapper_runs_the_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[bool] = []

    async def _fake_pass() -> None:
        calls.append(True)

    # Patch the pass the wrapper imported; the wrapper drives it via asyncio.run.
    monkeypatch.setattr(reap_task, "run_orphan_sandbox_reap_pass", _fake_pass)

    assert reap_task.cloud_sandbox_orphan_reap() == "ok"
    assert calls == [True]


def test_beat_gate_present_when_provisioning_configured() -> None:
    # debug=True + an api key makes cloud_provisioning_configured True.
    config = _test_settings(e2b_api_key="e2b_test_key")
    assert config.cloud_provisioning_configured is True

    schedule = build_beat_schedule(config)
    assert "cloud-sandbox-orphan-reap" in schedule
    assert schedule["cloud-sandbox-orphan-reap"]["task"] == CLOUD_SANDBOX_ORPHAN_REAP_TASK


def test_beat_gate_absent_when_provisioning_unconfigured() -> None:
    config = _test_settings(e2b_api_key="")
    assert config.cloud_provisioning_configured is False

    schedule = build_beat_schedule(config)
    assert "cloud-sandbox-orphan-reap" not in schedule
