from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[5]
SERVER_ROOT = REPO_ROOT / "server"
DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_E2B_WEBHOOK_URL = "https://workers.ngrok.dev/v1/cloud/webhooks/e2b"
DEFAULT_GITHUB_OWNER = "proliferate-ai"
DEFAULT_GITHUB_REPO = "proliferate"
DEFAULT_GITHUB_BASE_BRANCH = "main"
DEFAULT_CLOUD_TEST_TIMEOUT_SECONDS = 900.0
DEFAULT_RUNTIME_SMOKE_TIMEOUT_SECONDS = 180.0
NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels"
NGROK_API_PORT_START = 4040
NGROK_API_PORT_END = 4050


class CloudE2ETestError(RuntimeError):
    pass


@dataclass(frozen=True)
class CloudTestConfig:
    run_cloud_e2e: bool
    run_live_e2b_webhook: bool
    server_base_url: str
    e2b_webhook_public_url: str
    github_owner: str
    github_repo: str
    github_base_branch: str
    github_token: str | None
    anthropic_api_key: str | None
    gemini_api_key: str | None
    google_api_key: str | None
    e2b_api_key: str | None
    e2b_template_name: str | None
    e2b_webhook_signature_secret: str | None
    daytona_api_key: str | None
    daytona_server_url: str
    daytona_target: str
    claude_auth_path: Path | None
    codex_auth_path: Path | None
    gemini_auth_path: Path | None


@dataclass
class AuthSession:
    user_id: str
    access_token: str
    refresh_token: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}


@dataclass(frozen=True)
class WorkspaceHandle:
    auth: AuthSession
    workspace: dict[str, Any]
    connection: dict[str, Any]
    synced_providers: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeSmokeResult:
    session_id: str
    events: list[dict[str, Any]]


@dataclass(frozen=True)
class ProcessHandle:
    process: Any | None
    base_url: str
    reused_existing: bool


def unique_branch_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def require_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise CloudE2ETestError(f"Expected non-empty string field {key!r} in payload.")
    return value
