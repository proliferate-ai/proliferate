from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.server.cloud.runtime import worktree_policy_sync


@pytest.mark.asyncio
async def test_sync_policy_can_trigger_deferred_cleanup_without_awaiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid4()
    calls: list[str] = []
    cleanup_started = asyncio.Event()
    cleanup_release = asyncio.Event()
    cleanup_finished = asyncio.Event()

    async def _get_policy(_user_id):
        return SimpleNamespace(max_materialized_worktrees_per_repo=42)

    async def _update_policy(*_args, **_kwargs) -> None:
        calls.append("update_policy")

    async def _run_retention(*_args, **_kwargs) -> None:
        calls.append("run_retention_started")
        cleanup_started.set()
        await cleanup_release.wait()
        calls.append("run_retention_finished")
        cleanup_finished.set()

    monkeypatch.setattr(worktree_policy_sync, "get_worktree_retention_policy", _get_policy)
    monkeypatch.setattr(
        worktree_policy_sync,
        "update_runtime_worktree_retention_policy",
        _update_policy,
    )
    monkeypatch.setattr(
        worktree_policy_sync,
        "run_runtime_worktree_retention",
        _run_retention,
    )

    limit = await worktree_policy_sync.sync_cloud_worktree_policy_to_runtime(
        user_id=uuid4(),
        runtime_url="https://runtime.invalid",
        access_token="token",
        workspace_id=workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )

    assert limit == 42
    assert calls[0] == "update_policy"
    assert not cleanup_finished.is_set()

    await asyncio.wait_for(cleanup_started.wait(), timeout=1)
    assert calls == ["update_policy", "run_retention_started"]

    cleanup_release.set()
    await asyncio.wait_for(cleanup_finished.wait(), timeout=1)
    assert calls == ["update_policy", "run_retention_started", "run_retention_finished"]
