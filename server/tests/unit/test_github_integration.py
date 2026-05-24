from __future__ import annotations

from types import TracebackType

import httpx
import pytest

from proliferate.integrations import github
from proliferate.integrations.github import (
    GitHubIntegrationError,
    GitHubInvalidCursor,
    GitHubRateLimited,
)


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


def _github_response_with_headers(
    status_code: int,
    payload: object,
    *,
    headers: dict[str, str],
) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        headers=headers,
        request=httpx.Request("GET", "https://api.github.com/user/repos"),
    )


@pytest.mark.asyncio
async def test_list_github_repositories_shapes_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeGitHubClient(
        _github_response_with_headers(
            200,
            [
                {
                    "owner": {
                        "login": " acme ",
                        "avatar_url": " https://avatars.example/acme ",
                    },
                    "name": " rocket ",
                    "full_name": " acme/rocket ",
                    "default_branch": " main ",
                    "private": True,
                    "fork": False,
                    "archived": False,
                    "disabled": False,
                    "html_url": " https://github.com/acme/rocket ",
                    "pushed_at": "2026-05-01T00:00:00Z",
                    "updated_at": "2026-05-02T00:00:00Z",
                    "permissions": {"pull": True, "push": True},
                }
            ],
            headers={"link": '<https://api.github.com/user/repos?page=2>; rel="next"'},
        )
    )
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    page = await github.list_github_repositories(
        "token-1",
        cursor=None,
        limit=25,
        affiliation="owner,collaborator",
        visibility="all",
    )

    assert page.next_cursor is not None
    assert len(page.repositories) == 1
    repo = page.repositories[0]
    assert repo.owner == "acme"
    assert repo.name == "rocket"
    assert repo.full_name == "acme/rocket"
    assert repo.default_branch == "main"
    assert repo.private is True
    assert repo.permission == "push"
    assert client.calls == [
        (
            "https://api.github.com/user/repos",
            {
                "headers": {
                    "Authorization": "Bearer token-1",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                "params": {
                    "per_page": 25,
                    "page": 1,
                    "affiliation": "owner,collaborator",
                    "visibility": "all",
                    "sort": "pushed",
                    "direction": "desc",
                },
            },
        )
    ]


@pytest.mark.asyncio
async def test_list_github_repositories_rejects_invalid_cursor() -> None:
    with pytest.raises(GitHubInvalidCursor):
        await github.list_github_repositories(
            "token-1",
            cursor="not-base64",
            limit=25,
            affiliation="owner",
            visibility="all",
        )


@pytest.mark.asyncio
async def test_list_github_repositories_maps_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeGitHubClient(
        httpx.Response(
            403,
            json={"message": "rate limited"},
            headers={"x-ratelimit-remaining": "0", "retry-after": "30"},
            request=httpx.Request("GET", "https://api.github.com/user/repos"),
        )
    )
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(GitHubRateLimited) as exc_info:
        await github.list_github_repositories(
            "token-1",
            cursor=None,
            limit=25,
            affiliation="owner",
            visibility="all",
        )
    assert exc_info.value.retry_after_seconds == 30


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
