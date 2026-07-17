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
async def test_list_runtime_workspaces_normalizes_live_session_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                method="GET",
                json=[
                    {
                        "id": "workspace-1",
                        "executionSummary": {"liveSessionCount": 2},
                    },
                    {
                        "id": "workspace-2",
                        "executionSummary": {"liveSessionCount": 0},
                    },
                ],
            )
        ]
    )
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    summaries = await workspaces.list_runtime_workspaces(
        "https://runtime.invalid",
        "runtime-token",
    )

    assert [(item.workspace_id, item.live_session_count) for item in summaries] == [
        ("workspace-1", 2),
        ("workspace-2", 0),
    ]


def _clean_git_status_payload() -> dict[str, object]:
    return {
        "workspaceId": "ws-1",
        "workspacePath": "/w/ws-1",
        "repoRootPath": "/w",
        "currentBranch": "feature/x",
        "headOid": "abc123",
        "detached": False,
        "upstreamBranch": "origin/feature/x",
        "suggestedBaseBranch": "main",
        "ahead": 0,
        "behind": 0,
        "operation": "none",
        "conflicted": False,
        "clean": True,
    }


@pytest.mark.asyncio
async def test_get_runtime_git_status_parses_current_contract_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(200, method="GET", json=_clean_git_status_payload())])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    snapshot = await workspaces.get_runtime_git_status(
        "https://runtime.invalid",
        "runtime-token",
        anyharness_workspace_id="ws-1",
    )

    assert snapshot.current_branch == "feature/x"
    assert snapshot.head_oid == "abc123"
    assert snapshot.upstream_branch == "origin/feature/x"
    assert snapshot.ahead == 0 and snapshot.behind == 0
    assert snapshot.operation == "none"
    assert snapshot.clean is True and snapshot.conflicted is False
    assert snapshot.detached is False


@pytest.mark.asyncio
async def test_get_runtime_git_status_allows_missing_optional_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _clean_git_status_payload()
    payload["currentBranch"] = None
    payload["upstreamBranch"] = None
    payload["suggestedBaseBranch"] = None
    payload["detached"] = True
    client = _FakeAsyncClient([_response(200, method="GET", json=payload)])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    snapshot = await workspaces.get_runtime_git_status(
        "https://runtime.invalid",
        "runtime-token",
        anyharness_workspace_id="ws-1",
    )
    assert snapshot.current_branch is None
    assert snapshot.upstream_branch is None
    assert snapshot.detached is True


@pytest.mark.asyncio
async def test_get_runtime_git_status_rejects_missing_required_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _clean_git_status_payload()
    del payload["headOid"]
    client = _FakeAsyncClient([_response(200, method="GET", json=payload)])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="headOid"):
        await workspaces.get_runtime_git_status(
            "https://runtime.invalid",
            "runtime-token",
            anyharness_workspace_id="ws-1",
        )


@pytest.mark.asyncio
async def test_get_runtime_git_status_rejects_unknown_operation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _clean_git_status_payload()
    payload["operation"] = "bisect"
    client = _FakeAsyncClient([_response(200, method="GET", json=payload)])
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="unknown operation"):
        await workspaces.get_runtime_git_status(
            "https://runtime.invalid",
            "runtime-token",
            anyharness_workspace_id="ws-1",
        )


@pytest.mark.asyncio
async def test_get_runtime_git_status_transport_failure_is_typed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(httpx.ConnectError("boom"))
    monkeypatch.setattr(workspaces.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(CloudRuntimeReconnectError, match="Failed to read"):
        await workspaces.get_runtime_git_status(
            "https://runtime.invalid",
            "runtime-token",
            anyharness_workspace_id="ws-1",
        )
