from __future__ import annotations

from types import TracebackType

import httpx
import pytest

from proliferate.integrations import github
from proliferate.integrations.github import GitHubIntegrationError


class _FakeGitHubClient:
    def __init__(self, result: httpx.Response | httpx.HTTPError) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def __aenter__(self) -> _FakeGitHubClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def get(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append((url, kwargs))
        if isinstance(self.result, httpx.HTTPError):
            raise self.result
        return self.result


def _github_response(status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request("GET", "https://api.github.com/user"),
    )


@pytest.mark.asyncio
async def test_get_github_user_profile_shapes_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeGitHubClient(
        _github_response(
            200,
            {
                "login": " octocat ",
                "avatar_url": " https://avatars.githubusercontent.com/u/1 ",
                "name": " The Octocat ",
            },
        )
    )
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    profile = await github.get_github_user_profile("token-1")

    assert profile.login == "octocat"
    assert profile.avatar_url == "https://avatars.githubusercontent.com/u/1"
    assert profile.display_name == "The Octocat"
    assert client.calls == [
        (
            "https://api.github.com/user",
            {
                "headers": {
                    "Authorization": "Bearer token-1",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            },
        )
    ]


@pytest.mark.asyncio
async def test_get_github_user_profile_normalizes_blank_optional_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeGitHubClient(
        _github_response(200, {"login": "octocat", "avatar_url": " ", "name": ""})
    )
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    profile = await github.get_github_user_profile("token-1")

    assert profile.login == "octocat"
    assert profile.avatar_url is None
    assert profile.display_name is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        _github_response(401, {"message": "bad credentials"}),
        _github_response(500, {"message": "unavailable"}),
        _github_response(200, []),
        _github_response(200, {"avatar_url": "https://avatars.example/u/1"}),
        _github_response(200, {"login": "   "}),
        httpx.Response(
            200,
            text="not json",
            request=httpx.Request("GET", "https://api.github.com/user"),
        ),
    ],
)
async def test_get_github_user_profile_rejects_invalid_responses(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response,
) -> None:
    client = _FakeGitHubClient(response)
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(GitHubIntegrationError):
        await github.get_github_user_profile("token-1")


@pytest.mark.asyncio
async def test_get_github_user_profile_wraps_http_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = httpx.Request("GET", "https://api.github.com/user")
    client = _FakeGitHubClient(httpx.ConnectError("github down", request=request))
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(GitHubIntegrationError):
        await github.get_github_user_profile("token-1")
