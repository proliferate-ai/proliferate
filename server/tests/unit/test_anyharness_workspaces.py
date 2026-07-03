from __future__ import annotations

from collections.abc import Sequence

import httpx
import pytest

from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.anyharness import workspaces


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[httpx.Response] | Exception) -> None:
        self._responses = responses
        self._index = 0

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, _url: str, **_kwargs: object) -> httpx.Response:
        if isinstance(self._responses, Exception):
            raise self._responses
        response = self._responses[self._index]
        self._index += 1
        return response

    async def post(self, _url: str, **_kwargs: object) -> httpx.Response:
        return await self.get(_url, **_kwargs)


def _response(
    status_code: int,
    *,
    json: object | None = None,
    text: str | None = None,
    method: str = "POST",
    url: str = "https://runtime.invalid/v1/workspaces/resolve",
) -> httpx.Response:
    kwargs: dict[str, object] = {"request": httpx.Request(method, url)}
    if json is not None:
        kwargs["json"] = json
    if text is not None:
        kwargs["text"] = text
    return httpx.Response(status_code, **kwargs)


@pytest.mark.asyncio
async def test_resolve_runtime_workspace_accepts_current_contract_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                json={
                    "repoRoot": {"id": "repo-1"},
                    "workspace": {"id": "workspace-123"},
                },
            )
        ]
    )
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    workspace = await workspaces.resolve_runtime_workspace(
        "https://runtime.invalid",
        "runtime-token",
        runtime_workdir="/workspace",
    )

    assert workspace.workspace_id == "workspace-123"
    assert workspace.repo_root_id == "repo-1"


@pytest.mark.asyncio
async def test_resolve_runtime_workspace_raises_when_response_json_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(200, text="{not-json}")])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="returned invalid JSON"):
        await workspaces.resolve_runtime_workspace(
            "https://runtime.invalid",
            "runtime-token",
            runtime_workdir="/workspace",
        )


@pytest.mark.asyncio
async def test_resolve_runtime_workspace_raises_when_workspace_id_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(200, json={"workspace": {}})])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="valid AnyHarness workspace id"):
        await workspaces.resolve_runtime_workspace(
            "https://runtime.invalid",
            "runtime-token",
            runtime_workdir="/workspace",
        )


@pytest.mark.asyncio
async def test_prepare_runtime_mobility_destination_uses_runtime_problem_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                400,
                json={
                    "title": "Invalid request",
                    "detail": "existing local branch has uncommitted changes",
                },
                url="https://runtime.invalid/v1/repo-roots/repo-1/mobility/prepare-destination",
            )
        ]
    )
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="uncommitted changes"):
        await workspaces.prepare_runtime_mobility_destination(
            "https://runtime.invalid",
            "runtime-token",
            repo_root_id="repo-1",
            requested_branch="feature/move",
            requested_base_sha="abc123",
            destination_id="workspace-1",
        )


@pytest.mark.asyncio
async def test_prepare_runtime_mobility_destination_accepts_current_contract_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                json={
                    "repoRoot": {"id": "repo-1"},
                    "workspace": {"id": "workspace-123"},
                },
                url="https://runtime.invalid/v1/repo-roots/repo-1/mobility/prepare-destination",
            )
        ]
    )
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    workspace = await workspaces.prepare_runtime_mobility_destination(
        "https://runtime.invalid",
        "runtime-token",
        repo_root_id="repo-1",
        requested_branch="feature/move",
        requested_base_sha="abc123",
        destination_id="workspace-1",
    )

    assert workspace.workspace_id == "workspace-123"
    assert workspace.repo_root_id == "repo-1"
