"""Sandbox paths used by managed sandbox materialization."""

from __future__ import annotations

import re
from pathlib import PurePosixPath

from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue
from proliferate.integrations.sandbox import SandboxRuntimeContext

_SAFE_PATH_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def safe_path_segment(value: str) -> str:
    normalized = _SAFE_PATH_CHARS.sub("-", value.strip()).strip("-._")
    return normalized or "repo"


def repo_path(repo_config: CloudRepoConfigValue) -> str:
    owner = safe_path_segment(repo_config.git_owner)
    repo = safe_path_segment(repo_config.git_repo_name)
    return str(PurePosixPath("/home/user/workspace/repos") / owner / repo)


def anyharness_runtime_home(runtime_context: SandboxRuntimeContext) -> str:
    return str(PurePosixPath(runtime_context.home_dir) / ".proliferate" / "anyharness")


def global_secret_env_path(runtime_context: SandboxRuntimeContext) -> str:
    return str(PurePosixPath(anyharness_runtime_home(runtime_context)) / "secrets" / "global.env")


def global_secret_manifest_path(runtime_context: SandboxRuntimeContext) -> str:
    return str(
        PurePosixPath(anyharness_runtime_home(runtime_context))
        / "secrets"
        / "global.manifest.json"
    )


def workspace_secret_env_path(repo_path_value: str) -> str:
    return str(PurePosixPath(repo_path_value) / ".proliferate" / "env" / "workspace.env")


def workspace_secret_manifest_path(repo_path_value: str) -> str:
    return str(
        PurePosixPath(repo_path_value) / ".proliferate" / "env" / "workspace.manifest.json"
    )


def repo_relative_path(repo_path_value: str, relative_path: str) -> str:
    return str(PurePosixPath(repo_path_value) / PurePosixPath(relative_path))
