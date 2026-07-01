"""GitHub App user-token materialization into a cloud sandbox."""

from __future__ import annotations

import json
import secrets
import shlex
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.github_app.repo_authority import (
    ensure_fresh_github_app_authorization,
)
from proliferate.server.cloud.materialization import paths, sandbox_io
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class GitHubCredentialMaterializationResult:
    actor_login: str
    actor_id: str
    expires_at_iso: str
    refresh_after_iso: str


async def materialize_github_credentials(
    db: AsyncSession,
    *,
    target: sandbox_io.SandboxIOTarget,
    operation_id: UUID,
    user_id: UUID,
) -> GitHubCredentialMaterializationResult:
    authorization = await ensure_fresh_github_app_authorization(db, user_id=user_id)
    if authorization.access_token is None:
        raise sandbox_io.CloudMaterializationCommandError(
            "GitHub App authorization did not produce an access token."
        )

    issued_at = utcnow()
    expires_at = authorization.token_expires_at or issued_at + timedelta(hours=8)
    refresh_after = expires_at - timedelta(minutes=30)
    lease_id = secrets.token_urlsafe(18)

    await sandbox_io.write_private_file_atomic(
        target,
        operation_id=operation_id,
        path=paths.github_token_path(),
        content=authorization.access_token + "\n",
        mode="600",
    )
    await sandbox_io.write_private_file_atomic(
        target,
        operation_id=operation_id,
        path=paths.github_meta_path(),
        content=json.dumps(
            {
                "provider": "github",
                "tokenKind": "github_app_user_to_server",
                "actorLogin": authorization.github_login,
                "actorId": authorization.github_user_id,
                "leaseId": lease_id,
                "issuedAt": issued_at.isoformat(),
                "expiresAt": expires_at.isoformat(),
                "refreshAfter": refresh_after.isoformat(),
            },
            sort_keys=True,
            indent=2,
        )
        + "\n",
        mode="600",
    )
    await _ensure_git_credential_helper_configured(target, operation_id=operation_id)
    return GitHubCredentialMaterializationResult(
        actor_login=authorization.github_login,
        actor_id=authorization.github_user_id,
        expires_at_iso=expires_at.isoformat(),
        refresh_after_iso=refresh_after.isoformat(),
    )


async def _ensure_git_credential_helper_configured(
    target: sandbox_io.SandboxIOTarget,
    *,
    operation_id: UUID,
) -> None:
    helper = paths.github_credential_helper_path()
    token_path = paths.github_token_path()
    meta_path = paths.github_meta_path()
    script = "\n".join(
        [
            "set -eu",
            f"helper={shlex.quote(helper)}",
            f"token_path={shlex.quote(token_path)}",
            f"meta_path={shlex.quote(meta_path)}",
            'test -x "$helper"',
            'test -s "$token_path"',
            'test -s "$meta_path"',
            (
                'credential_output="$(printf "protocol=https\\nhost=github.com\\n\\n" '
                '| "$helper" get)"'
            ),
            'printf "%s\\n" "$credential_output" | grep -qx "username=x-access-token"',
            'printf "%s\\n" "$credential_output" | grep -Eq "^password=.+$"',
            'git config --global --replace-all credential.https://github.com.helper "!$helper"',
            (
                "git config --global --get-all url.https://github.com/.insteadOf "
                "| grep -Fx 'git@github.com:' >/dev/null "
                "|| git config --global --add url.https://github.com/.insteadOf 'git@github.com:'"
            ),
            (
                "git config --global --get-all url.https://github.com/.insteadOf "
                "| grep -Fx 'ssh://git@github.com/' >/dev/null "
                "|| git config --global --add url.https://github.com/.insteadOf "
                "'ssh://git@github.com/'"
            ),
        ]
    )
    await sandbox_io.run_materialization_script(
        target,
        operation_id=operation_id,
        label="materialization_configure_github_credentials",
        script=script,
        timeout_seconds=30,
        log_output_on_success=True,
    )
