"""Typed payloads returned by the AnyHarness runtime integration."""

from __future__ import annotations

from dataclasses import dataclass


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
