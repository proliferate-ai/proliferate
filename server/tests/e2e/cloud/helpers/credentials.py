from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from typing import Any

import httpx

import pytest

from tests.e2e.cloud.helpers.config import claude_relative_path, read_file_as_base64
from tests.e2e.cloud.helpers.auth import refresh_auth_session
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
        entry = build_claude_file_entry(config.claude_auth_path)
        return {
            "authMode": "file",
            "files": [entry],
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

    if provider == "gemini":
        if config.gemini_api_key:
            return {
                "authMode": "env",
                "envVars": {"GEMINI_API_KEY": config.gemini_api_key},
            }
        if config.google_api_key:
            return {
                "authMode": "env",
                "envVars": {
                    "GOOGLE_API_KEY": config.google_api_key,
                    "GOOGLE_GENAI_USE_VERTEXAI": "true",
                },
            }
        if config.gemini_auth_path is None:
            raise CloudE2ETestError("Gemini auth was not found locally.")
        return {
            "authMode": "file",
            "files": [
                {
                    "relativePath": ".gemini/oauth_creds.json",
                    "contentBase64": read_file_as_base64(config.gemini_auth_path),
                },
                {
                    "relativePath": ".gemini/settings.json",
                    "contentBase64": encode_text_as_base64(
                        '{"security":{"auth":{"selectedType":"oauth-personal"}}}'
                    ),
                },
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
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
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
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
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
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
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
    if agent_kind == "gemini" and not (
        cloud_test_config.gemini_api_key
        or cloud_test_config.google_api_key
        or cloud_test_config.gemini_auth_path
    ):
        pytest.skip("Gemini auth is not available locally.")


def encode_text_as_base64(value: str) -> str:
    import base64

    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def build_claude_file_entry(path) -> dict[str, str]:
    relative_path = claude_relative_path(path)
    if relative_path != ".claude.json":
        return {
            "relativePath": relative_path,
            "contentBase64": read_file_as_base64(path),
        }

    contents = json.loads(path.read_text(encoding="utf-8"))
    portable: dict[str, str] = {}
    for key in ("primaryApiKey", "apiKey", "anthropicApiKey", "customApiKey"):
        value = contents.get(key)
        if isinstance(value, str) and value.startswith("sk-ant-"):
            portable[key] = value
    if portable:
        return {
            "relativePath": ".claude.json",
            "contentBase64": encode_text_as_base64(json.dumps(portable)),
        }

    oauth_payload = read_claude_keychain_oauth()
    if oauth_payload is not None:
        return {
            "relativePath": ".claude/.credentials.json",
            "contentBase64": encode_text_as_base64(json.dumps({"claudeAiOauth": oauth_payload})),
        }

    raise CloudE2ETestError(
        "Claude main config did not contain a portable API key and no Claude "
        "keychain OAuth entry was found."
    )


def read_claude_keychain_oauth() -> dict[str, Any] | None:
    for service in ("Claude Code-credentials", "Claude Code"):
        for account in claude_username_candidates():
            try:
                result = subprocess.run(
                    [
                        "security",
                        "find-generic-password",
                        "-s",
                        service,
                        "-a",
                        account,
                        "-w",
                    ],
                    capture_output=True,
                    check=True,
                    text=True,
                )
            except (FileNotFoundError, subprocess.CalledProcessError):
                continue
            try:
                parsed = json.loads(result.stdout.strip())
            except json.JSONDecodeError:
                continue
            oauth = parsed.get("claudeAiOauth")
            if isinstance(oauth, dict) and isinstance(oauth.get("accessToken"), str):
                return oauth
    return None


def claude_username_candidates() -> list[str]:
    values: list[str] = []
    for key in ("USER", "LOGNAME", "USERNAME"):
        value = os.environ.get(key, "")
        if value and value not in values:
            values.append(value)
    home_name = Path.home().name
    if home_name and home_name not in values:
        values.append(home_name)
    return values
