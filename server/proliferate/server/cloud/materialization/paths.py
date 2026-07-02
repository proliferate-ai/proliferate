"""Deterministic sandbox paths for cloud materialization."""

from __future__ import annotations

from pathlib import PurePosixPath

from proliferate.db.store.repositories import RepoEnvironmentValue

SANDBOX_HOME = "/home/user"
SANDBOX_WORKSPACE_ROOT = f"{SANDBOX_HOME}/workspace"
SANDBOX_REPOS_ROOT = f"{SANDBOX_WORKSPACE_ROOT}/repos"
PROLIFERATE_HOME = f"{SANDBOX_HOME}/.proliferate"
# AnyHarness runtime home inside cloud sandboxes: default_runtime_home() in
# anyharness-lib resolves $HOME/.proliferate/anyharness for release builds.
ANYHARNESS_HOME = f"{PROLIFERATE_HOME}/anyharness"


def github_root_path() -> str:
    return f"{PROLIFERATE_HOME}/git/github.com"


def github_token_path() -> str:
    return f"{github_root_path()}/token"


def github_meta_path() -> str:
    return f"{github_root_path()}/meta.json"


def github_credential_helper_path() -> str:
    return f"{PROLIFERATE_HOME}/bin/proliferate-git-credential-helper"


def agent_auth_state_path() -> str:
    """Contract file read by AnyHarness (agent-auth-litellm spec §5)."""
    return f"{ANYHARNESS_HOME}/agent-auth/state.json"


def agent_auth_manifest_path() -> str:
    """Server-owned change-tracking manifest; not part of the AnyHarness contract."""
    return f"{PROLIFERATE_HOME}/agent-auth/state.manifest.json"


def global_env_path() -> str:
    return f"{PROLIFERATE_HOME}/secrets/global.env"


def global_secret_manifest_path() -> str:
    return f"{PROLIFERATE_HOME}/secrets/global.manifest.json"


def repo_path(repo_environment: RepoEnvironmentValue) -> str:
    return f"{SANDBOX_REPOS_ROOT}/{repo_environment.git_owner}/{repo_environment.git_repo_name}"


def workspace_env_path(repo_environment: RepoEnvironmentValue) -> str:
    return f"{repo_path(repo_environment)}/.proliferate/env/workspace.env"


def workspace_secret_manifest_path(repo_environment: RepoEnvironmentValue) -> str:
    return f"{repo_path(repo_environment)}/.proliferate/env/workspace.manifest.json"


def repo_relative_secret_path(
    repo_environment: RepoEnvironmentValue,
    relative_path: str,
) -> str:
    return str(PurePosixPath(repo_path(repo_environment)).joinpath(relative_path))
