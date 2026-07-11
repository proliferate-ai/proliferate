"""Security and outbound-transport tests for workflow polling."""

from __future__ import annotations

import socket
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from proliferate.db.models.cloud.workflows import WorkflowTrigger, WorkflowVersion
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.poller import _poll_one_trigger
from proliferate.utils.time import utcnow
from tests.unit import test_workflow_poll as base

_Actor = base._Actor
_CountingAsyncByteStream = base._CountingAsyncByteStream
_DEF = base._DEF
_factory = base._factory
_fake_getaddrinfo = base._fake_getaddrinfo
_item = base._item
_make_poll_trigger = base._make_poll_trigger
_make_ready_cloud_workspace = base._make_ready_cloud_workspace
_make_user = base._make_user
_make_workflow = base._make_workflow
_mock_client_factory = base._mock_client_factory
_page = base._page
_poll_body = base._poll_body
_service_create = base._service_create
poller_module = base.poller_module


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch):  # type: ignore[no-untyped-def]
    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _fake_getaddrinfo)


# --- §11 risk profile: fetch_poll_page is bounded (size cap + no redirect) ------


async def test_fetch_poll_page_caps_response_size() -> None:
    from proliferate.constants.workflows import WORKFLOW_POLL_MAX_RESPONSE_BYTES
    from proliferate.integrations.workflow_poll import PollResponseTooLargeError
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    chunk = b"x" * (1024 * 1024)
    total_chunks = WORKFLOW_POLL_MAX_RESPONSE_BYTES // len(chunk) + 2
    stream = _CountingAsyncByteStream(chunk, total_chunks)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    transport = httpx.MockTransport(handler)
    endpoint = net_guard.VettedEndpoint(
        scheme="https", host="issues.example", port=None, pinned_ip="203.0.113.10"
    )
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
    assert stream.pulled < total_chunks


async def test_fetch_poll_page_does_not_follow_redirects() -> None:
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    hits: list[tuple[str, str | None, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append(
            (
                str(request.url),
                request.headers.get("host"),
                request.extensions.get("sni_hostname"),
            )
        )
        if request.url.path.endswith("/feed"):
            return httpx.Response(302, headers={"location": "https://evil.example/steal"})
        return httpx.Response(200, json={"items": [], "cursor": None, "has_more": False})

    transport = httpx.MockTransport(handler)
    endpoint = net_guard.VettedEndpoint(
        scheme="https", host="issues.example", port=None, pinned_ip="203.0.113.10"
    )
    # follow_redirects=False: the 302 is surfaced (raise_for_status) rather than
    # silently chased to the redirect target.
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(httpx.HTTPStatusError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=endpoint,
            auth=None,
            cursor=None,
        )
    # The redirect target was never fetched — only the authored feed URL was hit.
    assert not any("evil.example" in url for url, _host, _sni in hits)
    assert hits == [("https://203.0.113.10/feed?limit=50", "issues.example", "issues.example")]


async def test_fetch_rejects_content_encoding_before_read() -> None:
    from proliferate.integrations.workflow_poll import PollContentEncodingError
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    stream = _CountingAsyncByteStream(b"compressed", 3)
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, headers={"content-encoding": "gzip"}, stream=stream)
    )
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollContentEncodingError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed", endpoint=endpoint, auth=None, cursor=None
        )
    assert stream.pulled == 0


async def test_fetch_transmits_explicit_empty_cursor() -> None:
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    seen: list[str] = []
    body = b'{"items":[],"cursor":"","has_more":false}'
    stream = _CountingAsyncByteStream(body, 1)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, stream=stream)

    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with patch.object(httpx, "AsyncClient", _mock_client_factory(httpx.MockTransport(handler))):
        page = await fetch_poll_page(
            url="https://issues.example/feed", endpoint=endpoint, auth=None, cursor=""
        )
    assert page.cursor == ""
    assert seen == ["https://203.0.113.10/feed?limit=50&cursor="]


async def test_fetch_rejects_page_over_requested_limit() -> None:
    from proliferate.server.cloud.workflows.poller import PollPageLimitError, fetch_poll_page

    body = b'{"items":[{"id":"1"},{"id":"2"},{"id":"3"}]}'
    stream = _CountingAsyncByteStream(body, 1)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, stream=stream))
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollPageLimitError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed", endpoint=endpoint, auth=None, cursor=None, limit=2
        )


async def test_fetch_slow_drip_hits_total_deadline(monkeypatch) -> None:
    import asyncio
    import time

    from proliferate.integrations import workflow_poll
    from proliferate.server.cloud.workflows import poller

    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):  # type: ignore[no-untyped-def]
            for _ in range(100):
                await asyncio.sleep(0.02)
                yield b" "

        async def aclose(self) -> None:
            pass

    monkeypatch.setattr(workflow_poll, "WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS", 0.05)
    monkeypatch.setattr(poller, "WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS", 0.05)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, stream=SlowStream()))
    endpoint = net_guard.VettedEndpoint("https", "issues.example", None, "203.0.113.10")
    started = time.monotonic()
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(TimeoutError),
    ):
        await poller.fetch_poll_page(
            url="https://issues.example/feed", endpoint=endpoint, auth=None, cursor=None
        )
    assert time.monotonic() - started < 0.5


async def test_trigger_record_hides_secret_exposes_has_auth(test_engine) -> None:  # type: ignore[no-untyped-def]
    """A read of a poll trigger surfaces poll_has_auth but never the ciphertext."""
    from proliferate.utils.crypto import encrypt_text

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger.poll_auth_header = "Authorization"
        trigger.poll_auth_ciphertext = encrypt_text("Bearer sekret")
        await db.flush()
        trigger_id = trigger.id
        await db.commit()

    async with factory() as db:
        record = await trigger_store.get_trigger(db, trigger_id)
    assert record is not None
    assert record.poll_has_auth is True
    assert record.poll_auth_header == "Authorization"
    assert not hasattr(record, "poll_auth_ciphertext")  # secret never on the record


# --- finding 3: disabling a poll trigger never reprobes /init (no disable-brick) -


async def test_disable_poll_trigger_skips_reprobe_when_endpoint_down(test_engine) -> None:  # type: ignore[no-untyped-def]
    """Finding 3: ``PATCH {enabled: false}`` must succeed even when the endpoint is
    down and the inputs have drifted (which would otherwise force a reprobe). A
    disabled trigger never polls, so its endpoint shape is irrelevant while off."""
    from proliferate.server.cloud.workflows.models import WorkflowTriggerUpdateRequest
    from proliferate.server.cloud.workflows.triggers import update_trigger

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        await _make_ready_cloud_workspace(db, user)
        await db.commit()
        actor = _Actor(user.id)

        good_page = _page([_item("probe_ok", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
            trigger = await _service_create(db, actor, wf.id, _poll_body())

        # The workflow's inputs change (adds a required "extra") so the derived item
        # schema drifts from the stored one — this is exactly the condition that
        # forces a reprobe on an ENABLED edit.
        new_def = {
            "version": 1,
            "inputs": [
                {"name": "n", "type": "number", "required": True},
                {"name": "title", "type": "text", "required": True},
                {"name": "extra", "type": "text", "required": True},
            ],
            "agents": _DEF["agents"],
        }
        new_ver = WorkflowVersion(
            workflow_id=wf.id,
            version_n=2,
            definition_json=new_def,
            created_by_user_id=user.id,
            created_at=utcnow(),
        )
        db.add(new_ver)
        await db.flush()
        wf.current_version_id = new_ver.id
        await db.flush()

        # Endpoint is down: any reprobe would raise poll_probe_failed and brick the
        # disable. With the fix, disabling skips the reprobe entirely.
        down = AsyncMock(side_effect=httpx.ConnectError("endpoint down"))
        with patch.object(poller_module, "fetch_poll_page", new=down):
            updated = await update_trigger(
                db,
                actor,
                wf.id,
                trigger.id,
                WorkflowTriggerUpdateRequest.model_validate({"enabled": False}),
            )
    assert updated.enabled is False
    assert down.call_count == 0  # never reprobed on a disable


# --- finding 4: SSRF guard on the /init probe (private/metadata addrs blocked) --


@pytest.mark.parametrize(
    "private_url",
    [
        "http://10.0.0.1/poll",  # RFC1918 private
        "http://169.254.169.254/latest/meta-data",  # link-local cloud metadata
        "http://100.64.0.1/poll",  # RFC6598 CGNAT / Tailscale
    ],
)
async def test_inspect_poll_endpoint_blocks_private_address(  # type: ignore[no-untyped-def]
    private_url,
) -> None:
    """Finding 4: the stateless probe refuses a URL whose host is a private,
    metadata, or CGNAT address — a structured error, and ZERO outbound (the guard
    raises before fetch_poll_page is ever called)."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.triggers import inspect_poll_endpoint

    # The guard is unconditionally active now (no settings.debug bypass exists) —
    # nothing to flip; this is exercised with the default PUBLIC_ONLY policy.

    # A sentinel that FAILS the test if any outbound request is attempted.
    sentinel = AsyncMock(side_effect=AssertionError("no outbound request may be issued"))
    with (
        patch.object(poller_module, "fetch_poll_page", new=sentinel),
        pytest.raises(CloudApiError) as exc,
    ):
        await inspect_poll_endpoint(
            TriggerPollRequest.model_validate({"url": private_url, "intervalSecs": 60})
        )
    assert exc.value.code == "poll_endpoint_blocked"
    assert exc.value.status_code == 400
    assert sentinel.await_count == 0  # zero outbound


async def test_inspect_poll_endpoint_loopback_test_policy_allows_loopback() -> None:
    """A local/self-host server is reached via the explicit ``LOOPBACK_TEST``
    policy, never a debug/env switch (there is no bypass anymore — the guard is
    unconditionally active; this is the intended supported mechanism for a
    test/self-host dependency bootstrap to reach a controllable local server)."""
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.triggers import inspect_poll_endpoint

    good_page = _page([_item("seed_1", title="hi")])
    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=good_page)):
        result = await inspect_poll_endpoint(
            TriggerPollRequest.model_validate(
                {"url": "http://127.0.0.1:9000/feed", "intervalSecs": 60}
            ),
            policy=net_guard.LOOPBACK_TEST,
        )
    assert result.sample_item_id == "seed_1"


# --- adversarial: malformed port, forbidden headers, endpoint/url coherence -----


async def test_guard_poll_endpoint_malformed_port_blocked() -> None:
    """A malformed port (``urlsplit(...).port`` raises a bare ``ValueError``) must
    surface as the SAME structured ``poll_endpoint_blocked`` denial as any other
    unparseable endpoint — never an unhandled ``ValueError``."""
    from proliferate.server.cloud.workflows.poll_endpoint import guard_poll_endpoint

    with pytest.raises(CloudApiError) as exc:
        await guard_poll_endpoint("http://issues.example:not-a-port/x")
    assert exc.value.code == "poll_endpoint_blocked"


async def test_guard_revalidates_dns_on_every_request(monkeypatch) -> None:
    from proliferate.server.cloud.workflows.poll_endpoint import guard_poll_endpoint

    answers = ["93.184.216.34", "127.0.0.1"]

    def resolve(_host, port, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (answers.pop(0), port))
        ]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", resolve)
    first = await guard_poll_endpoint("https://rebind.example/feed")
    assert first.pinned_ip == "93.184.216.34"
    with pytest.raises(CloudApiError) as exc:
        await guard_poll_endpoint("https://rebind.example/feed")
    assert exc.value.code == "poll_endpoint_blocked"


async def test_guard_rejects_port_zero() -> None:
    from proliferate.server.cloud.workflows.poll_endpoint import guard_poll_endpoint

    with pytest.raises(CloudApiError) as exc:
        await guard_poll_endpoint("https://issues.example:0/feed")
    assert exc.value.code == "poll_endpoint_blocked"


def test_poll_auth_binding_rejects_forbidden_header() -> None:
    """Every ``PollAuthBinding`` construction path — not just ``.create()`` —
    refuses a transport/routing-authority header name."""
    from proliferate.integrations.workflow_poll import (
        PollAuthBinding,
        PollForbiddenHeaderError,
        PollInvalidHeaderError,
    )

    with pytest.raises(PollForbiddenHeaderError):
        PollAuthBinding(header="Host", value="evil.example")
    with pytest.raises(PollForbiddenHeaderError):
        PollAuthBinding.create("X-Forwarded-For", "1.2.3.4")
    # Legacy whitespace is invalid at dispatch rather than silently normalized.
    with pytest.raises(PollInvalidHeaderError):
        PollAuthBinding.create(" Content-Length ", "0")


@pytest.mark.parametrize("header", ["Bad Header", "X-Bad:Value", "X-Bad\nInjected", "X-☃"])
def test_poll_auth_binding_rejects_malformed_header_name(header: str) -> None:
    from proliferate.integrations.workflow_poll import (
        PollAuthBinding,
        PollInvalidHeaderError,
    )

    with pytest.raises(PollInvalidHeaderError):
        PollAuthBinding(header=header, value="secret")


def test_poll_auth_binding_rejects_accept_encoding_override() -> None:
    """Captain review finding: an ``auth_header`` of 'Accept-Encoding' used to
    silently overwrite the transport's own ``identity`` value, defeating the
    compression/size protections. It is now denied at construction."""
    from proliferate.integrations.workflow_poll import (
        PollAuthBinding,
        PollForbiddenHeaderError,
    )

    with pytest.raises(PollForbiddenHeaderError):
        PollAuthBinding(header="Accept-Encoding", value="gzip")
    with pytest.raises(PollForbiddenHeaderError):
        PollAuthBinding.create("Accept-Encoding", "gzip")


@pytest.mark.parametrize("value", ["x\r\nInjected: yes", "x\x00y", "☃", "x" * 8193])
def test_poll_auth_binding_rejects_unsafe_value(value: str) -> None:
    from proliferate.integrations.workflow_poll import PollAuthBinding, PollInvalidHeaderError

    with pytest.raises(PollInvalidHeaderError):
        PollAuthBinding(header="Authorization", value=value)


def test_poll_config_rejects_unsafe_auth_value_before_encrypt() -> None:
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.triggers import _validate_poll_config

    request = TriggerPollRequest.model_validate(
        {
            "url": "https://issues.example/feed",
            "intervalSecs": 60,
            "authHeader": "Authorization",
            "authValue": "secret\r\nInjected: yes",
        }
    )
    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(request, is_update=False)
    assert exc.value.code == "invalid_poll_config"


def test_poll_error_taxonomy_is_typed() -> None:
    from proliferate.integrations.workflow_poll import (
        PollContentEncodingError,
        PollInvalidHeaderError,
        PollResponseTooLargeError,
    )
    from proliferate.server.cloud.workflows.poller import (
        PollErrorKind,
        PollPageLimitError,
        classify_poll_error,
    )

    request = httpx.Request("GET", "https://example.com")
    status = httpx.HTTPStatusError(
        "bad", request=request, response=httpx.Response(500, request=request)
    )
    cases = [
        (PollInvalidHeaderError(), PollErrorKind.PRE_SEND),
        (
            CloudApiError("poll_endpoint_blocked", "blocked", status_code=400),
            PollErrorKind.DNS_POLICY,
        ),
        (TimeoutError(), PollErrorKind.TIMEOUT),
        (status, PollErrorKind.UPSTREAM_STATUS),
        (PollResponseTooLargeError(), PollErrorKind.SIZE),
        (PollContentEncodingError(), PollErrorKind.CONTENT_ENCODING),
        (PollPageLimitError(), PollErrorKind.SCHEMA),
        (httpx.ConnectError("no", request=request), PollErrorKind.TRANSPORT),
    ]
    assert [classify_poll_error(error) for error, _kind in cases] == [
        kind for _error, kind in cases
    ]


async def test_fetch_poll_page_rejects_endpoint_url_mismatch() -> None:
    """Captain review finding: endpoint/URL coherence. A caller that vets one URL
    but dispatches a DIFFERENT one must be refused before any request bytes leave
    — a ``VettedEndpoint`` for a different host never authorizes THIS request."""
    from proliferate.integrations.workflow_poll import PollEndpointMismatchError
    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must never run
        raise AssertionError("no outbound request may be issued on a coherence mismatch")

    transport = httpx.MockTransport(handler)
    mismatched_endpoint = net_guard.VettedEndpoint(
        scheme="https", host="other.example", port=None, pinned_ip="203.0.113.10"
    )
    with (
        patch.object(httpx, "AsyncClient", _mock_client_factory(transport)),
        pytest.raises(PollEndpointMismatchError),
    ):
        await fetch_poll_page(
            url="https://issues.example/feed",
            endpoint=mismatched_endpoint,
            auth=None,
            cursor=None,
        )


async def test_poll_one_trigger_dns_blocked_past_deadline_times_out(
    test_engine, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """Captain review finding 1 (adversarial coverage): a resolver stuck past the
    total deadline must not hang the caller. ``resolve_and_pin_endpoint_async``
    resolves OFF the event loop (``run_in_executor``), so the caller's outer
    ``asyncio.timeout`` (patched small here) cancels promptly even though the
    background resolver thread keeps running past it — the CALLER unblocks, which
    is what's asserted (not that the background thread itself stops)."""
    import time as time_module

    monkeypatch.setattr(poller_module, "WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS", 0.05)

    def _blocking_getaddrinfo(host, port, *args, **kwargs):  # type: ignore[no-untyped-def]
        time_module.sleep(1.0)  # off-loop; must not block the awaiting caller
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", port))]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", _blocking_getaddrinfo)

    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)  # default 127.0.0.1 url
        trigger_id = trigger.id
        await db.commit()

    started = time_module.monotonic()
    spawned = await _poll_one_trigger(
        factory, trigger_id=trigger_id, now=utcnow(), policy=net_guard.LOOPBACK_TEST
    )
    elapsed = time_module.monotonic() - started
    assert spawned == 0
    # Unblocked promptly (well under the 1s resolver sleep) — proves the DNS wait is
    # bounded by the SAME absolute deadline as the rest of the fetch.
    assert elapsed < 0.5

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.last_poll_error is not None
        assert "timed out" in refreshed.last_poll_error.lower()


async def test_poll_error_never_leaks_auth_secret(test_engine, caplog) -> None:  # type: ignore[no-untyped-def]
    """A poll auth secret must never appear in any error surface: the raised
    exception's ``str()``, ``describe_poll_error()``'s output, the persisted
    ``last_poll_error``, or caplog — including on a failure path."""
    from proliferate.utils.crypto import encrypt_text

    canary = "CANARY-9f3a-SECRET"
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        wf = await _make_workflow(db, user)
        trigger = await _make_poll_trigger(db, wf, user)
        trigger.poll_auth_header = "Authorization"
        trigger.poll_auth_ciphertext = encrypt_text(f"Bearer {canary}")
        await db.flush()
        trigger_id = trigger.id
        await db.commit()

    # A hostile/broken endpoint that echoed the request's own auth header back in
    # its error — the worst case for a leak, since the exception carries the
    # request object (with the real header) end to end.
    request = httpx.Request("GET", "http://x/poll", headers={"Authorization": f"Bearer {canary}"})
    error = httpx.HTTPStatusError(
        "500", request=request, response=httpx.Response(500, request=request)
    )

    with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(side_effect=error)):
        spawned = await _poll_one_trigger(
            factory, trigger_id=trigger_id, now=utcnow(), policy=net_guard.LOOPBACK_TEST
        )
    assert spawned == 0
    assert canary not in str(error)
    assert canary not in poller_module.describe_poll_error(error)

    async with factory() as db:
        refreshed = await db.get(WorkflowTrigger, trigger_id)
        assert refreshed.last_poll_error is not None
        assert canary not in refreshed.last_poll_error

    assert canary not in caplog.text
