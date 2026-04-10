"""Shared hardcoded constants for the cloud workspace domain.

These values are referenced by multiple cloud subpackages (credentials,
repos, runtime, workspaces) and are therefore centralized here instead of
being scattered across individual feature modules.

File-private constants that are only consumed within a single module
should remain in that module.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

# ---------------------------------------------------------------------------
# Supported cloud agent kinds
# ---------------------------------------------------------------------------

CloudAgentKind = Literal["claude", "codex", "gemini"]

SUPPORTED_CLOUD_AGENTS: tuple[CloudAgentKind, ...] = ("claude", "codex", "gemini")

ANYHARNESS_RESERVED_ENV_PREFIX: str = "ANYHARNESS_"
PROLIFERATE_RESERVED_ENV_PREFIX: str = "PROLIFERATE_"

# Mirror the agent credential env vars AnyHarness currently recognizes so repo
# env-var sync cannot override runtime-managed auth inputs.
RESERVED_CLOUD_REPO_ENV_VARS: frozenset[str] = frozenset(
    {
        "AMP_API_KEY",
        "ANTHROPIC_API_KEY",
        "CODEX_API_KEY",
        "CURSOR_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENAI_USE_VERTEXAI",
        "OPENAI_API_KEY",
    }
)

# ---------------------------------------------------------------------------
# Allowed credential auth files
# ---------------------------------------------------------------------------

CLAUDE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".claude/.credentials.json",
        ".claude.json",
    }
)

CODEX_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".codex/auth.json",
    }
)

GEMINI_ALLOWED_AUTH_FILES: frozenset[str] = frozenset(
    {
        ".gemini/oauth_creds.json",
        ".gemini/settings.json",
    }
)

# ---------------------------------------------------------------------------
# Cloud workspace lifecycle status
# ---------------------------------------------------------------------------


class WorkspaceStatus(StrEnum):
    queued = "queued"
    provisioning = "provisioning"
    syncing_credentials = "syncing_credentials"
    cloning_repo = "cloning_repo"
    starting_runtime = "starting_runtime"
    ready = "ready"
    stopped = "stopped"
    error = "error"


class WorkspacePostReadyPhase(StrEnum):
    idle = "idle"
    applying_files = "applying_files"
    starting_setup = "starting_setup"
    completed = "completed"
    failed = "failed"


WORKSPACE_REPO_APPLY_LOCK_SALT: int = 4_203_902


# ---------------------------------------------------------------------------
# Git provider
# ---------------------------------------------------------------------------

SUPPORTED_GIT_PROVIDER: str = "github"
