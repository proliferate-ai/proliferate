"""Cloud repo environment materialization."""

from __future__ import annotations

import shlex
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_repo_environment_materializations as repo_mat_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.github_app.repo_authority import require_github_cloud_repo_authority
from proliferate.server.cloud.materialization import manifests, operation, paths, sandbox_io
from proliferate.server.cloud.materialization.materialize import github_credentials, secret_set
from proliferate.utils.time import utcnow


async def materialize_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> None:
    repo_environment = await repositories_store.get_repo_environment_by_id(
        db,
        repo_environment_id,
    )
    if repo_environment is None or repo_environment.environment_kind != "cloud":
        return
    sandbox = await cloud_sandboxes_service.ensure_personal_cloud_sandbox_exists(
        db,
        user_id=repo_environment.user_id,
    )
    materialization = await repo_mat_store.begin_repo_environment_materialization(
        db,
        cloud_sandbox_id=sandbox.id,
        repo_environment_id=repo_environment.id,
    )
    attempt_updated_at = materialization.updated_at
    await db.commit()
    try:
        await operation.run_cloud_sandbox_operation(
            db,
            sandbox=sandbox,
            operation_key=f"repo-environment:{repo_environment_id}",
            run=lambda ctx: materialize_repo_environment_in_context(
                db,
                ctx=ctx,
                repo_environment_id=repo_environment_id,
                materialization_id=materialization.id,
                attempt_updated_at=attempt_updated_at,
            ),
        )
    except Exception as exc:
        await repo_mat_store.mark_repo_environment_materialization_error(
            db,
            materialization.id,
            last_error=str(exc)[:2000],
            expected_updated_at=attempt_updated_at,
        )
        await db.commit()
        raise


async def materialize_repo_environment_in_context(
    db: AsyncSession,
    *,
    ctx: operation.MaterializationContext,
    repo_environment_id: UUID,
    materialization_id: UUID,
    attempt_updated_at: datetime,
) -> None:
    repo_environment = await repositories_store.get_repo_environment_by_id(
        db,
        repo_environment_id,
    )
    if repo_environment is None or repo_environment.environment_kind != "cloud":
        return
    try:
        await require_github_cloud_repo_authority(
            db,
            user_id=repo_environment.user_id,
            git_owner=repo_environment.git_owner,
            git_repo_name=repo_environment.git_repo_name,
        )
        credential_result = await github_credentials.materialize_github_credentials(
            db,
            target=ctx.target,
            operation_id=materialization_id,
            user_id=repo_environment.user_id,
        )
        repo_path = paths.repo_path(repo_environment)
        default_branch = await _materialize_git_checkout(
            ctx.target,
            operation_id=materialization_id,
            repo_environment=repo_environment,
            repo_path=repo_path,
        )
        await secret_set.materialize_workspace_secrets_for_repo_environment(
            db,
            ctx=ctx,
            repo_environment=repo_environment,
        )
        manifest = manifests.repo_manifest(
            repo_path=repo_path,
            git_owner=repo_environment.git_owner,
            git_repo_name=repo_environment.git_repo_name,
            default_branch=default_branch,
            materialized_at=utcnow(),
        )
        manifest["githubCredential"] = {
            "actorLogin": credential_result.actor_login,
            "actorId": credential_result.actor_id,
            "expiresAt": credential_result.expires_at_iso,
            "refreshAfter": credential_result.refresh_after_iso,
        }
        await repo_mat_store.mark_repo_environment_materialization_ready(
            db,
            materialization_id,
            applied_repo_environment_updated_at=repo_environment.updated_at,
            applied_manifest=manifest,
            expected_updated_at=attempt_updated_at,
        )
        await db.commit()
    except Exception as exc:
        await repo_mat_store.mark_repo_environment_materialization_error(
            db,
            materialization_id,
            last_error=str(exc)[:2000],
            expected_updated_at=attempt_updated_at,
        )
        await db.commit()
        raise


async def _materialize_git_checkout(
    target: sandbox_io.SandboxIOTarget,
    *,
    operation_id: UUID,
    repo_environment: RepoEnvironmentValue,
    repo_path: str,
) -> str:
    requested_branch = repo_environment.default_branch or ""
    script = "\n".join(
        [
            "set -eu",
            f"owner={shlex.quote(repo_environment.git_owner)}",
            f"repo={shlex.quote(repo_environment.git_repo_name)}",
            f"repo_path={shlex.quote(repo_path)}",
            f"default_branch={shlex.quote(requested_branch)}",
            'remote_url="https://github.com/${owner}/${repo}.git"',
            'mkdir -p "$(dirname "$repo_path")"',
            'if [ -e "$repo_path" ] && [ ! -d "$repo_path/.git" ]; then',
            '  echo "Repo path exists but is not a git repository: $repo_path" >&2',
            "  exit 42",
            "fi",
            "fresh_clone=0",
            'if [ -z "$default_branch" ]; then',
            '  default_branch="$(git ls-remote --symref "$remote_url" HEAD '
            "| awk '/^ref:/ { sub(\"refs/heads/\", \"\", $2); print $2; exit }')\"",
            "fi",
            'if [ -z "$default_branch" ]; then default_branch="main"; fi',
            'if [ ! -d "$repo_path/.git" ]; then',
            '  git clone "$remote_url" "$repo_path"',
            "  fresh_clone=1",
            "fi",
            'git -C "$repo_path" fetch --prune origin',
            'if [ "$fresh_clone" != "1" ]; then',
            '  if [ -n "$(git -C "$repo_path" status --porcelain)" ]; then',
            '    echo "Refusing to reset dirty cloud repo checkout: $repo_path" >&2',
            "    exit 43",
            "  fi",
            (
                '  if git -C "$repo_path" rev-parse --verify --quiet "$default_branch" '
                ">/dev/null; then"
            ),
            '    read -r _behind ahead <<EOF',
            (
                '$(git -C "$repo_path" rev-list --left-right --count '
                '"origin/$default_branch...$default_branch")'
            ),
            "EOF",
            '    if [ "${ahead:-0}" != "0" ]; then',
            (
                '      echo "Refusing to reset cloud repo checkout with local commits: '
                '$repo_path" >&2'
            ),
            "      exit 44",
            "    fi",
            '    git -C "$repo_path" checkout "$default_branch"',
            "  else",
            (
                '    git -C "$repo_path" checkout --track -b "$default_branch" '
                '"origin/$default_branch"'
            ),
            "  fi",
            "else",
            '  git -C "$repo_path" checkout --force "$default_branch"',
            "fi",
            'git -C "$repo_path" reset --hard "origin/$default_branch"',
            'printf "%s" "$default_branch"',
        ]
    )
    return (
        await sandbox_io.run_materialization_script(
            target,
            operation_id=operation_id,
            label="materialization_repo_checkout",
            script=script,
            timeout_seconds=600,
            log_output_on_success=True,
        )
    ).strip()
