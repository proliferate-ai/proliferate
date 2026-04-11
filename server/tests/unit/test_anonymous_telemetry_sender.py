from __future__ import annotations

import asyncio
from collections.abc import Sequence
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest

from proliferate.integrations import anonymous_telemetry
from proliferate.server.anonymous_telemetry.service import AnonymousTelemetryEvent, VersionPayload


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[httpx.Response]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append((url, dict(kwargs)))
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_emit_server_anonymous_version_uses_local_service_in_hosted_product(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_uuid = uuid4()
    record_mock = AsyncMock()
    payload = VersionPayload(app_version="0.1.11", platform="darwin", arch="arm64")

    monkeypatch.setattr(
        anonymous_telemetry,
        "load_or_create_local_install_id",
        AsyncMock(return_value=install_uuid),
    )
    monkeypatch.setattr(
        anonymous_telemetry,
        "record_anonymous_telemetry",
        record_mock,
    )
    monkeypatch.setattr(
        anonymous_telemetry,
        "get_server_telemetry_mode",
        lambda: "hosted_product",
    )
    monkeypatch.setattr(
        anonymous_telemetry,
        "is_anonymous_telemetry_enabled",
        lambda: True,
    )
    monkeypatch.setattr(anonymous_telemetry, "_version_payload", lambda: payload)

    def _unexpected_client(**_kwargs: object) -> _FakeAsyncClient:
        raise AssertionError("remote HTTP should not be used in hosted_product mode")

    monkeypatch.setattr(anonymous_telemetry.httpx, "AsyncClient", _unexpected_client)

    await anonymous_telemetry.emit_server_anonymous_version()

    record_mock.assert_awaited_once()
    event = record_mock.await_args.args[0]
    assert isinstance(event, AnonymousTelemetryEvent)
    assert event.install_uuid == install_uuid
    assert event.surface == "server"
    assert event.telemetry_mode == "hosted_product"
    assert event.record_type == "VERSION"
    assert event.payload == payload


@pytest.mark.asyncio
async def test_emit_server_anonymous_version_posts_remote_in_self_managed_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_uuid = uuid4()
    payload = VersionPayload(app_version="0.1.11", platform="linux", arch="x86_64")
    fake_client = _FakeAsyncClient(
        [
            httpx.Response(
                202,
                request=httpx.Request(
                    "POST",
                    "https://collector.example/v1/telemetry/anonymous",
                ),
            )
        ]
    )

    monkeypatch.setattr(
        anonymous_telemetry,
        "load_or_create_local_install_id",
        AsyncMock(return_value=install_uuid),
    )
    monkeypatch.setattr(
        anonymous_telemetry,
        "get_server_telemetry_mode",
        lambda: "self_managed",
    )
    monkeypatch.setattr(
        anonymous_telemetry,
        "is_anonymous_telemetry_enabled",
        lambda: True,
    )
    monkeypatch.setattr(anonymous_telemetry, "_version_payload", lambda: payload)
    monkeypatch.setattr(
        anonymous_telemetry.settings,
        "anonymous_telemetry_endpoint",
        "https://collector.example/v1/telemetry/anonymous",
    )
    monkeypatch.setattr(
        anonymous_telemetry.httpx,
        "AsyncClient",
        lambda **_kwargs: fake_client,
    )

    record_mock = AsyncMock()
    monkeypatch.setattr(
        anonymous_telemetry,
        "record_anonymous_telemetry",
        record_mock,
    )

    await anonymous_telemetry.emit_server_anonymous_version()

    record_mock.assert_not_awaited()
    assert len(fake_client.calls) == 1
    url, kwargs = fake_client.calls[0]
    assert url == "https://collector.example/v1/telemetry/anonymous"
    assert kwargs["json"] == {
        "installUuid": str(install_uuid),
        "surface": "server",
        "telemetryMode": "self_managed",
        "recordType": "VERSION",
        "payload": {
            "appVersion": "0.1.11",
            "platform": "linux",
            "arch": "x86_64",
        },
    }


@pytest.mark.asyncio
async def test_sender_loop_captures_recovered_heartbeat_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture_mock = Mock()

    async def _boom() -> None:
        raise RuntimeError("collector offline")

    async def _stop(_seconds: float) -> None:
        raise asyncio.CancelledError()

    monkeypatch.setattr(anonymous_telemetry, "emit_server_anonymous_version", _boom)
    monkeypatch.setattr(
        anonymous_telemetry,
        "capture_server_sentry_exception",
        capture_mock,
    )
    monkeypatch.setattr(anonymous_telemetry.asyncio, "sleep", _stop)

    with pytest.raises(asyncio.CancelledError):
        await anonymous_telemetry._sender_loop()

    capture_mock.assert_called_once()
    assert capture_mock.call_args.args[0].args == ("collector offline",)
    assert capture_mock.call_args.kwargs["tags"] == {
        "domain": "anonymous_telemetry",
        "action": "heartbeat_start",
    }


@pytest.mark.asyncio
async def test_start_sender_does_not_wait_for_initial_emit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()

    async def _block_forever() -> None:
        started.set()
        await asyncio.Future()

    monkeypatch.setattr(
        anonymous_telemetry,
        "is_anonymous_telemetry_enabled",
        lambda: True,
    )
    monkeypatch.setattr(anonymous_telemetry, "emit_server_anonymous_version", _block_forever)

    task = await asyncio.wait_for(
        anonymous_telemetry.start_server_anonymous_telemetry_sender(),
        timeout=0.1,
    )

    assert task is not None
    await asyncio.wait_for(started.wait(), timeout=0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
