"""Ambiguous preflight commits preserve classified materialization receipts."""

from __future__ import annotations

from typing import Any

import pytest

from proliferate.db.store.billing_runtime_usage import UsageProviderBindingMismatchError
from proliferate.server.cloud.materialization import failures
from proliferate.server.cloud.materialization.sandbox_io import connect
from tests.unit.test_cloud_connect_race import (
    _FakeDb,
    _FakeProvider,
    _copy_sandbox,
    _patch_connect_prelude,
    _sandbox,
)

MISMATCH_RECEIPT = (
    "Sandbox usage attribution conflicts with its provider binding. Contact support."
)


@pytest.mark.parametrize("commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_mismatch_preflight_commit_ambiguity_keeps_exact_support_receipt(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
) -> None:
    events: list[str] = []
    prior = _sandbox(provider_sandbox_id="sbx-existing", attempt=6)
    attempted = _copy_sandbox(prior, materialization_attempt=7)
    state: dict[str, Any] = {
        "durable_attempt": 6,
        "staged_attempt": 6,
        "receipt": "prior-attempt-receipt",
    }

    def _apply_state() -> None:
        state["durable_attempt"] = state["staged_attempt"]

    def _rollback_state() -> None:
        state["staged_attempt"] = state["durable_attempt"]

    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=2,
        apply_usage_before_failure=commit_applied,
        apply_state=_apply_state,
        rollback_state=_rollback_state,
    )
    _patch_connect_prelude(monkeypatch, sandbox=attempted, provider=provider)

    async def _begin_retry(*_args: Any, **_kwargs: Any) -> object:
        state["staged_attempt"] = attempted.materialization_attempt
        return attempted

    async def _mismatch(*_args: Any, **_kwargs: Any) -> None:
        raise UsageProviderBindingMismatchError("concrete provider mismatch")

    async def _mark_failure(
        _db: object,
        _sandbox_id: object,
        *,
        expected_materialization_attempt: int,
        last_error: str,
        **_kwargs: Any,
    ) -> object | None:
        if state["durable_attempt"] != expected_materialization_attempt:
            events.append("attempt_cas_miss")
            return None
        state["receipt"] = last_error
        events.append("attempt_terminal_receipt")
        return attempted

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "begin_cloud_sandbox_materialization_retry",
        _begin_retry,
    )
    monkeypatch.setattr(connect, "converge_cloud_sandbox_provider_usage", _mismatch)
    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark_failure)

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=prior)

    assert not any(event.startswith("provider_") for event in events)
    if commit_applied:
        assert state == {
            "durable_attempt": 7,
            "staged_attempt": 7,
            "receipt": MISMATCH_RECEIPT,
        }
        assert "attempt_terminal_receipt" in events
    else:
        assert state == {
            "durable_attempt": 6,
            "staged_attempt": 6,
            "receipt": "prior-attempt-receipt",
        }
        assert "attempt_cas_miss" in events
