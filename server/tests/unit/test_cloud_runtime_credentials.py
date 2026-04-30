from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.integrations.sandbox import SandboxRuntimeContext
from proliferate.server.cloud.runtime.credentials import (
    ClaudeProvisionCredential,
    CodexProvisionCredential,
    GeminiProvisionCredential,
    MANAGED_CREDENTIAL_FILE_PATHS,
    ProvisionCredentials,
    ProvisionEnvVar,
    write_credential_files,
    normalize_provision_credentials,
)


def test_normalize_provision_credentials_shapes_claude_env_and_codex_file() -> None:
    credentials = normalize_provision_credentials(
        {
            "claude": {
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "anthropic-key"},
            },
            "codex": {
                "authMode": "file",
                "files": {".codex/auth.json": '{"access_token":"opaque"}'},
            },
        }
    )

    assert credentials.synced_providers == ("claude", "codex")
    assert credentials.claude == ClaudeProvisionCredential(api_key="anthropic-key")
    assert credentials.codex == CodexProvisionCredential(auth_json='{"access_token":"opaque"}')


def test_normalize_provision_credentials_filters_unapproved_claude_files() -> None:
    credentials = normalize_provision_credentials(
        {
            "claude": {
                "authMode": "file",
                "files": {
                    ".claude/.credentials.json": '{"oauth":"portable"}',
                    ".claude/ignored.json": '{"oauth":"non-portable"}',
                },
            }
        }
    )

    assert credentials.synced_providers == ("claude",)
    assert credentials.claude is not None
    assert credentials.claude.api_key is None
    assert [file.relative_path for file in credentials.claude.auth_files] == [
        ".claude/.credentials.json"
    ]


def test_normalize_provision_credentials_shapes_gemini_env_and_file() -> None:
    credentials = normalize_provision_credentials(
        {
            "gemini": {
                "authMode": "env",
                "envVars": {
                    "GOOGLE_API_KEY": "google-key",
                    "GOOGLE_GENAI_USE_VERTEXAI": "true",
                },
            }
        }
    )

    assert credentials.synced_providers == ("gemini",)
    assert credentials.gemini == GeminiProvisionCredential(
        env_vars=(
            ProvisionEnvVar(name="GOOGLE_API_KEY", value="google-key"),
            ProvisionEnvVar(name="GOOGLE_GENAI_USE_VERTEXAI", value="true"),
        ),
        auth_files=(),
    )


def test_normalize_provision_credentials_shapes_gemini_oauth_files() -> None:
    credentials = normalize_provision_credentials(
        {
            "gemini": {
                "authMode": "file",
                "files": {
                    ".gemini/oauth_creds.json": '{"refresh_token":"refresh-token"}',
                    ".gemini/settings.json": (
                        '{"security":{"auth":{"selectedType":"oauth-personal"}}}'
                    ),
                    ".gemini/ignored.json": '{"nope":true}',
                },
            }
        }
    )

    assert credentials.synced_providers == ("gemini",)
    assert credentials.gemini is not None
    assert credentials.gemini.env_vars == ()
    assert [file.relative_path for file in credentials.gemini.auth_files] == [
        ".gemini/oauth_creds.json",
        ".gemini/settings.json",
    ]


@pytest.mark.asyncio
async def test_write_credential_files_cleans_managed_files_before_writing() -> None:
    commands: list[str] = []
    writes: list[tuple[str, bytes | str]] = []

    class _Provider:
        async def run_command(self, _sandbox, command: str, **_kwargs):
            commands.append(command)
            return SimpleNamespace(exit_code=0, stdout="", stderr="")

        async def write_file(self, _sandbox, path: str, content: bytes | str) -> None:
            writes.append((path, content))

    await write_credential_files(
        _Provider(),
        object(),
        workspace_id=uuid4(),
        credentials=ProvisionCredentials(
            codex=CodexProvisionCredential(auth_json='{"token":"new"}'),
        ),
        runtime_context=SandboxRuntimeContext(
            home_dir="/home/user",
            runtime_workdir="/home/user/workspace",
            runtime_binary_path="/home/user/anyharness",
            base_env={},
        ),
    )

    assert commands[0].startswith("rm -f ")
    for relative_path in MANAGED_CREDENTIAL_FILE_PATHS:
        assert f"/home/user/{relative_path}" in commands[0]
    assert commands[1] == "mkdir -p /home/user/.codex"
    assert writes == [("/home/user/.codex/auth.json", b'{"token":"new"}')]


@pytest.mark.asyncio
async def test_write_credential_files_raises_when_cleanup_fails() -> None:
    class _Provider:
        async def run_command(self, _sandbox, _command: str, **_kwargs):
            return SimpleNamespace(exit_code=1, stdout="", stderr="permission denied")

        async def write_file(self, _sandbox, _path: str, _content: bytes | str) -> None:
            raise AssertionError("credential files should not be written after cleanup fails")

    with pytest.raises(RuntimeError, match="Cloud credential cleanup failed"):
        await write_credential_files(
            _Provider(),
            object(),
            workspace_id=uuid4(),
            credentials=ProvisionCredentials(
                codex=CodexProvisionCredential(auth_json='{"token":"new"}'),
            ),
            runtime_context=SandboxRuntimeContext(
                home_dir="/home/user",
                runtime_workdir="/home/user/workspace",
                runtime_binary_path="/home/user/anyharness",
                base_env={},
            ),
        )
