"""Repo materialization for managed sandboxes."""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigValue,
    get_cloud_repo_config,
    list_cloud_repo_configs,
)
from proliferate.db.store.managed_sandbox_repo_materializations import (
    ManagedSandboxRepoMaterializationValue,
    begin_repo_materialization,
    load_repo_materialization,
    mark_repo_materialization_error,
    mark_repo_materialization_ready,
)
from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.integrations.anyharness import (
    resolve_runtime_workspace,
    start_remote_workspace_setup,
)
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.github_app.repo_authority import require_github_cloud_repo_authority
from proliferate.server.cloud.managed_sandboxes.materialization.commands import (
    MaterializationTarget,
    connect_materialization_target,
    run_materialization_script,
)
from proliferate.server.cloud.managed_sandboxes.materialization.github_credentials import (
    ensure_sandbox_git_credentials_ready,
)
from proliferate.server.cloud.managed_sandboxes.materialization.paths import repo_path
from proliferate.server.cloud.managed_sandboxes.materialization.secrets import (
    materialize_workspace_secrets,
    workspace_secret_relative_paths,
)

_WORKSPACE_ENV_RELATIVE_PATH = ".proliferate/env/workspace.env"
_WORKSPACE_ENV_MANIFEST_RELATIVE_PATH = ".proliferate/env/workspace.manifest.json"


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
        and materialization.applied_env_vars_version == repo_config.env_vars_version
        and setup_matches
    )


async def _managed_materialization_paths(
    db: AsyncSession,
    *,
    repo_config: CloudRepoConfigValue,
) -> tuple[str, ...]:
    workspace_secret_paths = await workspace_secret_relative_paths(
        db,
        repo_environment_id=repo_config.id,
    )
    return tuple(
        sorted(
            {
                _WORKSPACE_ENV_RELATIVE_PATH,
                _WORKSPACE_ENV_MANIFEST_RELATIVE_PATH,
                *(item.relative_path for item in repo_config.tracked_files),
                *workspace_secret_paths,
            }
        )
    )


async def reconcile_configured_repos_for_sandbox(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    run_setup: bool,
) -> None:
    if sandbox.owner_user_id is None:
        return
    target = await connect_materialization_target(sandbox)
    await ensure_sandbox_git_credentials_ready(
        db,
        sandbox=sandbox,
        user_id=sandbox.owner_user_id,
        target=target,
    )
    repo_configs = await list_cloud_repo_configs(db, sandbox.owner_user_id)
    configured = [item for item in repo_configs if item.configured]
    for summary in configured:
        repo_config = await get_cloud_repo_config(
            db,
            user_id=sandbox.owner_user_id,
            git_owner=summary.git_owner,
            git_repo_name=summary.git_repo_name,
        )
        if repo_config is None or not repo_config.configured:
            continue
        try:
            await require_github_cloud_repo_authority(
                db,
                user_id=sandbox.owner_user_id,
                git_owner=repo_config.git_owner,
                git_repo_name=repo_config.git_repo_name,
            )
            await ensure_repo_materialized(
                db,
                sandbox=sandbox,
                repo_config=repo_config,
                run_setup=run_setup,
                target=target,
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
    run_setup: bool,
    target: MaterializationTarget | None = None,
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
        repo_environment_id=repo_config.id,
        sandbox_generation=sandbox.runtime_generation,
        repo_path=repo_path(repo_config),
    )
    await db_engine.commit_session(db)
    try:
        from proliferate.server.cloud.managed_sandboxes.service import (
            load_managed_sandbox_runtime_access,
        )

        runtime_url, access_token, _data_key = await load_managed_sandbox_runtime_access(sandbox)
        target = target or await connect_materialization_target(sandbox)
        if sandbox.owner_user_id is not None:
            await ensure_sandbox_git_credentials_ready(
                db,
                sandbox=sandbox,
                user_id=sandbox.owner_user_id,
                target=target,
            )
        await _clone_or_update_repo(
            db,
            target,
            repo_config=repo_config,
            repo_path=materialization.repo_path,
            sandbox=sandbox,
        )
        resolved = await resolve_runtime_workspace(
            runtime_url,
            access_token,
            runtime_workdir=materialization.repo_path,
        )
        await materialize_workspace_secrets(
            db,
            sandbox=sandbox,
            repo_config=repo_config,
            repo_environment_id=repo_config.id,
            repo_path=materialization.repo_path,
            target=target,
            base_env=repo_config.env_vars,
            base_files={
                str(PurePosixPath(materialization.repo_path) / item.relative_path): item.content
                for item in repo_config.tracked_files
            },
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
        ready = await mark_repo_materialization_ready(
            db,
            materialization.id,
            anyharness_repo_root_id=resolved.repo_root_id,
            anyharness_workspace_id=resolved.workspace_id,
            applied_files_version=repo_config.files_version,
            applied_setup_script_version=applied_setup_script_version,
            applied_env_vars_version=repo_config.env_vars_version,
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
    db: AsyncSession,
    target: MaterializationTarget,
    *,
    repo_config: CloudRepoConfigValue,
    repo_path: str,
    sandbox: ManagedSandboxValue,
) -> None:
    branch = (repo_config.default_branch or "").strip()
    repo_url = f"https://github.com/{repo_config.git_owner}/{repo_config.git_repo_name}.git"
    quoted_repo_path = shlex.quote(repo_path)
    quoted_repo_parent = shlex.quote(str(PurePosixPath(repo_path).parent))
    quoted_repo_url = shlex.quote(repo_url)
    quoted_branch = shlex.quote(branch) if branch else ""
    clone_branch_args = f"--branch {quoted_branch} " if branch else ""
    managed_paths = "\n".join(await _managed_materialization_paths(db, repo_config=repo_config))
    script = "\n".join(
        [
            "set -eu",
            "command -v git >/dev/null 2>&1",
            f"mkdir -p {quoted_repo_parent}",
            'managed_paths_file="$(mktemp /tmp/proliferate-managed-paths.XXXXXX)"',
            'unmanaged_status_file="$(mktemp /tmp/proliferate-unmanaged-status.XXXXXX)"',
            'cleanup() { rm -f "$managed_paths_file" "$unmanaged_status_file"; }',
            "trap cleanup EXIT",
            "cat > \"$managed_paths_file\" <<'EOF'",
            managed_paths,
            "EOF",
            "export GIT_TERMINAL_PROMPT=0",
            f"if [ -d {quoted_repo_path}/.git ]; then",
            f"  git -C {quoted_repo_path} remote set-url origin {quoted_repo_url}",
            f"  git -C {quoted_repo_path} fetch --prune origin",
            '  : > "$unmanaged_status_file"',
            (
                f"  while IFS= read -r -d '' entry; do\n"
                '    status_code="${entry:0:2}"\n'
                '    path="${entry:3}"\n'
                '    if [ -z "$path" ] || [ "$status_code" = "R " ] || '
                '[ "$status_code" = "C " ]; then\n'
                '      printf \'%s\\n\' "$entry" >> "$unmanaged_status_file"\n'
                "      continue\n"
                "    fi\n"
                '    if ! grep -Fx -- "$path" "$managed_paths_file" >/dev/null; then\n'
                '      printf \'%s\\n\' "$entry" >> "$unmanaged_status_file"\n'
                "    fi\n"
                f"  done < <(git -C {quoted_repo_path} status "
                "--porcelain=v1 -z --untracked-files=all)"
            ),
            '  if [ -s "$unmanaged_status_file" ]; then',
            (
                "    echo 'Repository has unmanaged local changes; "
                "refusing cloud materialization.' >&2"
            ),
            '    head -n 20 "$unmanaged_status_file" >&2 || true',
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
    await run_materialization_script(
        target,
        sandbox_id=sandbox.id,
        label="managed_repo_clone_or_update",
        script=script,
        timeout_seconds=300,
    )
