from proliferate.server.cloud.runtime.credentials import (
    ClaudeProvisionCredential,
    CodexProvisionCredential,
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
