"""Adversarial resource-bound tests for workflow polling."""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from proliferate.lib.infra.bounded_executor import (
    BoundedExecutor,
    BoundedExecutorCapacityError,
)
from proliferate.server.cloud import net_guard
from tests.unit import test_workflow_poll as base

_CountingAsyncByteStream = base._CountingAsyncByteStream
_fake_getaddrinfo = base._fake_getaddrinfo
_mock_client_factory = base._mock_client_factory


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch):  # type: ignore[no-untyped-def]
    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _fake_getaddrinfo)


async def test_fetch_rejects_one_oversized_chunk_before_bytearray_extension() -> None:
    """Reject a huge transport chunk before copying it into the accumulator."""

    from proliferate.constants.workflows import WORKFLOW_POLL_MAX_RESPONSE_BYTES
    from proliferate.integrations.workflow_poll import PollResponseTooLargeError
    from proliferate.server.cloud.workflows.poll_fetch import fetch_poll_page

    stream = _CountingAsyncByteStream(b"x" * (WORKFLOW_POLL_MAX_RESPONSE_BYTES + 1), 2)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, stream=stream))
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollResponseTooLargeError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=endpoint,
            auth=None,
            cursor=None,
        )
    assert stream.pulled == 1


async def test_blocking_parser_hits_total_deadline_and_retains_capacity(monkeypatch) -> None:
    from proliferate.integrations.workflow_poll import (
        PollTimeoutError,
        PollWorkerCapacityError,
    )
    from proliferate.server.cloud.workflows import poll_fetch

    pool = BoundedExecutor(max_workers=1, thread_name_prefix="test-poll-parse-deadline")
    entered = threading.Event()
    release = threading.Event()

    def blocking_parse(_body: bytes):  # type: ignore[no-untyped-def]
        entered.set()
        release.wait(timeout=2)
        return poll_fetch.PollPage(items=[])

    monkeypatch.setattr(poll_fetch, "_POLL_PARSE_EXECUTOR", pool)
    monkeypatch.setattr(poll_fetch, "WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS", 0.05)
    monkeypatch.setattr(
        poll_fetch,
        "fetch_poll_bytes",
        AsyncMock(return_value=b'{"items":[]}'),
    )
    monkeypatch.setattr(poll_fetch.PollPage, "model_validate_json", blocking_parse)
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    started = time.monotonic()
    try:
        with pytest.raises(PollTimeoutError):
            await poll_fetch.fetch_poll_page(
                url="https://issues.example/feed",
                endpoint=endpoint,
                auth=None,
                cursor=None,
            )
        assert time.monotonic() - started < 0.25
        assert entered.is_set()

        # Timeout cancelled the waiter, not the thread. Admission stays closed
        # until the underlying parser actually returns.
        with pytest.raises(PollWorkerCapacityError):
            await poll_fetch.fetch_poll_page(
                url="https://issues.example/feed",
                endpoint=endpoint,
                auth=None,
                cursor=None,
            )
    finally:
        release.set()
        await asyncio.sleep(0.05)
        pool.shutdown()


async def test_bounded_executor_cancellation_retains_slot_and_observes_failure() -> None:
    pool = BoundedExecutor(max_workers=1, thread_name_prefix="test-bounded-cancel")
    entered = threading.Event()
    release = threading.Event()
    canary = "CANARY-DETACHED-WORKER-ERROR"
    loop = asyncio.get_running_loop()
    observed_loop_errors: list[dict[str, object]] = []
    prior_handler = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, context: observed_loop_errors.append(context))

    def fail_after_release() -> None:
        entered.set()
        release.wait(timeout=2)
        raise RuntimeError(canary)

    task = asyncio.create_task(pool.run(fail_after_release))
    try:
        for _ in range(100):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        with pytest.raises(BoundedExecutorCapacityError):
            await pool.run(lambda: None)
        release.set()

        # Once the detached callable really completes, the slot reopens. Its
        # exception is consumed by the completion observer, not the event loop.
        for _ in range(100):
            try:
                assert await pool.run(lambda: "ok") == "ok"
                break
            except BoundedExecutorCapacityError:
                await asyncio.sleep(0.005)
        else:  # pragma: no cover - deterministic pool completion bound
            pytest.fail("bounded worker slot did not reopen")
        await asyncio.sleep(0)
        assert canary not in repr(observed_loop_errors)
        assert observed_loop_errors == []
    finally:
        release.set()
        loop.set_exception_handler(prior_handler)
        pool.shutdown()


async def test_exact_cap_deep_json_is_bounded_and_secret_free(monkeypatch) -> None:
    from proliferate.constants.workflows import WORKFLOW_POLL_MAX_RESPONSE_BYTES
    from proliferate.integrations.workflow_poll import PollPageSchemaError
    from proliferate.server.cloud.workflows import poll_fetch

    depth = 1_000
    core = (
        b'{"items":[{"id":"one","data":{"x":'
        + (b"[" * depth)
        + b"0"
        + (b"]" * depth)
        + b"}}]}"
    )
    assert len(core) < WORKFLOW_POLL_MAX_RESPONSE_BYTES
    body = core + (b" " * (WORKFLOW_POLL_MAX_RESPONSE_BYTES - len(core)))
    monkeypatch.setattr(poll_fetch, "fetch_poll_bytes", AsyncMock(return_value=body))
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    started = time.monotonic()
    with pytest.raises(PollPageSchemaError) as raised:
        await poll_fetch.fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=endpoint,
            auth=None,
            cursor=None,
        )
    assert time.monotonic() - started < 5
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


async def test_dns_executor_capacity_stays_owned_after_waiter_cancellation(monkeypatch) -> None:
    pool = BoundedExecutor(max_workers=1, thread_name_prefix="test-outbound-dns")
    entered = threading.Event()
    release = threading.Event()

    def blocking_resolver(_host, port, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        entered.set()
        release.wait(timeout=2)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", port))]

    monkeypatch.setattr(net_guard, "_DNS_EXECUTOR", pool)
    monkeypatch.setattr(net_guard.socket, "getaddrinfo", blocking_resolver)
    task = asyncio.create_task(
        net_guard.resolve_and_pin_endpoint_async("https://capacity.test/feed")
    )
    try:
        for _ in range(100):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        with pytest.raises(net_guard.NetGuardError, match="at capacity"):
            await net_guard.resolve_and_pin_endpoint_async("https://capacity.test/feed")

        release.set()
        monkeypatch.setattr(
            net_guard.socket,
            "getaddrinfo",
            lambda _host, port: [
                (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", port))
            ],
        )
        for _ in range(100):
            try:
                endpoint = await net_guard.resolve_and_pin_endpoint_async(
                    "https://capacity.test/feed"
                )
                break
            except net_guard.NetGuardError as exc:
                assert "at capacity" in str(exc)
                await asyncio.sleep(0.005)
        else:  # pragma: no cover - deterministic worker completion bound
            pytest.fail("DNS worker slot did not reopen")
        assert endpoint.pinned_ip == "8.8.8.8"
    finally:
        release.set()
        pool.shutdown()
