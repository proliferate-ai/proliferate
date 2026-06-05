from datetime import UTC, datetime
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.config import settings
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.webhooks import service as webhook_service
from proliferate.server.cloud.webhooks.service import (
    _is_stale_provider_event,
    _verify_e2b_signature,
)


def test_e2b_webhook_translates_signature_failure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "e2b_webhook_signature_secret", "test-secret")

    with pytest.raises(CloudApiError) as exc_info:
        _verify_e2b_signature(b"{}", "bad-signature")

    assert exc_info.value.code == "invalid_webhook_signature"
    assert exc_info.value.message == "E2B webhook signature is invalid."
    assert exc_info.value.status_code == 401


def test_provider_event_precedence_keeps_same_timestamp_terminal_event() -> None:
    event_time = datetime.now(UTC)

    assert (
        _is_stale_provider_event(
            last_event_at=event_time,
            last_event_kind="paused",
            incoming_event_at=event_time,
            incoming_event_kind="killed",
        )
        is False
    )
    assert (
        _is_stale_provider_event(
            last_event_at=event_time,
            last_event_kind="killed",
            incoming_event_at=event_time,
            incoming_event_kind="paused",
        )
        is True
    )


@pytest.mark.asyncio
async def test_duplicate_e2b_webhook_returns_before_state_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_id = f"evt-{uuid4()}"
    payload = json.dumps(
        {
            "id": event_id,
            "type": "sandbox.lifecycle.killed",
            "sandboxId": "sandbox-123",
            "timestamp": datetime.now(UTC).isoformat(),
            "eventData": {"sandbox_metadata": {}},
        }
    ).encode()

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
    monkeypatch.setattr(webhook_service, "load_cloud_sandbox_by_external_id", _unexpected)

    receipt = await webhook_service.handle_e2b_webhook(object(), payload=payload, signature=None)

    assert receipt.received is True


@pytest.mark.asyncio
async def test_killed_e2b_webhook_clears_runtime_metadata_and_increments_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox_id = uuid4()
    runtime_environment_id = uuid4()
    event_time = datetime.now(UTC)
    payload = json.dumps(
        {
            "id": f"evt-{uuid4()}",
            "type": "sandbox.lifecycle.killed",
            "sandboxId": "sandbox-123",
            "timestamp": event_time.isoformat(),
            "eventData": {"sandbox_metadata": {"cloud_sandbox_id": str(sandbox_id)}},
        }
    ).encode()
    sandbox = SimpleNamespace(
        id=sandbox_id,
        provider="e2b",
        external_sandbox_id="sandbox-123",
        last_provider_event_at=None,
        last_provider_event_kind=None,
    )
    runtime_environment = SimpleNamespace(id=runtime_environment_id)
    sandbox_state_updates: list[dict[str, object]] = []
    runtime_state_updates: list[dict[str, object]] = []

    async def _remember_sandbox_event_receipt(*_args: object, **_kwargs: object) -> bool:
        return True

    async def _load_cloud_sandbox_by_external_id(_db: object, _external_sandbox_id: str) -> object:
        return sandbox

    async def _load_sandbox_runtime_owner(
        _db: object, _sandbox_id: object
    ) -> tuple[object, object | None]:
        assert _sandbox_id == sandbox_id
        return runtime_environment, None

    async def _save_sandbox_provider_state(
        _db: object,
        _sandbox_id: object,
        **kwargs: object,
    ) -> None:
        sandbox_state_updates.append(kwargs)

    async def _close_usage_segment_for_sandbox(*_args: object, **_kwargs: object) -> None:
        return None

    async def _save_runtime_environment_state(
        _db: object,
        _runtime_environment_id: object,
        **kwargs: object,
    ) -> None:
        runtime_state_updates.append(kwargs)

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "remember_sandbox_event_receipt",
        _remember_sandbox_event_receipt,
    )
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_external_id",
        _load_cloud_sandbox_by_external_id,
    )
    monkeypatch.setattr(
        webhook_service,
        "_load_sandbox_runtime_owner",
        _load_sandbox_runtime_owner,
    )
    monkeypatch.setattr(
        webhook_service,
        "save_sandbox_provider_state",
        _save_sandbox_provider_state,
    )
    monkeypatch.setattr(
        webhook_service,
        "close_usage_segment_for_sandbox",
        _close_usage_segment_for_sandbox,
    )
    monkeypatch.setattr(
        webhook_service,
        "save_runtime_environment_state",
        _save_runtime_environment_state,
    )

    receipt = await webhook_service.handle_e2b_webhook(object(), payload=payload, signature=None)

    assert receipt.received is True
    assert sandbox_state_updates[-1] == {
        "status": "destroyed",
        "stopped_at": event_time,
        "last_provider_event_at": event_time,
        "last_provider_event_kind": "killed",
    }
    assert runtime_state_updates == [
        {
            "status": "error",
            "runtime_url": None,
            "runtime_token_ciphertext": None,
            "active_sandbox_id": None,
            "increment_runtime_generation": True,
            "last_error": "Provider reported sandbox killed.",
        }
    ]


@pytest.mark.asyncio
async def test_timeout_e2b_webhook_closes_usage_as_paused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox_id = uuid4()
    runtime_environment_id = uuid4()
    event_time = datetime.now(UTC)
    payload = json.dumps(
        {
            "id": f"evt-{uuid4()}",
            "type": "sandbox.lifecycle.timeout",
            "sandboxId": "sandbox-123",
            "timestamp": event_time.isoformat(),
            "eventData": {"sandbox_metadata": {"cloud_sandbox_id": str(sandbox_id)}},
        }
    ).encode()
    sandbox = SimpleNamespace(
        id=sandbox_id,
        provider="e2b",
        external_sandbox_id="sandbox-123",
        last_provider_event_at=None,
        last_provider_event_kind=None,
    )
    runtime_environment = SimpleNamespace(id=runtime_environment_id)
    closed_segments: list[dict[str, object]] = []
    sandbox_state_updates: list[dict[str, object]] = []
    runtime_state_updates: list[dict[str, object]] = []

    async def _remember_sandbox_event_receipt(*_args: object, **_kwargs: object) -> bool:
        return True

    async def _load_cloud_sandbox_by_external_id(_db: object, _external_sandbox_id: str) -> object:
        return sandbox

    async def _load_sandbox_runtime_owner(
        _db: object, _sandbox_id: object
    ) -> tuple[object, object | None]:
        assert _sandbox_id == sandbox_id
        return runtime_environment, None

    async def _save_sandbox_provider_state(
        _db: object,
        _sandbox_id: object,
        **kwargs: object,
    ) -> None:
        sandbox_state_updates.append(kwargs)

    async def _close_usage_segment_for_sandbox(*_args: object, **kwargs: object) -> None:
        closed_segments.append(kwargs)

    async def _save_runtime_environment_state(
        _db: object,
        _runtime_environment_id: object,
        **kwargs: object,
    ) -> None:
        runtime_state_updates.append(kwargs)

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(
        webhook_service,
        "remember_sandbox_event_receipt",
        _remember_sandbox_event_receipt,
    )
    monkeypatch.setattr(
        webhook_service,
        "load_cloud_sandbox_by_external_id",
        _load_cloud_sandbox_by_external_id,
    )
    monkeypatch.setattr(
        webhook_service,
        "_load_sandbox_runtime_owner",
        _load_sandbox_runtime_owner,
    )
    monkeypatch.setattr(
        webhook_service,
        "save_sandbox_provider_state",
        _save_sandbox_provider_state,
    )
    monkeypatch.setattr(
        webhook_service,
        "close_usage_segment_for_sandbox",
        _close_usage_segment_for_sandbox,
    )
    monkeypatch.setattr(
        webhook_service,
        "save_runtime_environment_state",
        _save_runtime_environment_state,
    )

    receipt = await webhook_service.handle_e2b_webhook(object(), payload=payload, signature=None)

    assert receipt.received is True
    assert closed_segments[-1]["closed_by"] == "webhook_timeout"
    assert sandbox_state_updates[-1] == {
        "status": "paused",
        "stopped_at": event_time,
        "last_provider_event_at": event_time,
        "last_provider_event_kind": "timeout",
    }
    assert runtime_state_updates[-1]["status"] == "paused"
