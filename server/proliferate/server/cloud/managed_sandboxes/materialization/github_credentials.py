"""Git credential readiness for managed sandbox materialization."""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.server.cloud.managed_sandboxes.materialization.commands import (
    MaterializationTarget,
    connect_materialization_target,
    run_materialization_script,
)


def _github_git_root(home_dir: str) -> str:
    return str(PurePosixPath(home_dir) / ".proliferate" / "git" / "github.com")


def _token_path(home_dir: str) -> str:
    return str(PurePosixPath(_github_git_root(home_dir)) / "token")


def _meta_path(home_dir: str) -> str:
    return str(PurePosixPath(_github_git_root(home_dir)) / "meta.json")


def _helper_path(home_dir: str) -> str:
    return str(
        PurePosixPath(home_dir)
        / ".proliferate"
        / "bin"
        / "proliferate-git-credential-helper"
    )


async def ensure_sandbox_git_credentials_ready(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    user_id: UUID,
    target: MaterializationTarget | None = None,
) -> MaterializationTarget:
    del db, user_id
    target = target or await connect_materialization_target(sandbox)
    helper_path = _helper_path(target.runtime_context.home_dir)
    token_path = _token_path(target.runtime_context.home_dir)
    meta_path = _meta_path(target.runtime_context.home_dir)
    await run_materialization_script(
        target,
        sandbox_id=sandbox.id,
        label="managed_sandbox_git_credentials_ready",
        script="\n".join(
            [
                "set -eu",
                "command -v git >/dev/null 2>&1",
                f"helper={shlex.quote(helper_path)}",
                f"token_file={shlex.quote(token_path)}",
                f"meta_file={shlex.quote(meta_path)}",
                'test -x "$helper"',
                "credential_ready=0",
                "for credential_attempt in $(seq 1 15); do",
                "  if test -s \"$token_file\" && test -s \"$meta_file\" && "
                "node - \"$meta_file\" <<'NODE'",
                "const fs = require('fs');",
                "const path = process.argv[process.argv.length - 1];",
                "const meta = JSON.parse(fs.readFileSync(path, 'utf8'));",
                "const refreshAfter = Date.parse(meta.refreshAfter);",
                "const expiresAt = Date.parse(meta.expiresAt);",
                "const now = Date.now();",
                "if (meta.provider !== 'github') process.exit(1);",
                "if (meta.tokenKind !== 'github_app_user_to_server') process.exit(1);",
                (
                    "if (!Number.isFinite(refreshAfter) || "
                    "!Number.isFinite(expiresAt)) process.exit(1);"
                ),
                "if (now >= refreshAfter || now + 10 * 60 * 1000 >= expiresAt) process.exit(1);",
                "NODE",
                "  then",
                "    credential_ready=1",
                "    break",
                "  fi",
                '  [ "$credential_attempt" = "15" ] || sleep 1',
                "done",
                'if [ "$credential_ready" != "1" ]; then',
                "  echo 'GitHub credentials are not ready in the managed sandbox.' >&2",
                "  exit 44",
                "fi",
                "git config --global credential.useHttpPath true",
                "git config --global --unset-all credential.helper || true",
                (
                    "git config --global --replace-all "
                    'credential.https://github.com.helper "!$helper"'
                ),
                (
                    "git config --global --get-all url.https://github.com/.insteadOf "
                    "| grep -Fx 'git@github.com:' >/dev/null "
                    "|| git config --global --add "
                    "url.https://github.com/.insteadOf git@github.com:"
                ),
                (
                    "git config --global --get-all url.https://github.com/.insteadOf "
                    "| grep -Fx 'ssh://git@github.com/' >/dev/null "
                    "|| git config --global --add url.https://github.com/.insteadOf "
                    "ssh://git@github.com/"
                ),
            ]
        ),
        timeout_seconds=30,
        log_output_on_success=False,
    )
    return target
