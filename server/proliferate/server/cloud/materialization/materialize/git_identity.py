"""Git identity materialization for cloud sandboxes."""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import users as users_store
from proliferate.server.cloud.materialization import sandbox_io


@dataclass(frozen=True)
class GitIdentity:
    name: str
    email: str


class GitIdentityUnresolvedError(RuntimeError):
    """The user has no email address suitable for commit attribution."""

    def __init__(self) -> None:
        super().__init__("Git identity cannot be resolved without an account email.")


async def resolve_git_identity(db: AsyncSession, user_id: UUID) -> GitIdentity:
    user = await users_store.get_user_by_id(db, user_id)
    if user is None:
        raise GitIdentityUnresolvedError()

    # A separately persisted GitHub account email can slot ahead of User.email here.
    email_sources = (user.email,)
    email = next(
        (
            candidate.strip()
            for candidate in email_sources
            if candidate and candidate.strip()
        ),
        None,
    )
    if email is None:
        raise GitIdentityUnresolvedError()

    name = (user.display_name or "").strip() or email.split("@", maxsplit=1)[0]
    return GitIdentity(name=name, email=email)


async def materialize_git_identity(
    db: AsyncSession,
    *,
    target: sandbox_io.SandboxIOTarget,
    operation_id: UUID,
    user_id: UUID,
) -> None:
    identity = await resolve_git_identity(db, user_id)
    script = "\n".join(
        [
            f"git config --global user.name {shlex.quote(identity.name)}",
            f"git config --global user.email {shlex.quote(identity.email)}",
        ]
    )
    await sandbox_io.run_materialization_script(
        target,
        operation_id=operation_id,
        label="materialization_configure_git_identity",
        script=script,
        timeout_seconds=30,
    )
