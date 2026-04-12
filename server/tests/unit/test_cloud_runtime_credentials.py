from proliferate.server.cloud.runtime.credentials import (
    ClaudeProvisionCredential,
    CodexProvisionCredential,
    GeminiProvisionCredential,
    ProvisionEnvVar,
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
