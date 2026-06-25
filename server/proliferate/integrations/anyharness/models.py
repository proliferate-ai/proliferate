"""Typed payloads returned by the AnyHarness runtime integration."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeHealthProbe:
    is_success: bool
    status_code: int
    response_preview: str | None


@dataclass(frozen=True)
class RuntimeAuthProbe:
    authenticated_success: bool
    authenticated_status_code: int
    authenticated_response_preview: str | None
    unauthenticated_status_code: int | None
    unauthenticated_response_preview: str | None


@dataclass(frozen=True)
class RemoteAgentSummary:
    kind: str
    readiness: str | None
    credential_state: str | None


@dataclass(frozen=True)
class RemoteAgentInstallResult:
    agent: RemoteAgentSummary
    already_installed: bool | None


@dataclass(frozen=True)
class RemoteAgentAuthConfigApplyResult:
    applied: bool
    revision: int
    status: str
    selection_count: int


@dataclass(frozen=True)
class ResolvedRemoteWorkspace:
    workspace_id: str
    repo_root_id: str


@dataclass(frozen=True)
class RemoteSession:
    session_id: str


@dataclass(frozen=True)
class RemoteWorkspaceFileState:
    exists: bool
    version_token: str


@dataclass(frozen=True)
class RemoteWorkspaceSetupStart:
    terminal_id: str | None
    command_run_id: str | None
    status: str


@dataclass(frozen=True)
class RemoteTerminalCommandRun:
    id: str
    status: str
    exit_code: int | None
    stdout: str | None
    stderr: str | None
    combined_output: str | None
    output_truncated: bool


@dataclass(frozen=True)
class RemoteWorkspaceSummary:
    workspace_id: str | None
    live_session_count: int
