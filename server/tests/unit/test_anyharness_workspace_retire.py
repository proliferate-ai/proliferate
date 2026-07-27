from __future__ import annotations

from types import TracebackType

import httpx
import pytest

from proliferate.integrations.anyharness import workspaces


class _FakeAsyncClient:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def post(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append((url, kwargs))
        return self.response


@pytest.mark.asyncio
async def test_retire_runtime_workspace_posts_encoded_workspace_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://runtime.invalid/v1/workspaces/workspace%2F1/retire"
    response = httpx.Response(
        200,
        request=httpx.Request("POST", url),
        json={
            "outcome": "retired",
            "cleanupSucceeded": True,
        },
    )
    client = _FakeAsyncClient(response)
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    await workspaces.retire_runtime_workspace(
        "https://runtime.invalid",
        "runtime-token",
        anyharness_workspace_id="workspace/1",
    )

    assert client.calls == [
        (
            url,
            {
                "headers": {"Authorization": "Bearer runtime-token"},
                "json": {},
            },
        )
    ]
