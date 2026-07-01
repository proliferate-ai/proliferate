"""Manifest helpers for materialized cloud sandbox state."""

from __future__ import annotations

import json
import shlex
from collections.abc import Mapping
from datetime import datetime


def render_env_file(env: Mapping[str, str]) -> str:
    if not env:
        return ""
    return "".join(
        f"export {key}={shlex.quote(value)}\n"
        for key, value in sorted(env.items())
    )


def render_manifest(manifest: Mapping[str, object]) -> str:
    return json.dumps(dict(manifest), sort_keys=True, indent=2) + "\n"


def secret_manifest(
    *,
    env_sha256: dict[str, str],
    files_sha256: dict[str, str],
    versions: dict[str, int],
) -> dict[str, object]:
    return {
        "env": env_sha256,
        "files": files_sha256,
        "versions": versions,
    }


def repo_manifest(
    *,
    repo_path: str,
    git_owner: str,
    git_repo_name: str,
    default_branch: str,
    materialized_at: datetime,
) -> dict[str, object]:
    return {
        "repoPath": repo_path,
        "gitOwner": git_owner,
        "gitRepoName": git_repo_name,
        "defaultBranch": default_branch,
        "materializedAt": materialized_at.isoformat(),
    }


def owned_secret_file_paths(manifest: Mapping[str, object]) -> set[str]:
    raw = manifest.get("files")
    if not isinstance(raw, dict):
        return set()
    return {str(path) for path in raw}
