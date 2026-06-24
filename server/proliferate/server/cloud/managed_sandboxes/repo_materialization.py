"""Repo materialization for managed sandboxes."""

from __future__ import annotations

import re
import shlex
from pathlib import PurePosixPath

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue, list_cloud_repo_configs
from proliferate.db.store.managed_sandbox_repo_materializations import (
    ManagedSandboxRepoMaterializationValue,
    begin_repo_materialization,
    load_repo_materialization,
    mark_repo_materialization_error,
    mark_repo_materialization_ready,
)
from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.integrations.anyharness import (
    read_remote_workspace_file_state,
    resolve_runtime_workspace,
    start_remote_workspace_setup,
    write_remote_workspace_file,
)
from proliferate.integrations.sandbox import get_configured_sandbox_provider
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.managed_sandboxes.service import load_managed_sandbox_runtime_access
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    run_sandbox_command_logged,
)

_SAFE_PATH_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_path_segment(value: str) -> str:
    normalized = _SAFE_PATH_CHARS.sub("-", value.strip()).strip("-._")
    return normalized or "repo"


def _repo_path(repo_config: CloudRepoConfigValue) -> str:
    owner = _safe_path_segment(repo_config.git_owner)
    repo = _safe_path_segment(repo_config.git_repo_name)
    return str(PurePosixPath("/home/user/workspace/repos") / owner / repo)


def _materialization_versions_match(
    materialization: ManagedSandboxRepoMaterializationValue,
    *,
    sandbox: ManagedSandboxValue,
    repo_config: CloudRepoConfigValue,
    run_setup: bool,
) -> bool:
    setup_matches = (
        materialization.applied_setup_script_version == repo_config.setup_script_version
        if run_setup or not repo_config.setup_script.strip()
        else True
    )
    return (
        materialization.status == "ready"
        and materialization.sandbox_generation == sandbox.runtime_generation
        and materialization.applied_files_version == repo_config.files_version
        and setup_matches
    )


async def reconcile_configured_repos_for_sandbox(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    github_token: str,
    run_setup: bool,
) -> None:
    if sandbox.owner_user_id is None:
        return
    repo_configs = await list_cloud_repo_configs(db, sandbox.owner_user_id)
    configured = [item for item in repo_configs if item.configured]
    for summary in configured:
        from proliferate.db.store.cloud_repo_config import get_cloud_repo_config

        repo_config = await get_cloud_repo_config(
            db,
            user_id=sandbox.owner_user_id,
            git_owner=summary.git_owner,
            git_repo_name=summary.git_repo_name,
        )
        if repo_config is None or not repo_config.configured:
            continue
        try:
            await ensure_repo_materialized(
                db,
                sandbox=sandbox,
                repo_config=repo_config,
                github_token=github_token,
                run_setup=run_setup,
            )
        except Exception as exc:
            log_cloud_event(
                "managed sandbox repo materialization failed during reconcile",
                managed_sandbox_id=sandbox.id,
                cloud_repo_config_id=repo_config.id,
                repo=f"{repo_config.git_owner}/{repo_config.git_repo_name}",
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )


async def ensure_repo_materialized(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    repo_config: CloudRepoConfigValue,
    github_token: str,
    run_setup: bool,
) -> ManagedSandboxRepoMaterializationValue:
    existing = await load_repo_materialization(
        db,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
        lock_row=True,
    )
    if existing is not None and _materialization_versions_match(
        existing,
        sandbox=sandbox,
        repo_config=repo_config,
        run_setup=run_setup,
    ):
        return existing

    materialization = await begin_repo_materialization(
        db,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
        sandbox_generation=sandbox.runtime_generation,
        repo_path=_repo_path(repo_config),
    )
    await db_engine.commit_session(db)
    try:
        runtime_url, access_token, _data_key = await load_managed_sandbox_runtime_access(sandbox)
        provider = get_configured_sandbox_provider()
        if not sandbox.e2b_sandbox_id:
            raise RuntimeError("Managed sandbox is missing an E2B sandbox id.")
        provider_sandbox = await provider.connect_running_sandbox(sandbox.e2b_sandbox_id)
        runtime_context = await provider.resolve_runtime_context(provider_sandbox)
        await _clone_or_update_repo(
            provider,
            provider_sandbox,
            runtime_context=runtime_context,
            repo_config=repo_config,
            repo_path=materialization.repo_path,
            github_token=github_token,
            managed_sandbox_id=sandbox.id,
        )
        resolved = await resolve_runtime_workspace(
            runtime_url,
            access_token,
            runtime_workdir=materialization.repo_path,
        )
        await _apply_tracked_files(
            runtime_url,
            access_token,
            anyharness_workspace_id=resolved.workspace_id,
            repo_config=repo_config,
        )
        if run_setup and repo_config.setup_script.strip():
            await start_remote_workspace_setup(
                runtime_url,
                access_token,
                anyharness_workspace_id=resolved.workspace_id,
                command=repo_config.setup_script,
                base_ref=repo_config.default_branch,
            )
        applied_setup_script_version = (
            repo_config.setup_script_version
            if run_setup or not repo_config.setup_script.strip()
            else materialization.applied_setup_script_version
        )
        applied_env_vars_version = (
            repo_config.env_vars_version
            if not repo_config.env_vars
            else materialization.applied_env_vars_version
        )
        ready = await mark_repo_materialization_ready(
            db,
            materialization.id,
            anyharness_repo_root_id=resolved.repo_root_id,
            anyharness_workspace_id=resolved.workspace_id,
            applied_files_version=repo_config.files_version,
            applied_setup_script_version=applied_setup_script_version,
            applied_env_vars_version=applied_env_vars_version,
        )
        if ready is None:
            raise RuntimeError("Repo materialization row disappeared.")
        await db_engine.commit_session(db)
        return ready
    except Exception as exc:
        await mark_repo_materialization_error(
            db,
            materialization.id,
            last_error=format_exception_message(exc),
        )
        await db_engine.commit_session(db)
        raise


async def _clone_or_update_repo(
    provider: object,
    provider_sandbox: object,
    *,
    runtime_context: object,
    repo_config: CloudRepoConfigValue,
    repo_path: str,
    github_token: str,
    managed_sandbox_id: object,
) -> None:
    branch = (repo_config.default_branch or "").strip()
    repo_url = f"https://github.com/{repo_config.git_owner}/{repo_config.git_repo_name}.git"
    quoted_repo_path = shlex.quote(repo_path)
    quoted_repo_parent = shlex.quote(str(PurePosixPath(repo_path).parent))
    quoted_repo_url = shlex.quote(repo_url)
    quoted_branch = shlex.quote(branch) if branch else ""
    clone_branch_args = f"--branch {quoted_branch} " if branch else ""
    script = "\n".join(
        [
            "set -eu",
            "command -v git >/dev/null 2>&1",
            f"mkdir -p {quoted_repo_parent}",
            'askpass="$(mktemp /tmp/proliferate-git-askpass.XXXXXX)"',
            'cleanup() { rm -f "$askpass"; }',
            "trap cleanup EXIT",
            "cat > \"$askpass\" <<'EOF'",
            "#!/bin/sh",
            'case "$1" in',
            "  *Username*) echo x-access-token ;;",
            "  *Password*) printf '%s\\n' \"$GITHUB_TOKEN\" ;;",
            "  *) echo ;;",
            "esac",
            "EOF",
            'chmod 700 "$askpass"',
            'export GIT_ASKPASS="$askpass"',
            "export GIT_TERMINAL_PROMPT=0",
            f"if [ -d {quoted_repo_path}/.git ]; then",
            f"  git -C {quoted_repo_path} remote set-url origin {quoted_repo_url}",
            f"  git -C {quoted_repo_path} fetch --prune origin",
            f"  if [ -n \"$(git -C {quoted_repo_path} status --porcelain)\" ]; then",
            "    echo 'Repository has local changes; refusing cloud materialization.' >&2",
            "    exit 45",
            "  fi",
            f"elif [ -e {quoted_repo_path} ]; then",
            "  echo 'Repository path exists but is not a git checkout.' >&2",
            "  exit 46",
            "else",
            (f"  git clone {clone_branch_args}{quoted_repo_url} {quoted_repo_path}"),
            "fi",
            f"git -C {quoted_repo_path} remote set-url origin {quoted_repo_url}",
            (f"git -C {quoted_repo_path} checkout --force {quoted_branch}" if branch else "true"),
            (
                f"git -C {quoted_repo_path} reset --hard origin/{quoted_branch}"
                if branch
                else "true"
            ),
        ]
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,  # type: ignore[arg-type]
            provider_sandbox,
            workspace_id=managed_sandbox_id,  # type: ignore[arg-type]
            label="managed_repo_clone_or_update",
            command="bash -lc " + shlex.quote(script),
            runtime_context=runtime_context,  # type: ignore[arg-type]
            envs={"GITHUB_TOKEN": github_token},
            timeout_seconds=300,
            log_output_on_success=True,
        ),
        "Managed sandbox repo clone/update failed",
    )


async def _apply_tracked_files(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    repo_config: CloudRepoConfigValue,
) -> None:
    for tracked_file in repo_config.tracked_files:
        remote_state = await read_remote_workspace_file_state(
            runtime_url,
            access_token,
            anyharness_workspace_id=anyharness_workspace_id,
            relative_path=tracked_file.relative_path,
        )
        await write_remote_workspace_file(
            runtime_url,
            access_token,
            anyharness_workspace_id=anyharness_workspace_id,
            relative_path=tracked_file.relative_path,
            content=tracked_file.content,
            expected_version_token=remote_state.version_token,
        )
