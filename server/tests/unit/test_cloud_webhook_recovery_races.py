from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.constants.billing import USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT
from proliferate.server.cloud.webhooks import service as webhook_service


@pytest.mark.parametrize(
    "event_type",
    ("sandbox.lifecycle.paused", "sandbox.lifecycle.timeout"),
)
@pytest.mark.asyncio
async def test_ready_retry_watermark_rejects_delayed_terminal_event(
    monkeypatch: pytest.MonkeyPatch,
    event_type: str,
) -> None:
    retry_started_at = datetime(2026, 7, 17, 12, tzinfo=UTC)
    sandbox = _sandbox(
        attempt=8,
        provider_observed_at=retry_started_at,
    )
    receipts: list[str] = []

    async def _load(*_args: object, **_kwargs: object) -> object:
        return sandbox

    async def _remember(*_args: object, event_id: str, **_kwargs: object) -> bool:
        receipts.append(event_id)
        return True

    async def _unexpected(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("the retry watermark must reject the delayed event")

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_provider_sandbox_id",
        _load,
    )
    monkeypatch.setattr(webhook_service, "remember_sandbox_event_receipt", _remember)
    monkeypatch.setattr(
        webhook_service,
        "apply_cloud_sandbox_provider_observation",
        _unexpected,
    )
    monkeypatch.setattr(webhook_service, "close_usage_segment_for_sandbox", _unexpected)

    event_id = f"evt-{uuid4()}"
    receipt = await webhook_service.handle_e2b_webhook(
        object(),
        payload=_payload(
            event_id=event_id,
            event_type=event_type,
            sandbox_id=sandbox.e2b_sandbox_id,
            timestamp=retry_started_at - timedelta(microseconds=1),
        ),
        signature=None,
    )

    assert receipt.received is True
    assert receipts == [event_id]


@pytest.mark.parametrize(
    "event_type",
    ("sandbox.lifecycle.paused", "sandbox.lifecycle.timeout"),
)
@pytest.mark.asyncio
async def test_ready_retry_attempt_cas_rejects_stale_terminal_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    event_type: str,
) -> None:
    event_time = datetime(2026, 7, 17, 12, tzinfo=UTC)
    stale_snapshot = _sandbox(
        attempt=11,
        provider_observed_at=event_time - timedelta(seconds=1),
    )
    observation_calls: list[dict[str, object]] = []

    async def _load(*_args: object, **_kwargs: object) -> object:
        return stale_snapshot

    async def _remember(*_args: object, **_kwargs: object) -> bool:
        return True

    async def _lose_attempt_cas(
        *_args: object,
        **kwargs: object,
    ) -> None:
        observation_calls.append(kwargs)
        return None

    async def _unexpected_close(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("a stale attempt must not close the retry's usage")

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_provider_sandbox_id",
        _load,
    )
    monkeypatch.setattr(webhook_service, "remember_sandbox_event_receipt", _remember)
    monkeypatch.setattr(
        webhook_service,
        "apply_cloud_sandbox_provider_observation",
        _lose_attempt_cas,
    )
    monkeypatch.setattr(
        webhook_service,
        "accept_destroyed_cloud_sandbox_provider_observation",
        _lose_attempt_cas,
    )
    monkeypatch.setattr(
        webhook_service,
        "close_usage_segment_for_sandbox",
        _unexpected_close,
    )

    await webhook_service.handle_e2b_webhook(
        object(),
        payload=_payload(
            event_id=f"evt-{uuid4()}",
            event_type=event_type,
            sandbox_id=stale_snapshot.e2b_sandbox_id,
            timestamp=event_time,
        ),
        signature=None,
    )

    assert observation_calls == [
        {
            "status": "paused",
            "expected_provider_sandbox_id": stale_snapshot.e2b_sandbox_id,
            "expected_materialization_attempt": 11,
            "observed_at": event_time,
        },
        {
            "expected_provider_sandbox_id": stale_snapshot.e2b_sandbox_id,
            "expected_materialization_attempt": 11,
            "observed_at": event_time,
        },
    ]


@pytest.mark.asyncio
async def test_spend_hold_orders_commits_lock_provider_and_atomic_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_time = datetime(2026, 7, 17, 12, tzinfo=UTC)
    pause_time = event_time + timedelta(seconds=5)
    sandbox = _sandbox(attempt=3, provider_observed_at=event_time - timedelta(seconds=1))
    trace = _patch_spend_hold_path(
        monkeypatch,
        initial=sandbox,
        current=sandbox,
        pause_time=pause_time,
    )
    event_id = f"evt-{uuid4()}"

    await webhook_service.handle_e2b_webhook(
        object(),
        payload=_payload(
            event_id=event_id,
            event_type="sandbox.lifecycle.resumed",
            sandbox_id=sandbox.e2b_sandbox_id,
            timestamp=event_time,
        ),
        signature=None,
    )

    assert trace.events == [
        "correlate",
        "subject",
        "billing",
        "commit",
        "lock-enter",
        "reload",
        "commit",
        "provider",
        "pause",
        "receipt",
        "state",
        "usage",
        "commit",
        "lock-exit",
    ]
    assert trace.committed_receipts == {event_id}
    assert trace.observations == [
        {
            "status": "paused",
            "expected_provider_sandbox_id": sandbox.e2b_sandbox_id,
            "expected_materialization_attempt": sandbox.materialization_attempt,
            "observed_at": pause_time,
        }
    ]
    assert trace.closures == [
        {
            "sandbox_id": sandbox.id,
            "ended_at": pause_time,
            "closed_by": USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
            "event_id": event_id,
            "expected_external_sandbox_id": sandbox.e2b_sandbox_id,
        }
    ]


@pytest.mark.parametrize("changed_field", ("binding", "attempt", "watermark"))
@pytest.mark.asyncio
async def test_spend_hold_reloads_and_rejects_changed_retry_authority(
    monkeypatch: pytest.MonkeyPatch,
    changed_field: str,
) -> None:
    event_time = datetime(2026, 7, 17, 12, tzinfo=UTC)
    initial = _sandbox(attempt=5, provider_observed_at=event_time - timedelta(seconds=1))
    current = _sandbox(
        attempt=initial.materialization_attempt,
        provider_observed_at=(
            event_time if changed_field == "watermark" else event_time - timedelta(seconds=1)
        ),
        sandbox_id=initial.id,
        provider_sandbox_id=initial.e2b_sandbox_id,
    )
    if changed_field == "binding":
        current.e2b_sandbox_id = "sandbox-replacement"
    elif changed_field == "attempt":
        current.materialization_attempt += 1
    trace = _patch_spend_hold_path(
        monkeypatch,
        initial=initial,
        current=current,
        pause_time=event_time + timedelta(seconds=5),
    )
    event_id = f"evt-{uuid4()}"

    await webhook_service.handle_e2b_webhook(
        object(),
        payload=_payload(
            event_id=event_id,
            event_type="sandbox.lifecycle.resumed",
            sandbox_id=initial.e2b_sandbox_id,
            timestamp=event_time,
        ),
        signature=None,
    )

    assert trace.events == [
        "correlate",
        "subject",
        "billing",
        "commit",
        "lock-enter",
        "reload",
        "receipt",
        "commit",
        "lock-exit",
    ]
    assert trace.committed_receipts == {event_id}
    assert trace.observations == []
    assert trace.closures == []


@pytest.mark.asyncio
async def test_spend_hold_provider_failure_does_not_process_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_time = datetime(2026, 7, 17, 12, tzinfo=UTC)
    sandbox = _sandbox(attempt=2, provider_observed_at=event_time - timedelta(seconds=1))
    trace = _patch_spend_hold_path(
        monkeypatch,
        initial=sandbox,
        current=sandbox,
        pause_time=event_time + timedelta(seconds=5),
        pause_error=_ProviderPauseFailed("provider unavailable"),
    )

    with pytest.raises(_ProviderPauseFailed, match="provider unavailable"):
        await webhook_service.handle_e2b_webhook(
            object(),
            payload=_payload(
                event_id=f"evt-{uuid4()}",
                event_type="sandbox.lifecycle.resumed",
                sandbox_id=sandbox.e2b_sandbox_id,
                timestamp=event_time,
            ),
            signature=None,
        )

    assert trace.events == [
        "correlate",
        "subject",
        "billing",
        "commit",
        "lock-enter",
        "reload",
        "commit",
        "provider",
        "pause",
        "lock-exit",
    ]
    assert trace.committed_receipts == set()
    assert trace.staged_receipts == set()
    assert trace.observations == []
    assert trace.closures == []


@pytest.mark.asyncio
async def test_spend_hold_post_pause_crash_does_not_commit_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_time = datetime(2026, 7, 17, 12, tzinfo=UTC)
    sandbox = _sandbox(attempt=2, provider_observed_at=event_time - timedelta(seconds=1))
    trace = _patch_spend_hold_path(
        monkeypatch,
        initial=sandbox,
        current=sandbox,
        pause_time=event_time + timedelta(seconds=5),
        observation_error=_StateWriteCrashed("database unavailable"),
    )
    event_id = f"evt-{uuid4()}"

    with pytest.raises(_StateWriteCrashed, match="database unavailable"):
        await webhook_service.handle_e2b_webhook(
            object(),
            payload=_payload(
                event_id=event_id,
                event_type="sandbox.lifecycle.resumed",
                sandbox_id=sandbox.e2b_sandbox_id,
                timestamp=event_time,
            ),
            signature=None,
        )

    assert trace.events == [
        "correlate",
        "subject",
        "billing",
        "commit",
        "lock-enter",
        "reload",
        "commit",
        "provider",
        "pause",
        "receipt",
        "state",
        "lock-exit",
    ]
    assert trace.committed_receipts == set()
    assert trace.staged_receipts == {event_id}
    assert trace.closures == []


@dataclass
class _SpendHoldTrace:
    events: list[str] = field(default_factory=list)
    staged_receipts: set[str] = field(default_factory=set)
    committed_receipts: set[str] = field(default_factory=set)
    observations: list[dict[str, object]] = field(default_factory=list)
    closures: list[dict[str, object]] = field(default_factory=list)


class _ProviderPauseFailed(RuntimeError):
    pass


class _StateWriteCrashed(RuntimeError):
    pass


def _patch_spend_hold_path(
    monkeypatch: pytest.MonkeyPatch,
    *,
    initial: SimpleNamespace,
    current: SimpleNamespace,
    pause_time: datetime,
    pause_error: BaseException | None = None,
    observation_error: BaseException | None = None,
) -> _SpendHoldTrace:
    trace = _SpendHoldTrace()

    async def _correlate(*_args: object, **_kwargs: object) -> object:
        trace.events.append("correlate")
        return initial

    async def _subject(*_args: object, **_kwargs: object) -> object:
        trace.events.append("subject")
        return SimpleNamespace(id=uuid4())

    async def _billing(*_args: object, **_kwargs: object) -> object:
        trace.events.append("billing")
        return SimpleNamespace(billing_mode="enforce", active_spend_hold=True)

    async def _commit(*_args: object, **_kwargs: object) -> None:
        trace.events.append("commit")
        trace.committed_receipts.update(trace.staged_receipts)
        trace.staged_receipts.clear()

    @asynccontextmanager
    async def _lock(key: str):  # type: ignore[no-untyped-def]
        assert key == f"cloud-sandbox:{initial.id}"
        trace.events.append("lock-enter")
        try:
            yield
        finally:
            trace.events.append("lock-exit")

    async def _reload(*_args: object, **kwargs: object) -> object:
        assert kwargs == {"refresh": True}
        trace.events.append("reload")
        return current

    class _Provider:
        async def pause_sandbox(self, sandbox_id: str) -> None:
            assert sandbox_id == initial.e2b_sandbox_id
            trace.events.append("pause")
            if pause_error is not None:
                raise pause_error

    def _provider(name: str) -> object:
        assert name == "e2b"
        trace.events.append("provider")
        return _Provider()

    async def _remember(*_args: object, event_id: str, **_kwargs: object) -> bool:
        trace.events.append("receipt")
        trace.staged_receipts.add(event_id)
        return True

    async def _observe(*_args: object, **kwargs: object) -> object:
        trace.events.append("state")
        trace.observations.append(kwargs)
        if observation_error is not None:
            raise observation_error
        return current

    async def _close(*_args: object, **kwargs: object) -> None:
        trace.events.append("usage")
        trace.closures.append(kwargs)

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_provider_sandbox_id",
        _correlate,
    )
    monkeypatch.setattr(webhook_service, "ensure_personal_billing_subject", _subject)
    monkeypatch.setattr(webhook_service, "get_billing_snapshot_for_subject", _billing)
    monkeypatch.setattr(webhook_service, "commit_webhook_phase", _commit)
    monkeypatch.setattr(webhook_service.locks, "redis_materialization_lock", _lock)
    monkeypatch.setattr(webhook_service, "load_cloud_sandbox_by_id", _reload)
    monkeypatch.setattr(webhook_service, "get_sandbox_provider", _provider)
    monkeypatch.setattr(webhook_service, "remember_sandbox_event_receipt", _remember)
    monkeypatch.setattr(
        webhook_service,
        "apply_cloud_sandbox_provider_observation",
        _observe,
    )
    monkeypatch.setattr(webhook_service, "close_usage_segment_for_sandbox", _close)
    monkeypatch.setattr(webhook_service, "utcnow", lambda: pause_time)
    return trace


def _sandbox(
    *,
    attempt: int,
    provider_observed_at: datetime,
    sandbox_id: object | None = None,
    provider_sandbox_id: str = "sandbox-123",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=sandbox_id or uuid4(),
        owner_user_id=uuid4(),
        status="ready",
        materialization_attempt=attempt,
        destroyed_at=None,
        provider_observed_at=provider_observed_at,
        e2b_sandbox_id=provider_sandbox_id,
    )


def _payload(
    *,
    event_id: str,
    event_type: str,
    sandbox_id: str,
    timestamp: datetime,
) -> bytes:
    return json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "sandboxId": sandbox_id,
            "timestamp": timestamp.isoformat(),
            "eventData": {"sandbox_metadata": {}},
        }
    ).encode()
