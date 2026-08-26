"""SSRF guards on OAuth discovery (CodeQL py/full-ssrf, alert #51).

Discovery URLs derive from admin-supplied MCP server URLs and from the remote
server's own responses; every fetch must stay on public HTTPS origins and
redirects must never be followed.
"""

from __future__ import annotations

import json

import httpx
import pytest

from proliferate.integrations.integration_oauth import discovery, netsafety
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError

_PUBLIC_ADDRESS = ("93.184.216.34",)

_AUTH_METADATA = {
    "issuer": "https://auth.example.com",
    "authorization_endpoint": "https://auth.example.com/authorize",
    "token_endpoint": "https://auth.example.com/token",
    "code_challenge_methods_supported": ["S256"],
}


def _install(
    monkeypatch: pytest.MonkeyPatch,
    handler,
    *,
    resolved: tuple[str, ...] = _PUBLIC_ADDRESS,
) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def _record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    async def _addresses(_hostname: str, _port: int) -> tuple[str, ...]:
        return resolved

    async_client = httpx.AsyncClient
    transport = httpx.MockTransport(_record)
    monkeypatch.setattr(
        discovery.httpx,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )
    monkeypatch.setattr(netsafety, "resolve_host_addresses", _addresses)
    return requests


def _json_response(payload: dict) -> httpx.Response:
    return httpx.Response(
        200, content=json.dumps(payload), headers={"content-type": "application/json"}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "server_url",
    [
        "http://mcp.example.com/mcp",  # plaintext scheme
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata IP literal
        "https://[::1]/mcp",  # IPv6 loopback literal
        "https://127.0.0.1/mcp",  # IPv4 loopback literal
        "https://10.0.0.8/mcp",  # RFC 1918 literal
        "https://user@mcp.example.com/mcp",  # userinfo smuggling
        "ftp://mcp.example.com/mcp",  # non-HTTP scheme
    ],
)
async def test_protected_resource_discovery_refuses_unsafe_urls(
    monkeypatch: pytest.MonkeyPatch, server_url: str
) -> None:
    requests = _install(monkeypatch, lambda _request: httpx.Response(500))
    with pytest.raises(IntegrationOAuthProviderError):
        await discovery.discover_protected_resource_metadata(server_url)
    assert requests == []  # refused before any request left the process


@pytest.mark.asyncio
async def test_protected_resource_discovery_refuses_private_dns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install(
        monkeypatch,
        lambda _request: httpx.Response(500),
        resolved=("10.13.37.1",),
    )
    with pytest.raises(IntegrationOAuthProviderError):
        await discovery.discover_protected_resource_metadata("https://internal.corp/mcp")
    assert requests == []


@pytest.mark.asyncio
async def test_unsafe_resource_metadata_pointer_is_skipped_not_fetched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A hostile ``WWW-Authenticate`` pointer must not steer the fetch."""

    metadata = {
        "authorization_servers": ["https://auth.example.com"],
        "resource": "https://mcp.example.com",
    }

    def _handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/mcp":
            return httpx.Response(
                401,
                headers={
                    "www-authenticate": (
                        'Bearer resource_metadata="http://169.254.169.254/latest/meta-data/"'
                    )
                },
            )
        if request.url.path.startswith("/.well-known/oauth-protected-resource"):
            return _json_response(metadata)
        return httpx.Response(404)

    requests = _install(monkeypatch, _handler)
    result = await discovery.discover_protected_resource_metadata("https://mcp.example.com/mcp")
    assert result.authorization_servers == ("https://auth.example.com",)
    fetched_hosts = {str(request.url.host) for request in requests}
    assert fetched_hosts == {"mcp.example.com"}  # the metadata IP was never contacted


@pytest.mark.asyncio
async def test_redirects_are_not_followed(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://127.0.0.1/steal"})

    requests = _install(monkeypatch, _handler)
    with pytest.raises(IntegrationOAuthProviderError):
        await discovery.discover_protected_resource_metadata("https://mcp.example.com/mcp")
    assert all(str(request.url.host) == "mcp.example.com" for request in requests)


@pytest.mark.asyncio
async def test_authorization_metadata_discovery_refuses_unsafe_issuer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install(monkeypatch, lambda _request: _json_response(_AUTH_METADATA))
    with pytest.raises(IntegrationOAuthProviderError):
        await discovery.discover_authorization_server_metadata("http://auth.internal")
    assert requests == []


@pytest.mark.asyncio
async def test_authorization_metadata_rejects_non_https_token_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = dict(_AUTH_METADATA, token_endpoint="http://169.254.169.254/token")
    _install(monkeypatch, lambda _request: _json_response(payload))
    with pytest.raises(IntegrationOAuthProviderError):
        await discovery.discover_authorization_server_metadata("https://auth.example.com")


@pytest.mark.asyncio
async def test_happy_path_discovery_still_works(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-authorization-server":
            return _json_response(_AUTH_METADATA)
        return httpx.Response(404)

    _install(monkeypatch, _handler)
    metadata = await discovery.discover_authorization_server_metadata("https://auth.example.com")
    assert metadata.token_endpoint == "https://auth.example.com/token"
    assert metadata.authorization_endpoint == "https://auth.example.com/authorize"
