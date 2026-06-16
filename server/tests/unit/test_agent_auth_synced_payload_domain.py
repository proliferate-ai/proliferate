from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, UTC

import pytest

from proliferate.server.cloud.agent_auth.domain.status import (
    allowed_agent_kinds,
    build_credential_statuses,
    ready_agent_kinds,
)
from proliferate.server.cloud.agent_auth.domain.synced_payload import (
    normalize_synced_credential_payload,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError


@dataclass(frozen=True)
class _CredentialRow:
    provider: str
    auth_mode: object
    revoked_at: object | None = None
    last_synced_at: object | None = None


@dataclass(frozen=True)
class _FileInput:
    relative_path: str
    content_base64: str


def test_build_credential_statuses_applies_defaults_and_filters_revoked() -> None:
    now = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    statuses = build_credential_statuses(
        [
            _CredentialRow("claude", "file", last_synced_at=now),
            _CredentialRow("codex", "file", revoked_at=now, last_synced_at=now),
            _CredentialRow("unsupported", "env", last_synced_at=now),
        ]
    )

    by_provider = {status.provider: status for status in statuses}

    assert allowed_agent_kinds() == ["claude", "codex", "opencode", "gemini", "grok"]
    assert ready_agent_kinds(statuses) == ["claude"]
    assert by_provider["claude"].synced is True
    assert by_provider["claude"].auth_mode == "file"
    assert by_provider["claude"].last_synced_at == now.isoformat()
    assert by_provider["codex"].synced is False
    assert by_provider["codex"].auth_mode == "file"
    assert by_provider["gemini"].synced is False
    assert by_provider["gemini"].auth_mode == "env"


def test_normalize_claude_env_payload_rejects_api_key_sync() -> None:
    with pytest.raises(AgentAuthError) as exc_info:
        normalize_synced_credential_payload(
            agent_kind="claude",
            auth_mode="env",
            env_vars={"ANTHROPIC_API_KEY": "sk-ant-test"},
            files=None,
        )

    assert exc_info.value.code == "invalid_payload"
    assert exc_info.value.message == "Env credential sync is not supported for agent 'claude'."


def test_normalize_gemini_env_rejects_incompatible_api_keys() -> None:
    with pytest.raises(AgentAuthError) as exc_info:
        normalize_synced_credential_payload(
            agent_kind="gemini",
            auth_mode="env",
            env_vars={
                "GEMINI_API_KEY": "gemini-key",
                "GOOGLE_API_KEY": "google-key",
            },
            files=None,
        )

    assert exc_info.value.code == "invalid_payload"
    assert exc_info.value.message == (
        "Gemini sync must use either GEMINI_API_KEY or GOOGLE_API_KEY, not both."
    )


def test_normalize_claude_file_payload_decodes_portable_auth_file() -> None:
    encoded = base64.b64encode(
        json.dumps(
            {
                "claudeAiOauth": {
                    "accessToken": "access-token",
                }
            }
        ).encode("utf-8")
    ).decode("ascii")

    normalized = normalize_synced_credential_payload(
        agent_kind="claude",
        auth_mode="file",
        env_vars=None,
        files=[
            _FileInput(
                relative_path=".claude/.credentials.json",
                content_base64=encoded,
            )
        ],
    )

    assert normalized.auth_mode == "file"
    assert normalized.payload == {
        "provider": "claude",
        "authMode": "file",
        "files": {
            ".claude/.credentials.json": json.dumps(
                {
                    "claudeAiOauth": {
                        "accessToken": "access-token",
                    }
                }
            ),
        },
    }


def test_normalize_file_payload_rejects_unapproved_path() -> None:
    encoded = base64.b64encode(b'{"some":"data"}').decode("ascii")

    with pytest.raises(AgentAuthError) as exc_info:
        normalize_synced_credential_payload(
            agent_kind="claude",
            auth_mode="file",
            env_vars=None,
            files=[
                _FileInput(
                    relative_path=".claude/random.json",
                    content_base64=encoded,
                )
            ],
        )

    assert exc_info.value.code == "invalid_payload"
    assert exc_info.value.message == (
        "File path '.claude/random.json' is not an approved Claude auth file."
    )
