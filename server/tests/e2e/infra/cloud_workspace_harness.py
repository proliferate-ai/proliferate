"""Thin control-plane E2E client for real cloud workspaces."""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Literal

import httpx

from tests.e2e.cloud.helpers.shared import DEFAULT_CLOUD_TEST_TIMEOUT_SECONDS

CloudProviderKind = Literal["e2b", "daytona"]


@dataclass(frozen=True)
class CloudWorkspaceTestConfig:
    provider: CloudProviderKind
    base_url: str
    access_token: str
    git_owner: str
    git_repo_name: str
    base_branch: str
    branch_prefix: str


@dataclass
class CloudWorkspaceHarness:
    config: CloudWorkspaceTestConfig
    client: httpx.AsyncClient

    @classmethod
    async def from_env(cls, provider: CloudProviderKind) -> CloudWorkspaceHarness:
        config = CloudWorkspaceTestConfig(
            provider=provider,
            base_url=_require_provider_env("PROLIFERATE_CLOUD_BASE_URL", provider),
            access_token=_require_provider_env("PROLIFERATE_CLOUD_ACCESS_TOKEN", provider),
            git_owner=_require_provider_env("PROLIFERATE_CLOUD_GIT_OWNER", provider),
            git_repo_name=_require_provider_env("PROLIFERATE_CLOUD_GIT_REPO", provider),
            base_branch=_provider_env("PROLIFERATE_CLOUD_BASE_BRANCH", provider, default="main"),
            branch_prefix=_provider_env(
                "PROLIFERATE_CLOUD_BRANCH_PREFIX",
                provider,
                default=f"codex-e2e-{provider}",
            ),
        )
        client = httpx.AsyncClient(
            base_url=config.base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {config.access_token}"},
            timeout=60.0,
        )
        return cls(config=config, client=client)

    async def close(self) -> None:
        await self.client.aclose()

    async def create_workspace(self) -> dict[str, Any]:
        branch_name = f"{self.config.branch_prefix}-{int(time.time())}"
        response = await self.client.post(
            "/v1/cloud/workspaces",
            json={
                "gitProvider": "github",
                "gitOwner": self.config.git_owner,
                "gitRepoName": self.config.git_repo_name,
                "baseBranch": self.config.base_branch,
                "branchName": branch_name,
                "displayName": f"{self.config.git_owner}/{self.config.git_repo_name}",
            },
        )
        if response.status_code >= 400:
            detail = response.text.strip() or "<empty response body>"
            raise RuntimeError(f"Cloud workspace create failed ({response.status_code}): {detail}")
        return response.json()

    async def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        response = await self.client.get(f"/v1/cloud/workspaces/{workspace_id}")
        response.raise_for_status()
        return response.json()

    async def wait_for_status(
        self,
        workspace_id: str,
        status: str,
        timeout_seconds: float = DEFAULT_CLOUD_TEST_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        last_payload: dict[str, Any] | None = None
        while asyncio.get_running_loop().time() < deadline:
            payload = await self.get_workspace(workspace_id)
            last_payload = payload
            if payload["status"] == status:
                return payload
            if payload["status"] == "error":
                last_error = payload.get("lastError") or "unknown error"
                raise RuntimeError(
                    "Workspace "
                    f"{workspace_id} entered error while waiting for "
                    f"{status!r}: {last_error}"
                )
            await asyncio.sleep(2.0)
        last_status = last_payload.get("status") if last_payload else "unknown"
        last_error = last_payload.get("lastError") if last_payload else None
        raise TimeoutError(
            f"Workspace {workspace_id} did not reach status '{status}' within "
            f"{timeout_seconds:.0f}s (last status: {last_status}, "
            f"last error: {last_error or 'n/a'})"
        )

    async def delete_workspace(self, workspace_id: str) -> None:
        response = await self.client.delete(f"/v1/cloud/workspaces/{workspace_id}")
        response.raise_for_status()

    async def get_connection(self, workspace_id: str) -> dict[str, Any]:
        response = await self.client.get(f"/v1/cloud/workspaces/{workspace_id}/connection")
        response.raise_for_status()
        return response.json()

    async def get_runtime_workspace(self, connection: dict[str, Any]) -> dict[str, Any]:
        workspace_id = connection.get("anyharnessWorkspaceId")
        if not workspace_id:
            raise RuntimeError("Workspace connection did not include anyharnessWorkspaceId")
        async with self.runtime_client(connection) as client:
            response = await client.get(f"/v1/workspaces/{workspace_id}")
            response.raise_for_status()
            return response.json()

    async def create_runtime_workspace(
        self,
        connection: dict[str, Any],
        *,
        path: str,
    ) -> dict[str, Any]:
        async with self.runtime_client(connection) as client:
            response = await client.post("/v1/workspaces", json={"path": path})
            response.raise_for_status()
            return response.json()

    async def run_runtime_command(
        self,
        connection: dict[str, Any],
        *,
        workspace_id: str,
        command: list[str],
        cwd: str = ".",
        timeout_ms: int = 120_000,
        max_output_bytes: int = 1_000_000,
    ) -> dict[str, Any]:
        async with self.runtime_client(connection) as client:
            response = await client.post(
                f"/v1/workspaces/{workspace_id}/processes/run",
                json={
                    "command": command,
                    "cwd": cwd,
                    "timeoutMs": timeout_ms,
                    "maxOutputBytes": max_output_bytes,
                },
            )
            response.raise_for_status()
            return response.json()

    async def wait_for_connection(
        self,
        workspace_id: str,
        timeout_seconds: float = 120,
    ) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        while asyncio.get_running_loop().time() < deadline:
            try:
                return await self.get_connection(workspace_id)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code != 409:
                    raise
            await asyncio.sleep(2.0)
        raise TimeoutError(f"Workspace {workspace_id} did not expose a runtime connection in time")

    def runtime_client(self, connection: dict[str, Any]) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=str(connection["runtimeUrl"]).rstrip("/"),
            headers={"Authorization": f"Bearer {connection['accessToken']}"},
            timeout=60.0,
        )

    @staticmethod
    def sibling_repo_path(source_repo_path: str, fixture_name: str) -> str:
        source_path = PurePosixPath(source_repo_path)
        slug = _slugify(fixture_name)
        return str(source_path.parent / f"{source_path.name}-{slug}-{int(time.time())}")


def _slugify(value: str) -> str:
    slug = "".join(character.lower() if character.isalnum() else "-" for character in value)
    return slug.strip("-") or "fixture"


def _provider_env(name: str, provider: CloudProviderKind, *, default: str | None = None) -> str:
    provider_key = f"{name}_{provider.upper()}"
    value = os.getenv(provider_key, "").strip() or os.getenv(name, "").strip()
    if value:
        return value
    if default is not None:
        return default
    return ""


def _require_provider_env(name: str, provider: CloudProviderKind) -> str:
    value = _provider_env(name, provider)
    if not value:
        provider_key = f"{name}_{provider.upper()}"
        raise RuntimeError(f"{provider_key} (or fallback {name}) is required for cloud E2E tests")
    return value
