from __future__ import annotations

from types import TracebackType

import httpx
import pytest

from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.anyharness import worktrees


class _FakeAsyncClient:
    def __init__(self, result: httpx.Response | httpx.HTTPError) -> None:
        self.result = result
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def put(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append(("PUT", url, kwargs))
        if isinstance(self.result, httpx.HTTPError):
            raise self.result
        return self.result

    async def post(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append(("POST", url, kwargs))
        if isinstance(self.result, httpx.HTTPError):
            raise self.result
        return self.result


def _response(status_code: int, *, method: str, url: str) -> httpx.Response:
    return httpx.Response(status_code, request=httpx.Request(method, url))


@pytest.mark.asyncio
async def test_update_runtime_worktree_retention_policy_sends_anyharness_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        _response(
            204,
            method="PUT",
            url="https://runtime.invalid/v1/worktrees/retention-policy",
        )
    )
    monkeypatch.setattr(worktrees.httpx, "AsyncClient", lambda **_kwargs: client)

    await worktrees.update_runtime_worktree_retention_policy(
        "https://runtime.invalid",
        "runtime-token",
        max_materialized_worktrees_per_repo=42,
    )

    assert client.calls == [
        (
            "PUT",
            "https://runtime.invalid/v1/worktrees/retention-policy",
            {
                "headers": {"Authorization": "Bearer runtime-token"},
                "json": {"maxMaterializedWorktreesPerRepo": 42},
            },
        )
    ]


@pytest.mark.asyncio
async def test_run_runtime_worktree_retention_sends_anyharness_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        _response(
            204,
            method="POST",
            url="https://runtime.invalid/v1/worktrees/retention/run",
        )
    )
    monkeypatch.setattr(worktrees.httpx, "AsyncClient", lambda **_kwargs: client)

    await worktrees.run_runtime_worktree_retention(
        "https://runtime.invalid",
        "runtime-token",
    )

    assert client.calls == [
        (
            "POST",
            "https://runtime.invalid/v1/worktrees/retention/run",
            {
                "headers": {"Authorization": "Bearer runtime-token"},
                "json": {},
            },
        )
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operation", "message"),
    [
        ("update", "Failed to sync cloud worktree retention policy to the runtime."),
        ("run", "Failed to run deferred cloud worktree retention cleanup."),
    ],
)
async def test_worktree_retention_wraps_http_errors(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    message: str,
) -> None:
    request = httpx.Request("POST", "https://runtime.invalid")
    client = _FakeAsyncClient(httpx.ConnectError("runtime down", request=request))
    monkeypatch.setattr(worktrees.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match=message):
        if operation == "update":
            await worktrees.update_runtime_worktree_retention_policy(
                "https://runtime.invalid",
                "runtime-token",
                max_materialized_worktrees_per_repo=42,
            )
        else:
            await worktrees.run_runtime_worktree_retention(
                "https://runtime.invalid",
                "runtime-token",
            )
