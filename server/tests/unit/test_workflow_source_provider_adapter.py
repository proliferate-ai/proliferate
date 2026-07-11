"""Hardened exact-ref GitHub source adapter tests."""

from __future__ import annotations

import json

import pytest

from proliferate.integrations.github import GitHubIntegrationError
from proliferate.integrations.github import repos as github_repos

pytestmark = pytest.mark.asyncio


class _Response:
    def __init__(
        self,
        status_code: int,
        body: bytes,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def aiter_raw(self, *, chunk_size: int):  # type: ignore[no-untyped-def]
        for offset in range(0, len(self._body), chunk_size):
            yield self._body[offset : offset + chunk_size]


class _Client:
    init_kwargs: dict[str, object] = {}
    request: tuple[str, str, dict[str, str]] | None = None
    response = _Response(200, b"{}")

    def __init__(self, **kwargs: object) -> None:
        type(self).init_kwargs = kwargs

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def stream(self, method: str, path: str, *, headers: dict[str, str]):
        type(self).request = (method, path, headers)
        return type(self).response


async def test_exact_branch_adapter_is_fixed_origin_proxy_free_and_nonredirecting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _Client.response = _Response(
        200,
        json.dumps(
            {
                "ref": "refs/heads/feature/x",
                "object": {"type": "commit", "sha": "A" * 40},
            }
        ).encode(),
    )
    monkeypatch.setattr(github_repos.httpx, "AsyncClient", _Client)

    resolved = await github_repos.get_github_branch_head(
        "provider-token", "acme", "widgets", "feature/x"
    )

    assert resolved == "a" * 40
    assert _Client.init_kwargs["base_url"] == "https://api.github.com"
    assert _Client.init_kwargs["trust_env"] is False
    assert _Client.init_kwargs["follow_redirects"] is False
    assert _Client.request is not None
    method, path, headers = _Client.request
    assert method == "GET"
    assert path == "/repos/acme/widgets/git/ref/heads/feature%2Fx"
    assert headers["Accept-Encoding"] == "identity"


@pytest.mark.parametrize(
    ("status_code", "body"),
    [
        (302, b"redirect denied"),
        (200, b"x" * (64 * 1024 + 1)),
        (
            200,
            json.dumps(
                {
                    "ref": "refs/heads/feature/x",
                    "object": {"type": "tag", "sha": "a" * 40},
                }
            ).encode(),
        ),
        (
            200,
            json.dumps(
                {
                    "ref": "refs/heads/main",
                    "object": {"type": "commit", "sha": "a" * 40},
                }
            ).encode(),
        ),
    ],
)
async def test_exact_branch_adapter_rejects_redirects_and_oversized_responses(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    body: bytes,
) -> None:
    _Client.response = _Response(status_code, body)
    monkeypatch.setattr(github_repos.httpx, "AsyncClient", _Client)

    with pytest.raises(GitHubIntegrationError) as caught:
        await github_repos.get_github_branch_head(
            "provider-token", "acme", "widgets", "feature/x"
        )
    assert "provider-token" not in repr(caught.value)


async def test_exact_branch_adapter_rejects_oversized_declared_length_before_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _UnreadResponse(_Response):
        async def aiter_raw(self, *, chunk_size: int):  # type: ignore[no-untyped-def]
            raise AssertionError(f"body read unexpectedly with chunk size {chunk_size}")
            yield b""  # pragma: no cover

    _Client.response = _UnreadResponse(
        200,
        b"",
        headers={"content-length": str(64 * 1024 + 1)},
    )
    monkeypatch.setattr(github_repos.httpx, "AsyncClient", _Client)

    with pytest.raises(GitHubIntegrationError):
        await github_repos.get_github_branch_head(
            "provider-token", "acme", "widgets", "feature/x"
        )
