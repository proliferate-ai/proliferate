from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import uuid4

import httpx
import pytest

from proliferate.config import settings
from proliferate.db.store.cloud_mcp.types import CloudMcpOAuthClientRecord
from proliferate.integrations import mcp_oauth
from proliferate.integrations.mcp_oauth import (
    AuthorizationServerMetadata,
    McpOAuthProviderError,
)
from proliferate.server.cloud.mcp_catalog.catalog import (
    CatalogEntry,
    HttpLaunchTemplate,
    StaticUrl,
)
from proliferate.server.cloud.mcp_oauth import service as mcp_oauth_service
from proliferate.server.cloud.mcp_oauth.static_clients import (
    StaticOAuthClientConfig,
    get_static_oauth_client_config,
)
from proliferate.utils.crypto import encrypt_text


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
async def test_discovery_records_supported_client_auth_methods(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "issuer": "https://accounts.example.com",
                "authorization_endpoint": "https://accounts.example.com/authorize",
                "token_endpoint": "https://accounts.example.com/token",
                "registration_endpoint": "https://accounts.example.com/register",
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": [
                    "client_secret_post",
                    "client_secret_basic",
                ],
            }

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> _Response:
            return _Response()

    monkeypatch.setattr(mcp_oauth.httpx, "AsyncClient", lambda **_kwargs: _Client())

    metadata = await mcp_oauth.discover_authorization_server_metadata(
        "https://accounts.example.com",
    )

    assert metadata.token_endpoint_auth_methods_supported == (
        "client_secret_post",
        "client_secret_basic",
    )


def _authorization_metadata(
    token_endpoint_auth_methods_supported: tuple[str, ...],
) -> AuthorizationServerMetadata:
    return AuthorizationServerMetadata(
        issuer="https://accounts.example.com",
        authorization_endpoint="https://accounts.example.com/authorize",
        token_endpoint="https://accounts.example.com/token",
        registration_endpoint="https://accounts.example.com/register",
        token_endpoint_auth_methods_supported=token_endpoint_auth_methods_supported,
    )


class _RegisterResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class _RegisterClient:
    def __init__(
        self,
        *,
        calls: list[dict[str, object]],
        payload: dict[str, object],
    ) -> None:
        self._calls = calls
        self._payload = payload

    async def __aenter__(self) -> _RegisterClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(
        self,
        _url: str,
        *,
        json: dict[str, object],
    ) -> _RegisterResponse:
        self._calls.append(json)
        return _RegisterResponse(self._payload)


@pytest.mark.parametrize(
    ("supported_methods", "expected_method"),
    [
        (("none", "client_secret_post"), "none"),
        (("client_secret_post",), "client_secret_post"),
        (("client_secret_basic",), "client_secret_basic"),
        ((), "none"),
    ],
)
@pytest.mark.asyncio
async def test_register_client_requests_supported_token_auth_method(
    monkeypatch: pytest.MonkeyPatch,
    supported_methods: tuple[str, ...],
    expected_method: str,
) -> None:
    calls: list[dict[str, object]] = []
    response_payload = {
        "client_id": "client-id",
        "client_secret": "client-secret",
        "token_endpoint_auth_method": expected_method,
    }

    monkeypatch.setattr(
        mcp_oauth.httpx,
        "AsyncClient",
        lambda **_kwargs: _RegisterClient(calls=calls, payload=response_payload),
    )

    registered = await mcp_oauth.register_client(
        _authorization_metadata(supported_methods),
        "https://api.example.com/oauth/callback",
    )

    assert calls[0]["token_endpoint_auth_method"] == expected_method
    assert registered.token_endpoint_auth_method == expected_method
    assert registered.client_secret == "client-secret"


def test_register_client_rejects_unsupported_token_auth_methods() -> None:
    metadata = _authorization_metadata(("private_key_jwt",))

    with pytest.raises(McpOAuthProviderError) as error:
        mcp_oauth._registration_token_auth_method(metadata)

    assert error.value.code == "unsupported_client_auth"


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


def _oauth_entry(*, mode: Literal["dcr", "static"] = "static") -> CatalogEntry:
    return CatalogEntry(
        id="slack",
        version=1,
        name="Slack",
        one_liner="Slack",
        description="Slack",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode=mode,
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.slack.com/mcp"),
            display_url="https://mcp.slack.com/mcp",
        ),
        server_name_base="slack",
        icon_id="slack",
        capabilities=(),
    )


def _oauth_client_record(
    *,
    resource: str = "https://mcp.slack.com/mcp",
    client_id: str = "client-id",
    client_secret: str | None = "client-secret",
    token_endpoint_auth_method: str | None = "client_secret_post",
) -> CloudMcpOAuthClientRecord:
    now = datetime(2026, 1, 1)
    return CloudMcpOAuthClientRecord(
        id=uuid4(),
        issuer="https://slack.com",
        redirect_uri="https://api.example.com/v1/cloud/mcp/oauth/callback",
        catalog_entry_id="slack",
        resource=resource,
        client_id=client_id,
        client_secret_ciphertext=encrypt_text(client_secret) if client_secret else None,
        client_secret_expires_at=None,
        token_endpoint_auth_method=token_endpoint_auth_method,
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
        created_at=now,
        updated_at=now,
    )


def test_slack_static_oauth_config_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_mcp_slack_enabled", False)
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_id", "slack-client-id")
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "slack-client-secret")
    monkeypatch.setattr(
        settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_post",
    )

    assert get_static_oauth_client_config("slack") is None

    monkeypatch.setattr(settings, "cloud_mcp_slack_enabled", True)
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "")

    assert get_static_oauth_client_config("slack") is None

    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "slack-client-secret")
    monkeypatch.setattr(settings, "cloud_mcp_slack_token_endpoint_auth_method", "none")

    assert get_static_oauth_client_config("slack") is None

    monkeypatch.setattr(settings, "cloud_mcp_slack_token_endpoint_auth_method", "typo")

    assert get_static_oauth_client_config("slack") is None

    monkeypatch.setattr(
        settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_basic",
    )

    config = get_static_oauth_client_config("slack")
    assert config == StaticOAuthClientConfig(
        client_id="slack-client-id",
        client_secret="slack-client-secret",
        token_endpoint_auth_method="client_secret_basic",
    )


@pytest.mark.asyncio
async def test_static_oauth_client_mode_never_calls_dcr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upserts: list[dict[str, object]] = []

    async def _get_oauth_client(**_kwargs: object) -> None:
        return None

    async def _upsert_oauth_client(**kwargs: object) -> CloudMcpOAuthClientRecord:
        upserts.append(kwargs)
        return _oauth_client_record()

    async def _register_client(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("DCR should not be called for static OAuth clients")

    monkeypatch.setattr(mcp_oauth_service, "get_oauth_client", _get_oauth_client)
    monkeypatch.setattr(mcp_oauth_service, "upsert_oauth_client", _upsert_oauth_client)
    monkeypatch.setattr(mcp_oauth_service, "register_client", _register_client)
    monkeypatch.setattr(
        mcp_oauth_service,
        "get_static_oauth_client_config",
        lambda _entry_id: StaticOAuthClientConfig(
            client_id="client-id",
            client_secret="client-secret",
            token_endpoint_auth_method="client_secret_post",
        ),
    )

    client = await mcp_oauth_service._get_oauth_client(
        entry=_oauth_entry(),
        issuer="https://slack.com",
        redirect_uri="https://api.example.com/v1/cloud/mcp/oauth/callback",
        resource="https://mcp.slack.com/mcp",
    )

    assert client.client_id == "client-id"
    assert len(upserts) == 1
    assert upserts[0]["registration_client_uri"] is None
    assert upserts[0]["registration_access_token_ciphertext"] is None


@pytest.mark.asyncio
async def test_static_oauth_client_reuses_matching_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cached = _oauth_client_record()
    upsert_called = False

    async def _get_oauth_client(**_kwargs: object) -> CloudMcpOAuthClientRecord:
        return cached

    async def _upsert_oauth_client(**_kwargs: object) -> CloudMcpOAuthClientRecord:
        nonlocal upsert_called
        upsert_called = True
        return cached

    monkeypatch.setattr(mcp_oauth_service, "get_oauth_client", _get_oauth_client)
    monkeypatch.setattr(mcp_oauth_service, "upsert_oauth_client", _upsert_oauth_client)
    monkeypatch.setattr(
        mcp_oauth_service,
        "get_static_oauth_client_config",
        lambda _entry_id: StaticOAuthClientConfig(
            client_id="client-id",
            client_secret="client-secret",
            token_endpoint_auth_method="client_secret_post",
        ),
    )

    client = await mcp_oauth_service._get_oauth_client(
        entry=_oauth_entry(),
        issuer="https://slack.com",
        redirect_uri="https://api.example.com/v1/cloud/mcp/oauth/callback",
        resource="https://mcp.slack.com/mcp",
    )

    assert client == cached
    assert upsert_called is False


@pytest.mark.asyncio
async def test_static_oauth_client_missing_config_fails_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        mcp_oauth_service,
        "get_static_oauth_client_config",
        lambda _entry_id: None,
    )

    with pytest.raises(McpOAuthProviderError) as error:
        await mcp_oauth_service._get_oauth_client(
            entry=_oauth_entry(),
            issuer="https://slack.com",
            redirect_uri="https://api.example.com/v1/cloud/mcp/oauth/callback",
            resource="https://mcp.slack.com/mcp",
        )

    assert error.value.code == "missing_static_oauth_client"
