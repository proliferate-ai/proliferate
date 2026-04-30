from __future__ import annotations

import httpx
import pytest

from proliferate.integrations import mcp_oauth
from proliferate.integrations.mcp_oauth import McpOAuthProviderError


def test_token_request_defaults_dcr_client_secret_to_post_body() -> None:
    data, auth = mcp_oauth._token_request_auth_options(
        {"client_id": "client-id"},
        client_secret="client-secret",
        token_endpoint_auth_method=None,
    )

    assert auth is None
    assert data == {
        "client_id": "client-id",
        "client_secret": "client-secret",
    }


def test_token_request_supports_client_secret_basic() -> None:
    data, auth = mcp_oauth._token_request_auth_options(
        {"client_id": "client-id"},
        client_secret="client-secret",
        token_endpoint_auth_method="client_secret_basic",
    )

    assert auth == ("client-id", "client-secret")
    assert data == {"client_id": "client-id"}


@pytest.mark.asyncio
async def test_token_request_maps_provider_http_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Response:
        status_code = 422
        text = '{"message":"provider rejected request"}'

        def raise_for_status(self) -> None:
            raise httpx.HTTPStatusError(
                "provider rejected request",
                request=httpx.Request("POST", "https://accounts.example.com/token"),
                response=httpx.Response(422),
            )

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, *_args: object, **_kwargs: object) -> _Response:
            return _Response()

    monkeypatch.setattr(mcp_oauth.httpx, "AsyncClient", lambda **_kwargs: _Client())

    with pytest.raises(McpOAuthProviderError) as error:
        await mcp_oauth._token_request(
            "https://accounts.example.com/token",
            {"client_id": "client-id"},
            client_secret=None,
            token_endpoint_auth_method=None,
        )

    assert error.value.code == "token_request_failed"
