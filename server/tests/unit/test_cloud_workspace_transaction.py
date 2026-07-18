from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.types import Message, Receive, Scope, Send

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.server.cloud.workspaces import api
from proliferate.server.cloud.workspaces.models import (
    RepoRef,
    WorkspaceDetail,
    WorkspaceRuntimeSummary,
)


@pytest.mark.asyncio
async def test_create_commit_finishes_before_response_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful create is durable before the caller can observe it."""
    app = FastAPI()
    app.include_router(api.router, prefix="/v1/cloud")
    commits_finished = 0
    commits_at_response_start: list[int] = []

    async def observed_session() -> AsyncGenerator[object, None]:
        nonlocal commits_finished
        yield object()
        commits_finished += 1

    async def product_user() -> SimpleNamespace:
        return SimpleNamespace(id="00000000-0000-0000-0000-000000000001")

    async def create_workspace(*_args: object, **_kwargs: object) -> WorkspaceDetail:
        return WorkspaceDetail(
            id="00000000-0000-0000-0000-000000000002",
            workspace_kind="repositoryWorktree",
            repo_environment_id="00000000-0000-0000-0000-000000000003",
            display_name="workspace",
            repo=RepoRef(
                provider="github",
                owner="owner",
                name="repo",
                branch="workspace",
                base_branch="main",
            ),
            status="ready",
            workspace_status="ready",
            product_lifecycle="active",
            runtime=WorkspaceRuntimeSummary(status="running"),
            anyharness_workspace_id="runtime-workspace",
        )

    app.dependency_overrides[get_async_session] = observed_session
    app.dependency_overrides[current_product_user] = product_user
    monkeypatch.setattr(api, "create_cloud_workspace_for_user", create_workspace)

    async def observed_app(scope: Scope, receive: Receive, send: Send) -> None:
        async def observe_response_start(message: Message) -> None:
            if message["type"] == "http.response.start":
                commits_at_response_start.append(commits_finished)
            await send(message)

        await app(scope, receive, observe_response_start)

    async with AsyncClient(
        transport=ASGITransport(app=observed_app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/v1/cloud/workspaces",
            json={
                "gitOwner": "owner",
                "gitRepoName": "repo",
                "branchName": "workspace",
            },
        )

    assert response.status_code == 200
    assert commits_at_response_start == [1]
