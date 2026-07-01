from datetime import UTC, datetime, timedelta
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.config import settings
from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.webhooks import service as webhook_service
from proliferate.server.cloud.webhooks.service import (
    _should_ignore_sandbox_event,
    _verify_e2b_signature,
)


def test_e2b_webhook_translates_signature_failure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")

    with pytest.raises(CloudApiError) as exc_info:
        _verify_e2b_signature(b"{}", "bad-signature")

    assert exc_info.value.code == "invalid_webhook_signature"
    assert exc_info.value.message == "E2B webhook signature is invalid."
    assert exc_info.value.status_code == 401


def test_provider_event_precedence_ignores_resume_after_pause() -> None:
    event_time = datetime.now(UTC)

    assert _should_ignore_sandbox_event(
        sandbox_status="paused",
        sandbox_destroyed_at=None,
        sandbox_updated_at=event_time,
        event_kind="resumed",
        event_timestamp=event_time,
    )
    assert not _should_ignore_sandbox_event(
        sandbox_status="paused",
        sandbox_destroyed_at=None,
        sandbox_updated_at=event_time,
        event_kind="killed",
        event_timestamp=event_time,
    )
    assert _should_ignore_sandbox_event(
        sandbox_status="destroyed",
        sandbox_destroyed_at=event_time,
        sandbox_updated_at=event_time,
        event_kind="paused",
        event_timestamp=event_time + timedelta(seconds=1),
    )


@pytest.mark.asyncio
async def test_duplicate_e2b_webhook_returns_before_state_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_id = f"evt-{uuid4()}"
    payload = _webhook_payload(
        event_id=event_id,
        event_type="sandbox.lifecycle.killed",
        sandbox_id="sandbox-123",
        timestamp=datetime.now(UTC),
    )

    async def _remember_sandbox_event_receipt(*_args: object, **_kwargs: object) -> bool:
        return False

    async def _unexpected(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("duplicate webhook should stop after receipt dedupe")

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "remember_sandbox_event_receipt",
        _remember_sandbox_event_receipt,
    )
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_provider_sandbox_id",
        _unexpected,
    )

    receipt = await webhook_service.handle_e2b_webhook(object(), payload=payload, signature=None)

    assert receipt.received is True


@pytest.mark.asyncio
async def test_killed_e2b_webhook_closes_usage_and_marks_destroyed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_time = datetime.now(UTC)
    sandbox = _sandbox(status="ready", updated_at=event_time)
    closed_segments: list[dict[str, object]] = []
    sandbox_state_updates: list[dict[str, object]] = []

    _patch_webhook_state(
        monkeypatch,
        sandbox=sandbox,
        closed_segments=closed_segments,
        sandbox_state_updates=sandbox_state_updates,
    )

    receipt = await webhook_service.handle_e2b_webhook(
        object(),
        payload=_webhook_payload(
            event_type="sandbox.lifecycle.killed",
            sandbox_id=sandbox.e2b_sandbox_id,
            timestamp=event_time,
            cloud_sandbox_id=str(sandbox.id),
        ),
        signature=None,
    )

    assert receipt.received is True
    assert closed_segments[-1]["closed_by"] == USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED
    assert sandbox_state_updates[-1] == {"status": "destroyed"}


@pytest.mark.asyncio
async def test_timeout_e2b_webhook_closes_usage_as_paused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_time = datetime.now(UTC)
    sandbox = _sandbox(status="ready", updated_at=event_time)
    closed_segments: list[dict[str, object]] = []
    sandbox_state_updates: list[dict[str, object]] = []

    _patch_webhook_state(
        monkeypatch,
        sandbox=sandbox,
        closed_segments=closed_segments,
        sandbox_state_updates=sandbox_state_updates,
    )

    receipt = await webhook_service.handle_e2b_webhook(
        object(),
        payload=_webhook_payload(
            event_type="sandbox.lifecycle.timeout",
            sandbox_id=sandbox.e2b_sandbox_id,
            timestamp=event_time,
            cloud_sandbox_id=str(sandbox.id),
        ),
        signature=None,
    )

    assert receipt.received is True
    assert closed_segments[-1]["closed_by"] == USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT
    assert sandbox_state_updates[-1] == {"status": "paused"}


def _sandbox(*, status: str, updated_at: datetime) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        owner_user_id=uuid4(),
        status=status,
        destroyed_at=None,
        updated_at=updated_at,
        e2b_sandbox_id="sandbox-123",
    )


def _webhook_payload(
    *,
    event_type: str,
    sandbox_id: str,
    timestamp: datetime,
    event_id: str | None = None,
    cloud_sandbox_id: str | None = None,
) -> bytes:
    metadata = {"cloud_sandbox_id": cloud_sandbox_id} if cloud_sandbox_id else {}
    return json.dumps(
        {
            "id": event_id or f"evt-{uuid4()}",
            "type": event_type,
            "sandboxId": sandbox_id,
            "timestamp": timestamp.isoformat(),
            "eventData": {"sandbox_metadata": metadata},
        }
    ).encode()


def _patch_webhook_state(
    monkeypatch: pytest.MonkeyPatch,
    *,
    sandbox: SimpleNamespace,
    closed_segments: list[dict[str, object]],
    sandbox_state_updates: list[dict[str, object]],
) -> None:
    async def _remember_sandbox_event_receipt(*_args: object, **_kwargs: object) -> bool:
        return True

    async def _load_cloud_sandbox_by_provider_sandbox_id(
        _db: object,
        _provider_sandbox_id: str,
    ) -> object:
        return sandbox

    async def _mark_cloud_sandbox_provider_state(
        _db: object,
        _sandbox_id: object,
        **kwargs: object,
    ) -> None:
        sandbox_state_updates.append(kwargs)

    async def _close_usage_segment_for_sandbox(*_args: object, **kwargs: object) -> None:
        closed_segments.append(kwargs)

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "remember_sandbox_event_receipt",
        _remember_sandbox_event_receipt,
    )
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_provider_sandbox_id",
        _load_cloud_sandbox_by_provider_sandbox_id,
    )
    monkeypatch.setattr(
        webhook_service,
        "mark_cloud_sandbox_provider_state",
        _mark_cloud_sandbox_provider_state,
    )
    monkeypatch.setattr(
        webhook_service,
        "close_usage_segment_for_sandbox",
        _close_usage_segment_for_sandbox,
    )
