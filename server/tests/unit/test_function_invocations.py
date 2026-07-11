"""Track 1b Phase 2 — function invocations, Tier-1 DENY-PATH floor.

These are the non-negotiable security tests for the invocations feature (Part II
mental-model §1/§11). Each asserts AT THE GATEWAY (the raised scope/validation
error and the ABSENCE of any upstream request), never on agent prose:

  (a) args failing ``args_schema`` are rejected at the gateway — no outbound call.
  (b) the namespace-reservation check blocks an org registering a custom
      integration literally named ``functions``.
  (c) an invocation NOT granted to a run is scope-denied (403) at the gateway —
      zero outbound request.
  (d) the SSRF guard blocks a private/link-local endpoint — no outbound call.
  (e) the encrypted headers blob is never read back on a read path (write-only).
"""

from __future__ import annotations

import socket
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_MAX_RESPONSE_BYTES

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.models.auth import User
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway import functions as functions_dispatch
from proliferate.server.cloud.integration_gateway import service as gateway_service
from proliferate.server.cloud.integrations import service as integrations_service

pytestmark = pytest.mark.asyncio

_FN = FUNCTION_INVOCATION_PROVIDER_NAMESPACE


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"fn-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_invocation(
    db: AsyncSession,
    *,
    owner: User,
    name: str = "my_fn",
    endpoint_url: str = "https://example.com/hook",
    method: str = "post",
    args_schema: dict | None = None,
    headers: dict[str, str] | None = None,
    chat_scope_enabled: bool = False,
):
    return await invocations_store.create(
        db,
        owner_user_id=owner.id,
        organization_id=None,
        created_by_user_id=owner.id,
        name=name,
        endpoint_url=endpoint_url,
        method=method,
        args_schema_json=args_schema or {},
        headers=headers,
        chat_scope_enabled=chat_scope_enabled,
    )


def _run_grant(owner: User, *, functions_tools: list[str] | None) -> IntegrationGatewayGrant:
    """A per-run (workflow) grant. ``functions_tools`` None grants NO functions
    access; a list grants exactly those invocation names under the reserved ns."""
    run_scope: list[dict[str, object]] = []
    if functions_tools is not None:
        run_scope.append({"provider": _FN, "tools": functions_tools})
    return IntegrationGatewayGrant(
        owner_user_id=owner.id,
        organization_id=None,
        run_id=uuid.uuid4(),
        workflow_id=uuid.uuid4(),
        run_scope=run_scope,
    )


def _no_dispatch_sentinel(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    """Trip a flag if the outbound dispatch is ever reached; assert it stays False
    on a deny-path (the proof that NO upstream request was issued)."""
    tripped = {"called": False}

    async def _boom(*_args, **_kwargs):
        tripped["called"] = True
        raise AssertionError("outbound dispatch must not be reached on a deny-path")

    monkeypatch.setattr(functions_dispatch, "_dispatch", _boom)
    return tripped


# --- (a) args failing args_schema -> rejected at gateway, no outbound call ------
async def test_args_failing_schema_rejected_before_outbound(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    await _seed_invocation(
        db_session,
        owner=user,
        name="my_fn",
        args_schema={
            "type": "object",
            "properties": {"x": {"type": "string"}},
            "required": ["x"],
        },
    )
    grant = _run_grant(user, functions_tools=["my_fn"])  # scope ALLOWS the call
    tripped = _no_dispatch_sentinel(monkeypatch)

    with pytest.raises(CloudApiError) as exc:
        await gateway_service.call_provider_tool(
            db_session,
            grant=grant,
            provider=_FN,
            tool="my_fn",
            arguments={},  # missing "x"
        )
    assert exc.value.code == "function_invocation_args_invalid"
    assert tripped["called"] is False  # rejected at the gateway, zero outbound traffic


# --- (b) namespace reservation blocks a custom integration named 'functions' ----
async def test_namespace_reservation_blocks_functions(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _noop_admin(*_args, **_kwargs):
        return None

    monkeypatch.setattr(integrations_service, "_require_org_admin", _noop_admin)
    with pytest.raises(CloudApiError) as exc:
        await integrations_service.create_admin_integration_definition(
            db_session,
            organization_id=uuid.uuid4(),
            actor_user_id=uuid.uuid4(),
            display_name="Functions",
            namespace="functions",
            mcp_url="https://example.com/mcp",
        )
    assert exc.value.code == "invalid_payload"
    assert "reserved" in exc.value.message.lower()


# --- (c) invocation NOT granted to a run -> gateway 403, zero outbound ----------
async def test_invocation_not_granted_to_run_denied(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _make_user(db_session)
    await _seed_invocation(db_session, owner=user, name="my_fn")
    grant = _run_grant(user, functions_tools=None)  # run grants NO functions access
    tripped = _no_dispatch_sentinel(monkeypatch)

    with pytest.raises(CloudApiError) as exc:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider=_FN, tool="my_fn", arguments={}
        )
    assert exc.value.status_code == 403
    assert exc.value.code == "integration_gateway_scope_denied"
    assert tripped["called"] is False

    # And it never appears in list_providers for a run that wasn't granted it.
    providers = await gateway_service.list_providers(db_session, grant=grant)
    assert _FN not in {p["provider"] for p in providers["providers"]}


async def test_invocation_granted_to_run_visible_and_dispatches(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Positive control for (c): a granted invocation IS visible + reaches dispatch."""
    user = await _make_user(db_session)
    await _seed_invocation(db_session, owner=user, name="my_fn")
    grant = _run_grant(user, functions_tools=["my_fn"])

    providers = await gateway_service.list_providers(db_session, grant=grant)
    assert _FN in {p["provider"] for p in providers["providers"]}

    reached = {"called": False}

    async def _ok(invocation, *, arguments, headers, pinned_ip):
        reached["called"] = True
        return {"content": [], "structuredContent": {"ok": True}, "isError": False}

    monkeypatch.setattr(functions_dispatch, "_dispatch", _ok)
    result = await gateway_service.call_provider_tool(
        db_session, grant=grant, provider=_FN, tool="my_fn", arguments={}
    )
    assert reached["called"] is True
    assert result["isError"] is False


# --- (d) SSRF guard blocks a private-range endpoint -> no outbound call ---------
@pytest.mark.parametrize(
    "endpoint",
    [
        "http://10.1.2.3/secret",
        "http://127.0.0.1:8000/admin",
        "http://169.254.169.254/latest/meta-data",  # cloud metadata (link-local)
        "http://100.64.1.2/x",  # RFC 6598 CGNAT / Tailscale (not is_private)
    ],
)
async def test_ssrf_guard_blocks_private_endpoint(db_session: AsyncSession, endpoint: str) -> None:
    user = await _make_user(db_session)
    await _seed_invocation(db_session, owner=user, name="my_fn", endpoint_url=endpoint)
    grant = _run_grant(user, functions_tools=["my_fn"])

    with pytest.raises(CloudApiError) as exc:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider=_FN, tool="my_fn", arguments={}
        )
    assert exc.value.code == "function_invocation_blocked"


# --- (2) CGNAT 100.64.0.0/10 (Tailscale range) -> blocked, zero outbound --------
async def test_ssrf_guard_blocks_cgnat_endpoint_zero_outbound(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """100.64.0.0/10 passes stdlib ``is_private`` but is CGNAT/Tailscale space —
    must be denied at the guard with NO outbound request."""
    user = await _make_user(db_session)
    await _seed_invocation(
        db_session, owner=user, name="my_fn", endpoint_url="http://100.64.5.6/secret"
    )
    grant = _run_grant(user, functions_tools=["my_fn"])
    tripped = _no_dispatch_sentinel(monkeypatch)

    with pytest.raises(CloudApiError) as exc:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider=_FN, tool="my_fn", arguments={}
        )
    assert exc.value.code == "function_invocation_blocked"
    assert tripped["called"] is False  # zero outbound


# --- (1) DNS-rebinding TOCTOU: dispatch pins to the vetted IP, Host = original ---
async def test_dispatch_pins_to_vetted_ip_and_keeps_host_header(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The guard resolves the hostname to a public IP; the dispatch must CONNECT to
    exactly that IP (URL rewritten to the IP literal) while the Host header + TLS
    SNI carry the original hostname — closing the re-resolution (rebinding) gap."""
    public_ip = "93.184.216.34"

    def _fake_getaddrinfo(host, port, *args, **kwargs):
        # The name the guard vets resolves ONLY to a public IPv4.
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (public_ip, port))]

    monkeypatch.setattr(functions_dispatch.socket, "getaddrinfo", _fake_getaddrinfo)

    endpoint = "https://api.example.com/hook"
    pinned = functions_dispatch._guard_endpoint_or_raise(endpoint)
    assert pinned == public_ip

    user = await _make_user(db_session)
    record = await _seed_invocation(
        db_session, owner=user, name="my_fn", endpoint_url=endpoint, method="post"
    )

    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["host"] = request.headers.get("host")
        captured["sni"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(_handler)
    result = await functions_dispatch._dispatch(
        record, arguments={}, headers={}, pinned_ip=pinned, transport=transport
    )

    assert result["isError"] is False
    # Connection target is the pinned IP literal, NOT the hostname.
    assert captured["url"] == f"https://{public_ip}/hook"
    # Host header + SNI still carry the original hostname (vhosts + cert verify).
    assert captured["host"] == "api.example.com"
    assert captured["sni"] == "api.example.com"


# --- (3) oversized response aborts mid-stream, body not fully consumed ----------
class _CountingByteStream(httpx.AsyncByteStream):
    """A streaming body that records how many chunks were actually pulled, so a test
    can prove the reader aborted before consuming the whole response."""

    def __init__(self, chunk: bytes, total_chunks: int) -> None:
        self._chunk = chunk
        self._total = total_chunks
        self.pulled = 0

    async def __aiter__(self):
        for _ in range(self._total):
            self.pulled += 1
            yield self._chunk

    async def aclose(self) -> None:  # pragma: no cover - trivial
        pass


async def test_oversized_response_aborts_midstream(db_session: AsyncSession) -> None:
    one_mb = b"x" * (1024 * 1024)
    total_chunks = 8  # 8 MiB total, far past the 2 MiB cap
    assert total_chunks * len(one_mb) > FUNCTION_INVOCATION_MAX_RESPONSE_BYTES
    stream = _CountingByteStream(one_mb, total_chunks)

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    transport = httpx.MockTransport(_handler)

    user = await _make_user(db_session)
    record = await _seed_invocation(
        db_session,
        owner=user,
        name="my_fn",
        endpoint_url="http://data.example.com/big",
        method="get",
    )

    with pytest.raises(CloudApiError) as exc:
        await functions_dispatch._dispatch(
            record, arguments={}, headers={}, pinned_ip="93.184.216.34", transport=transport
        )
    assert exc.value.code == "function_invocation_response_too_large"
    # Proof the body was NOT fully buffered: we stopped pulling once the cap crossed.
    assert 0 < stream.pulled < total_chunks


# --- (e) headers ciphertext is never read back (write-only) ---------------------
async def test_headers_ciphertext_never_read_back(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    record = await _seed_invocation(
        db_session, owner=user, name="my_fn", headers={"Authorization": "Bearer sekret"}
    )
    # The read view carries only a boolean presence flag — no ciphertext, no plaintext.
    assert record.has_headers is True
    assert not hasattr(record, "headers_ciphertext")
    for field in vars(record).values():
        assert "sekret" not in repr(field)

    fetched = await invocations_store.get_by_name(db_session, owner_user_id=user.id, name="my_fn")
    assert fetched is not None
    assert not hasattr(fetched, "headers_ciphertext")

    # Only the dispatch-path decrypt helper can recover the plaintext headers.
    decrypted = await invocations_store.decrypt_headers(
        db_session, owner_user_id=user.id, name="my_fn"
    )
    assert decrypted == {"Authorization": "Bearer sekret"}


# --- chat default scope: new invocations are WORKFLOW-ONLY until enabled --------
async def test_new_invocation_workflow_only_absent_from_chat_default(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_invocation(db_session, owner=user, name="wf_only", chat_scope_enabled=False)
    await _seed_invocation(db_session, owner=user, name="chat_ok", chat_scope_enabled=True)

    scope = await gateway_service.build_chat_default_access_scope(
        db_session, owner_user_id=user.id, organization_id=None
    )
    assert scope is not None
    fn_entries = [e for e in scope if e.get("provider") == _FN]
    assert fn_entries == [{"provider": _FN, "tools": ["chat_ok"]}]


async def test_chat_grant_denies_workflow_only_invocation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A chat/interactive grant carrying the computed default scope cannot call a
    workflow-only invocation (not chat-enabled) — denied at the gateway."""
    user = await _make_user(db_session)
    await _seed_invocation(db_session, owner=user, name="wf_only", chat_scope_enabled=False)
    default_scope = await gateway_service.build_chat_default_access_scope(
        db_session, owner_user_id=user.id, organization_id=None
    )
    grant = IntegrationGatewayGrant(
        owner_user_id=user.id, organization_id=None, default_scope=default_scope
    )
    tripped = _no_dispatch_sentinel(monkeypatch)
    with pytest.raises(CloudApiError) as exc:
        await gateway_service.call_provider_tool(
            db_session, grant=grant, provider=_FN, tool="wf_only", arguments={}
        )
    assert exc.value.code == "integration_gateway_scope_denied"
    assert tripped["called"] is False
