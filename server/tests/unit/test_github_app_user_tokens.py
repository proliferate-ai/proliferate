from __future__ import annotations

from types import TracebackType

import httpx
import pytest

from proliferate.integrations.github import app_user_tokens
from proliferate.integrations.github.app_user_tokens import GitHubAppInvalidGrant
from proliferate.integrations.github.repos import GitHubIntegrationError


class _FakeTokenClient:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response

    async def __aenter__(self) -> _FakeTokenClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def post(self, *_args: object, **_kwargs: object) -> httpx.Response:
        return self.response


def _token_response(status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request("POST", "https://github.com/login/oauth/access_token"),
    )


@pytest.mark.asyncio
async def test_refresh_maps_bad_refresh_token_to_permanent_invalid_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_detail = "provider detail must stay private"
    client = _FakeTokenClient(
        _token_response(
            400,
            {
                "error": "bad_refresh_token",
                "error_description": provider_detail,
            },
        )
    )
    monkeypatch.setattr(app_user_tokens.settings, "github_app_client_id", "client-id")
    monkeypatch.setattr(app_user_tokens.settings, "github_app_client_secret", "client-secret")
    monkeypatch.setattr(app_user_tokens.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(GitHubAppInvalidGrant) as exc_info:
        await app_user_tokens.refresh_github_app_user_authorization(
            refresh_token="expired-refresh-token"
        )

    assert provider_detail not in str(exc_info.value)


@pytest.mark.asyncio
async def test_refresh_keeps_transient_provider_failure_generic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_detail = "upstream body must stay private"
    client = _FakeTokenClient(
        _token_response(
            502,
            {
                "error": "temporarily_unavailable",
                "error_description": provider_detail,
            },
        )
    )
    monkeypatch.setattr(app_user_tokens.settings, "github_app_client_id", "client-id")
    monkeypatch.setattr(app_user_tokens.settings, "github_app_client_secret", "client-secret")
    monkeypatch.setattr(app_user_tokens.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(GitHubIntegrationError) as exc_info:
        await app_user_tokens.refresh_github_app_user_authorization(
            refresh_token="still-valid-refresh-token"
        )

    assert not isinstance(exc_info.value, GitHubAppInvalidGrant)
    assert provider_detail not in str(exc_info.value)
