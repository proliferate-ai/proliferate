from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from proliferate.integrations.integration_oauth import revocation
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError


def _install_response(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response: httpx.Response,
) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    async def _public_addresses(_hostname: str, _port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return response

    async_client = httpx.AsyncClient
    transport = httpx.MockTransport(_handler)
    monkeypatch.setattr(
        revocation.httpx,
        "AsyncClient",
        lambda **_kwargs: async_client(transport=transport),
    )
    monkeypatch.setattr(revocation, "_resolve_host_addresses", _public_addresses)
    return requests


@pytest.mark.asyncio
async def test_standard_revocation_uses_exact_form_and_basic_client_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install_response(monkeypatch, response=httpx.Response(200))

    await revocation.revoke_token(
        revocation_endpoint="https://issuer.example/oauth/revoke",
        issuer="https://issuer.example",
        token_endpoint="https://issuer.example/oauth/token",
        token="refresh-secret",
        token_type_hint="refresh_token",
        client_id="client-public-id",
        client_secret="client-secret",
        token_endpoint_auth_method="client_secret_basic",
        provider_namespace="linear",
    )

    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://93.184.216.34/oauth/revoke"
    assert request.headers["host"] == "issuer.example"
    assert request.extensions["sni_hostname"] == "issuer.example"
    assert request.headers["authorization"].startswith("Basic ")
    assert parse_qs(request.content.decode()) == {
        "token": ["refresh-secret"],
        "token_type_hint": ["refresh_token"],
    }


@pytest.mark.asyncio
async def test_public_client_revocation_includes_client_id_in_form(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install_response(monkeypatch, response=httpx.Response(200))

    await revocation.revoke_token(
        revocation_endpoint="https://issuer.example/oauth/revoke",
        issuer="https://issuer.example",
        token_endpoint="https://issuer.example/oauth/token",
        token="access-secret",
        token_type_hint="access_token",
        client_id="public-client",
        client_secret=None,
        token_endpoint_auth_method="none",
        provider_namespace="sentry",
    )

    assert parse_qs(requests[0].content.decode()) == {
        "token": ["access-secret"],
        "token_type_hint": ["access_token"],
        "client_id": ["public-client"],
    }
    assert "authorization" not in requests[0].headers


@pytest.mark.asyncio
async def test_slack_revocation_uses_user_token_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install_response(
        monkeypatch,
        response=httpx.Response(200, json={"ok": True, "revoked": True}),
    )

    await revocation.revoke_token(
        revocation_endpoint="https://slack.com/api/auth.revoke",
        issuer="https://slack.com",
        token_endpoint="https://slack.com/api/oauth.v2.access",
        token="xoxe-user-secret",
        token_type_hint="access_token",
        client_id="ignored-client",
        client_secret="ignored-secret",
        token_endpoint_auth_method="client_secret_post",
        provider_namespace="slack",
    )

    assert parse_qs(requests[0].content.decode()) == {"token": ["xoxe-user-secret"]}
    assert "authorization" not in requests[0].headers


@pytest.mark.asyncio
async def test_slack_private_error_payload_is_not_exposed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_response(
        monkeypatch,
        response=httpx.Response(
            200,
            json={"ok": False, "error": "provider-private", "token": "must-not-leak"},
        ),
    )

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await revocation.revoke_token(
            revocation_endpoint="https://slack.com/api/auth.revoke",
            issuer="https://slack.com",
            token_endpoint="https://slack.com/api/oauth.v2.access",
            token="xoxe-user-secret",
            token_type_hint="access_token",
            client_id="client",
            client_secret=None,
            token_endpoint_auth_method="none",
            provider_namespace="slack",
        )

    assert exc_info.value.code == "revocation_rejected"
    assert "provider-private" not in str(exc_info.value)
    assert "must-not-leak" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_unsupported_client_auth_fails_before_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install_response(monkeypatch, response=httpx.Response(200))

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await revocation.revoke_token(
            revocation_endpoint="https://issuer.example/oauth/revoke",
            issuer="https://issuer.example",
            token_endpoint="https://issuer.example/oauth/token",
            token="refresh-secret",
            token_type_hint="refresh_token",
            client_id="client",
            client_secret="secret",
            token_endpoint_auth_method="private_key_jwt",
            provider_namespace="linear",
        )

    assert exc_info.value.code == "unsupported_client_auth"
    assert requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [
        "http://issuer.example/oauth/revoke",
        "https://other.example/oauth/revoke",
        "https://user:password@issuer.example/oauth/revoke",
    ],
)
async def test_revocation_rejects_plaintext_cross_origin_and_credentialed_urls(
    monkeypatch: pytest.MonkeyPatch,
    endpoint: str,
) -> None:
    requests = _install_response(monkeypatch, response=httpx.Response(200))

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await revocation.revoke_token(
            revocation_endpoint=endpoint,
            issuer="https://issuer.example",
            token_endpoint="https://tokens.example/oauth/token",
            token="refresh-secret",
            token_type_hint="refresh_token",
            client_id="client",
            client_secret="secret",
            token_endpoint_auth_method="client_secret_post",
            provider_namespace="linear",
        )

    assert exc_info.value.code == "revocation_endpoint_invalid"
    assert requests == []


@pytest.mark.asyncio
async def test_revocation_rejects_private_dns_before_sending_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _install_response(monkeypatch, response=httpx.Response(200))

    async def _private_addresses(_hostname: str, _port: int) -> tuple[str, ...]:
        return ("169.254.169.254",)

    monkeypatch.setattr(revocation, "_resolve_host_addresses", _private_addresses)
    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await revocation.revoke_token(
            revocation_endpoint="https://issuer.example/oauth/revoke",
            issuer="https://issuer.example",
            token_endpoint="https://issuer.example/oauth/token",
            token="refresh-secret",
            token_type_hint="refresh_token",
            client_id="client",
            client_secret="secret",
            token_endpoint_auth_method="client_secret_post",
            provider_namespace="linear",
        )

    assert exc_info.value.code == "revocation_endpoint_invalid"
    assert requests == []
