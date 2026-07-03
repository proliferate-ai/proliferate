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
class RuntimeMobilityState:
    """A workspace's mobility runtime mode (normal/frozen_for_handoff/remote_owned/...)."""

    workspace_id: str
    mode: str
    handoff_op_id: str | None


@dataclass(frozen=True)
class RuntimeMobilityPreflight:
    """Result of asking a runtime whether a workspace is safe to move right now."""

    workspace_id: str
    can_move: bool
    base_commit_sha: str | None
    branch_name: str | None
    blocker_codes: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeMobilityInstallResult:
    """Result of installing a mobility archive into a destination workspace."""

    workspace_id: str
    source_workspace_path: str
    base_commit_sha: str
    imported_session_ids: tuple[str, ...]
    applied_file_count: int
    deleted_file_count: int
    imported_agent_artifact_count: int
