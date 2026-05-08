"""AnyHarness runtime worktree retention operations."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError


async def update_runtime_worktree_retention_policy(
    runtime_url: str,
    access_token: str,
    *,
    max_materialized_worktrees_per_repo: int,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.put(
                f"{runtime_url}/v1/worktrees/retention-policy",
                headers=auth_headers(access_token),
                json={
                    "maxMaterializedWorktreesPerRepo": max_materialized_worktrees_per_repo,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to sync cloud worktree retention policy to the runtime."
        ) from exc


async def run_runtime_worktree_retention(
    runtime_url: str,
    access_token: str,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/worktrees/retention/run",
                headers=auth_headers(access_token),
                json={},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to run deferred cloud worktree retention cleanup."
        ) from exc
