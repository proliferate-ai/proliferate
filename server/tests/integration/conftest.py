"""Shared fixtures for integration tests."""

from __future__ import annotations

import logging
from collections.abc import Generator

import pytest

from proliferate.config import settings
from tests.integration.agent_gateway_topups_shared import StubLiteLLM, StubStripe


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    stub = StubLiteLLM()
    stub.install(monkeypatch)
    return stub


@pytest.fixture
def stub_stripe(monkeypatch: pytest.MonkeyPatch) -> StubStripe:
    stub = StubStripe()
    stub.install(monkeypatch)
    return stub


@pytest.fixture
def topup_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
    monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "2")
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "10")


@pytest.fixture
def sign_in_log_records() -> Generator[list[logging.LogRecord], None, None]:
    """Capture `proliferate.auth.sign_in` records directly on the leaf logger.

    `caplog` only observes records once they propagate to the root logger,
    and that path is contended: `configure_server_logging()` (invoked by
    every `create_app()`, see `proliferate/middleware/logging.py`) flips the
    ancestor `proliferate` logger's `propagate` to `False` process-wide the
    first time it runs. Pytest's own workaround -- attaching its capture
    handler directly to any logger it finds already at `propagate=False` --
    is a snapshot taken once per test phase, and under `pytest -n` xdist
    workers running hundreds of integration tests back to back on a shared
    session-scoped event loop, that snapshot can race a concurrent fixture
    teardown and miss the attach. The result is an intermittent empty
    `caplog.records` for a correctly emitted record (root-caused on PR #2181,
    shard 3: `assert 0 == 1`, reproduced locally only under `pytest -n 4`
    across the full shard, never with these files run alone or serially).

    Attaching a dedicated handler straight onto the leaf logger sidesteps all
    of that: capture no longer depends on `propagate`, on root-logger
    snapshotting, or on any other test's logging configuration.
    """
    records: list[logging.LogRecord] = []

    class _RecordCollector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    logger = logging.getLogger("proliferate.auth.sign_in")
    handler = _RecordCollector(level=logging.INFO)
    logger.addHandler(handler)
    try:
        yield records
    finally:
        logger.removeHandler(handler)
