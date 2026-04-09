from __future__ import annotations

from typing import Any

import httpx

import pytest

from tests.e2e.cloud.helpers.config import claude_relative_path, read_file_as_base64
from tests.e2e.cloud.helpers.shared import AuthSession, CloudE2ETestError, CloudTestConfig


def build_sync_payload(config: CloudTestConfig, provider: str) -> dict[str, Any]:
    if provider == "claude":
        if config.anthropic_api_key:
            return {
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": config.anthropic_api_key},
            }
        if config.claude_auth_path is None:
            raise CloudE2ETestError("Claude auth file was not found locally.")
        return {
            "authMode": "file",
            "files": [
                {
                    "relativePath": claude_relative_path(config.claude_auth_path),
                    "contentBase64": read_file_as_base64(config.claude_auth_path),
                }
            ],
        }

    if provider == "codex":
        if config.codex_auth_path is None:
            raise CloudE2ETestError("Codex auth file was not found locally.")
        return {
            "authMode": "file",
            "files": [
                {
                    "relativePath": ".codex/auth.json",
                    "contentBase64": read_file_as_base64(config.codex_auth_path),
                }
            ],
        }

    raise CloudE2ETestError(f"Unsupported provider {provider!r}")


async def sync_cloud_credential(
    client: httpx.AsyncClient,
    auth: AuthSession,
    config: CloudTestConfig,
    provider: str,
) -> list[dict[str, Any]]:
    response = await client.put(
        f"/v1/cloud/credentials/{provider}",
        headers=auth.headers,
        json=build_sync_payload(config, provider),
    )
    response.raise_for_status()
    return await list_cloud_credentials(client, auth)


async def list_cloud_credentials(
    client: httpx.AsyncClient,
    auth: AuthSession,
) -> list[dict[str, Any]]:
    response = await client.get("/v1/cloud/credentials", headers=auth.headers)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise CloudE2ETestError("Cloud credential status response was not a list.")
    return payload


async def delete_cloud_credential(
    client: httpx.AsyncClient,
    auth: AuthSession,
    provider: str,
) -> list[dict[str, Any]]:
    response = await client.delete(
        f"/v1/cloud/credentials/{provider}",
        headers=auth.headers,
    )
    response.raise_for_status()
    return await list_cloud_credentials(client, auth)


def status_for_provider(
    statuses: list[dict[str, object]],
    provider: str,
) -> dict[str, object]:
    for status in statuses:
        if status.get("provider") == provider:
            return status
    raise AssertionError(f"Missing credential status for {provider}")


def require_local_auth(
    cloud_test_config: CloudTestConfig,
    agent_kind: str,
) -> None:
    if agent_kind == "claude" and not (
        cloud_test_config.anthropic_api_key or cloud_test_config.claude_auth_path
    ):
        pytest.skip("Claude auth is not available locally.")
    if agent_kind == "codex" and cloud_test_config.codex_auth_path is None:
        pytest.skip("Codex auth is not available locally.")
