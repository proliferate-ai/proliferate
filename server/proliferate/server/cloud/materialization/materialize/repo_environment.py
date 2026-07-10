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
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)
from proliferate.utils.time import utcnow

# Exit codes emitted by the git-checkout script below. Kept in sync with the
# literal `exit N` statements in `_materialize_git_checkout`. These map to
# structured, actionable checkout conflicts so callers can return a specific 409
# instead of an opaque 500 when a shared repo checkout cannot be safely reset.
_CHECKOUT_EXIT_NOT_A_GIT_REPO = 42
_CHECKOUT_EXIT_DIRTY = 43
_CHECKOUT_EXIT_LOCAL_COMMITS = 44

_CHECKOUT_EXIT_REASONS: dict[int, str] = {
    _CHECKOUT_EXIT_NOT_A_GIT_REPO: "not_a_git_repo",
    _CHECKOUT_EXIT_DIRTY: "dirty_checkout",
    _CHECKOUT_EXIT_LOCAL_COMMITS: "local_commits",
}


class CloudRepoCheckoutError(RuntimeError):
    """The shared cloud repo checkout could not be safely reset.

    ``reason`` is one of ``not_a_git_repo``, ``dirty_checkout``, or
    ``local_commits`` and is safe to surface to product callers. These are
    genuine conflicts (a prior checkout holds user work or is not a clean git
    repository), distinct from transient runtime failures.
    """

    def __init__(self, reason: str, *, repo_path: str) -> None:
        super().__init__(f"cloud repo checkout {reason}: {repo_path}")
        self.reason = reason
        self.repo_path = repo_path


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


# Directory Proliferate materializes generated files into (workspace secret env
# + manifests) inside the checkout. Registered as locally ignored so retries do
# not treat generated files as a dirty checkout.
PROLIFERATE_CHECKOUT_IGNORE_ENTRY = "/.proliferate/"


def _build_repo_checkout_script(
    *,
    git_owner: str,
    git_repo_name: str,
    repo_path: str,
    requested_branch: str,
) -> str:
    """Build the sandbox git-checkout script.

    Extracted as a pure builder so the generated-file exclusion and dirty-check
    guard can be verified without a live sandbox.
    """
    return "\n".join(
        [
            "set -eu",
            f"owner={shlex.quote(git_owner)}",
            f"repo={shlex.quote(git_repo_name)}",
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
            '| awk \'/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }\')"',
            "fi",
            'if [ -z "$default_branch" ]; then default_branch="main"; fi',
            'if [ ! -d "$repo_path/.git" ]; then',
            '  git clone "$remote_url" "$repo_path"',
            "  fresh_clone=1",
            "fi",
            # Register .proliferate/ as locally ignored so a retry after a
            # transient failure does not mistake Proliferate-generated files for
            # user work and refuse to reset a "dirty" checkout. Genuine user
            # changes (tracked edits, other untracked files) still trip the
            # guard below.
            'if [ -d "$repo_path/.git" ]; then',
            '  mkdir -p "$repo_path/.git/info"',
            '  exclude_file="$repo_path/.git/info/exclude"',
            f"  if ! grep -qxF '{PROLIFERATE_CHECKOUT_IGNORE_ENTRY}' "
            '"$exclude_file" 2>/dev/null; then',
            f"    printf '%s\\n' '{PROLIFERATE_CHECKOUT_IGNORE_ENTRY}' >> \"$exclude_file\"",
            "  fi",
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
            "    read -r _behind ahead <<EOF",
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


async def _materialize_git_checkout(
    target: sandbox_io.SandboxIOTarget,
    *,
    operation_id: UUID,
    repo_environment: RepoEnvironmentValue,
    repo_path: str,
) -> str:
    script = _build_repo_checkout_script(
        git_owner=repo_environment.git_owner,
        git_repo_name=repo_environment.git_repo_name,
        repo_path=repo_path,
        requested_branch=repo_environment.default_branch or "",
    )
    try:
        output = await sandbox_io.run_materialization_script(
            target,
            operation_id=operation_id,
            label="materialization_repo_checkout",
            script=script,
            timeout_seconds=600,
            log_output_on_success=True,
        )
    except CloudMaterializationCommandError as exc:
        reason = _CHECKOUT_EXIT_REASONS.get(exc.exit_code) if exc.exit_code else None
        if reason is not None:
            raise CloudRepoCheckoutError(reason, repo_path=repo_path) from exc
        raise
    return output.strip()
