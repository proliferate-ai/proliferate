from __future__ import annotations

import httpx
import pytest

from proliferate.integrations.integration_oauth import tokens
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.tokens import (
    _granted_scopes,
    exchange_token,
    refresh_token,
)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"scope": "one two"}, ("one", "two")),
        ({"scope": "one,two"}, ("one", "two")),
        ({"scope": "one, two one"}, ("one", "two")),
        (
            {"authed_user": {"scope": "search:read.public,search:read.private"}},
            ("search:read.public", "search:read.private"),
        ),
        ({"scope": "top", "authed_user": {"scope": "nested"}}, ("top",)),
        ({"scope": ""}, ()),
        ({"authed_user": {"scope": ""}}, ()),
        ({}, None),
    ],
)
def test_granted_scopes_normalizes_standard_and_slack_payloads(
    payload: dict[str, object], expected: tuple[str, ...] | None
) -> None:
    assert _granted_scopes(payload) == expected


def _install_token_response(
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, object],
) -> None:
    async_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=payload))
    monkeypatch.setattr(
        tokens.httpx,
        "AsyncClient",
        lambda **_kwargs: async_client(transport=transport),
    )


@pytest.mark.parametrize(
    ("provider_error", "expected_code"),
    [
        ("bad_client_secret", "invalid_client"),
        ("invalid_code", "invalid_grant"),
        ("unexpected_slack_failure", "token_request_failed"),
    ],
)
@pytest.mark.asyncio
async def test_slack_exchange_translates_http_2xx_error_payload(
    monkeypatch: pytest.MonkeyPatch,
    provider_error: str,
    expected_code: str,
) -> None:
    _install_token_response(
        monkeypatch,
        {"ok": False, "error": provider_error, "private": "must-not-leak"},
    )

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await exchange_token(
            token_endpoint="https://slack.com/api/oauth.v2.user.access",
            client_id="client",
            code="code",
            code_verifier="verifier",
            redirect_uri="https://api.example.com/callback",
            resource="https://mcp.slack.com/mcp",
        )

    assert exc_info.value.code == expected_code
    assert provider_error not in str(exc_info.value)
    assert "must-not-leak" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_slack_refresh_translates_http_2xx_invalid_refresh_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_token_response(
        monkeypatch,
        {"ok": False, "error": "invalid_refresh_token", "token": "must-not-leak"},
    )

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await refresh_token(
            token_endpoint="https://slack.com/api/oauth.v2.user.access",
            client_id="client",
            refresh_token_value="refresh",
            resource="https://mcp.slack.com/mcp",
        )

    assert exc_info.value.code == "invalid_grant"
    assert "invalid_refresh_token" not in str(exc_info.value)
    assert "must-not-leak" not in str(exc_info.value)


@pytest.mark.parametrize(
    ("token_endpoint", "provider_namespace"),
    [
        ("https://slack.com/api/oauth.v2.user.access/", None),
        ("HTTPS://SLACK.COM/api/oauth.v2.user.access", None),
        ("https://slack.com:443/api/oauth.v2.user.access", None),
        ("https://slack.com/api/oauth.v3.user.access", "slack"),
    ],
)
@pytest.mark.asyncio
async def test_slack_exchange_translates_2xx_error_for_endpoint_variants(
    monkeypatch: pytest.MonkeyPatch,
    token_endpoint: str,
    provider_namespace: str | None,
) -> None:
    _install_token_response(
        monkeypatch,
        {"ok": False, "error": "invalid_code", "private": "must-not-leak"},
    )

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        await exchange_token(
            token_endpoint=token_endpoint,
            client_id="client",
            code="code",
            code_verifier="verifier",
            redirect_uri="https://api.example.com/callback",
            resource="https://mcp.slack.com/mcp",
            provider_namespace=provider_namespace,
        )

    assert exc_info.value.code == "invalid_grant"
    assert "invalid_code" not in str(exc_info.value)
    assert "must-not-leak" not in str(exc_info.value)


@pytest.mark.parametrize(
    ("token_endpoint", "provider_namespace"),
    [
        ("https://slack.com/api/oauth.v2.user.access", "linear"),
        ("https://slack.com.evil.example/api/oauth.v2.user.access", None),
        ("http://slack.com/api/oauth.v2.user.access", None),
        ("https://slack.com:444/api/oauth.v2.user.access", None),
        ("https://user:secret@slack.com/api/oauth.v2.user.access", None),
        ("https://slack.com/api/oauth.v2.user.access?variant=true", None),
        ("https://slack.com/api/oauth.v2.user.access#fragment", None),
        ("https://slack.com/api/oauth.v3.user.access", None),
    ],
)
@pytest.mark.asyncio
async def test_other_provider_identity_and_noncanonical_urls_preserve_behavior(
    monkeypatch: pytest.MonkeyPatch,
    token_endpoint: str,
    provider_namespace: str | None,
) -> None:
    _install_token_response(
        monkeypatch,
        {"ok": False, "access_token": "other-provider-token"},
    )

    token = await exchange_token(
        token_endpoint=token_endpoint,
        client_id="client",
        code="code",
        code_verifier="verifier",
        redirect_uri="https://api.example.com/callback",
        resource="https://mcp.example.com/mcp",
        provider_namespace=provider_namespace,
    )

    assert token.access_token == "other-provider-token"
