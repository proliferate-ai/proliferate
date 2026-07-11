"""Real-socket TLS and secret-surface proofs for workflow polling."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from proliferate.integrations.workflow_poll import PollForbiddenHeaderError, PollInvalidHeaderError
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import poller, triggers
from proliferate.server.cloud.workflows.domain.poll_contract import PollPage
from proliferate.server.cloud.workflows.models import TriggerPollRequest


@dataclass
class _TlsServer:
    port: int
    server_names: list[str | None] = field(default_factory=list)
    requests: list[bytes] = field(default_factory=list)


def _issue_test_certificates(tmp_path: Path, *, dns_name: str) -> tuple[Path, Path, Path]:
    """Issue one test CA and one server certificate for ``dns_name``."""

    now = datetime.now(UTC)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "poll-test-ca")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, dns_name)])
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(ca_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(dns_name)]), critical=False)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    ca_path = tmp_path / "ca.pem"
    cert_path = tmp_path / "server.pem"
    key_path = tmp_path / "server-key.pem"
    ca_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    cert_path.write_bytes(leaf_cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return ca_path, cert_path, key_path


@asynccontextmanager
async def _serve_tls(
    cert_path: Path,
    key_path: Path,
    *,
    response: bytes,
) -> AsyncIterator[_TlsServer]:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=cert_path, keyfile=key_path)
    state = _TlsServer(port=0)

    def record_sni(
        _socket: ssl.SSLSocket, server_name: str | None, _context: ssl.SSLContext
    ) -> None:
        state.server_names.append(server_name)

    context.set_servername_callback(record_sni)

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            state.requests.append(await reader.readuntil(b"\r\n\r\n"))
            writer.write(response)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(handler, "127.0.0.1", 0, ssl=context)
    state.port = int(server.sockets[0].getsockname()[1])
    try:
        yield state
    finally:
        server.close()
        await server.wait_closed()


def _trust_test_ca(monkeypatch: pytest.MonkeyPatch, ca_path: Path) -> None:
    """Make only this test's real httpx client trust its generated CA."""

    from httpx._transports import default as httpx_transport

    def context_factory(**_kwargs: object) -> ssl.SSLContext:
        return ssl.create_default_context(cafile=ca_path)

    monkeypatch.setattr(httpx_transport, "create_ssl_context", context_factory)


async def test_real_tls_uses_pinned_ip_original_host_and_sni(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The HTTP client must never resolve the authored hostname a second time."""

    ca_path, cert_path, key_path = _issue_test_certificates(tmp_path, dns_name="poll.test")
    _trust_test_ca(monkeypatch, ca_path)
    response = (
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n"
        b'Content-Length: 41\r\n\r\n{"items":[],"cursor":"","has_more":false}'
    )
    async with _serve_tls(cert_path, key_path, response=response) as server:
        real_getaddrinfo = socket.getaddrinfo
        authored_dns_calls = 0

        def rebinding_dns(host: str, port: int, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
            nonlocal authored_dns_calls
            if host == "poll.test":
                authored_dns_calls += 1
                if authored_dns_calls > 1:
                    raise AssertionError("HTTP transport re-resolved the authored hostname")
                return [
                    (
                        socket.AF_INET,
                        socket.SOCK_STREAM,
                        socket.IPPROTO_TCP,
                        "",
                        ("127.0.0.1", port),
                    )
                ]
            return real_getaddrinfo(host, port, *args, **kwargs)

        monkeypatch.setattr(net_guard.socket, "getaddrinfo", rebinding_dns)
        monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
        monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:1")
        monkeypatch.delenv("NO_PROXY", raising=False)
        url = f"https://poll.test:{server.port}/feed"
        endpoint = await net_guard.resolve_and_pin_endpoint_async(
            url, policy=net_guard.LOOPBACK_TEST
        )
        page = await poller.fetch_poll_page(url=url, endpoint=endpoint, auth=None, cursor="")

    assert page.cursor == ""
    assert authored_dns_calls == 1
    assert server.server_names == ["poll.test"]
    request = server.requests[0].decode("ascii")
    assert request.startswith("GET /feed?limit=50&cursor= HTTP/1.1\r\n")
    assert f"\r\nHost: poll.test:{server.port}\r\n" in request


async def test_real_tls_rejects_wrong_name_certificate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ca_path, cert_path, key_path = _issue_test_certificates(tmp_path, dns_name="wrong.test")
    _trust_test_ca(monkeypatch, ca_path)
    response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
    async with _serve_tls(cert_path, key_path, response=response) as server:
        endpoint = net_guard.VettedEndpoint(
            scheme="https", host="poll.test", port=server.port, pinned_ip="127.0.0.1"
        )
        with pytest.raises(httpx.ConnectError):
            await poller.fetch_poll_page(
                url=f"https://poll.test:{server.port}/feed",
                endpoint=endpoint,
                auth=None,
                cursor=None,
            )

    assert server.server_names == ["poll.test"]
    assert server.requests == []


async def test_real_tls_redirect_is_not_followed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ca_path, cert_path, key_path = _issue_test_certificates(tmp_path, dns_name="poll.test")
    _trust_test_ca(monkeypatch, ca_path)
    response = (
        b"HTTP/1.1 302 Found\r\nLocation: https://poll.test/credential-sink\r\n"
        b"Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    async with _serve_tls(cert_path, key_path, response=response) as server:
        endpoint = net_guard.VettedEndpoint(
            scheme="https", host="poll.test", port=server.port, pinned_ip="127.0.0.1"
        )
        with pytest.raises(httpx.HTTPStatusError):
            await poller.fetch_poll_page(
                url=f"https://poll.test:{server.port}/feed",
                endpoint=endpoint,
                auth=None,
                cursor=None,
            )

    assert len(server.requests) == 1


def test_schema_error_message_cannot_reflect_secret() -> None:
    canary = "CANARY-REFLECTED-CREDENTIAL"
    with pytest.raises(Exception) as caught:
        PollPage.model_validate({"items": [{"id": "one", "data": canary}]})
    assert canary in str(caught.value)  # prove the raw library error is unsafe
    assert canary not in poller.describe_poll_error(caught.value)


async def test_inspect_suppresses_reflected_secret_exception_chain() -> None:
    canary = "CANARY-REFLECTED-CREDENTIAL"
    with pytest.raises(Exception) as caught:
        PollPage.model_validate({"items": [{"id": "one", "data": canary}]})
    request = TriggerPollRequest.model_validate(
        {"url": "https://poll.test/feed", "intervalSecs": 60}
    )
    endpoint = net_guard.VettedEndpoint("https", "poll.test", None, "203.0.113.10")
    with (
        patch.object(triggers, "guard_poll_endpoint", new=AsyncMock(return_value=endpoint)),
        patch.object(poller, "fetch_poll_page", new=AsyncMock(side_effect=caught.value)),
        pytest.raises(CloudApiError) as raised,
    ):
        await triggers.inspect_poll_endpoint(request)

    assert canary not in raised.value.message
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True


def test_decrypt_failure_is_a_secret_free_pre_send_error() -> None:
    canary = "CANARY-CIPHERTEXT-DETAIL"
    trigger = SimpleNamespace(
        poll_auth_header="Authorization", poll_auth_ciphertext="opaque-ciphertext"
    )
    with (
        patch.object(poller, "decrypt_text", side_effect=ValueError(canary)),
        pytest.raises(PollInvalidHeaderError) as raised,
    ):
        poller.decrypt_poll_auth(trigger)  # type: ignore[arg-type]
    assert canary not in str(raised.value)
    assert poller.classify_poll_error(raised.value) is poller.PollErrorKind.PRE_SEND


@pytest.mark.parametrize(
    "raw",
    [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "192.0.2.1",
        "192.88.99.1",
        "224.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "64:ff9b::808:808",
        "2001::1",
        "2001:db8::1",
        "2002:0808:0808::",
        "fc00::1",
        "fe80::1",
        "ff02::1",
    ],
)
def test_public_policy_fails_closed_on_non_global_and_tunnel_addresses(raw: str) -> None:
    assert net_guard.is_blocked_ip(ipaddress.ip_address(raw)) is True


@pytest.mark.parametrize("raw", ["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"])
def test_public_policy_accepts_globally_routable_addresses(raw: str) -> None:
    assert net_guard.is_blocked_ip(ipaddress.ip_address(raw)) is False


@pytest.mark.parametrize("raw", ["127.0.0.1", "::1"])
def test_loopback_test_policy_relaxes_only_loopback(raw: str) -> None:
    assert (
        net_guard.is_blocked_ip(ipaddress.ip_address(raw), policy=net_guard.LOOPBACK_TEST) is False
    )
    assert (
        net_guard.is_blocked_ip(ipaddress.ip_address("10.0.0.1"), policy=net_guard.LOOPBACK_TEST)
        is True
    )


async def test_guard_rejects_mixed_public_private_dns_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def mixed_answers(host: str, port: int, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", port)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.0.0.1", port)),
        ]

    monkeypatch.setattr(net_guard.socket, "getaddrinfo", mixed_answers)
    with pytest.raises(net_guard.NetGuardError):
        await net_guard.resolve_and_pin_endpoint_async("https://mixed.test/feed")


@pytest.mark.parametrize(
    "name",
    [
        "hOsT",
        "cOnTeNt-LeNgTh",
        "TrAnSfEr-EnCoDiNg",
        "pRoXy-AuThOrIzAtIoN",
        "X-fOrWaRdEd-FoR",
        "sEc-WeBsOcKeT-kEy",
    ],
)
def test_transport_authority_header_denylist_is_case_insensitive(name: str) -> None:
    from proliferate.integrations.workflow_poll import PollAuthBinding

    with pytest.raises(PollForbiddenHeaderError):
        PollAuthBinding(header=name, value="credential")
