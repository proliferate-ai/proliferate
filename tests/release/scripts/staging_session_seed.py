"""T3 staging durable-user session bootstrap (browser-free, no product change).

Background (2026-07-09): the tier-3 staging lane's durable user
(`proliferate-e2e-bot`, GitHub login, email `support@proliferate.com`) was
created by a real one-time GitHub OAuth sign-in against the "Proliferate
Staging" OAuth app (client `Ov23livVvkw5e0gqxlCQ`), confirmed present via a
read-only query against the staging DB from an in-VPC one-off ECS task
(`proliferate-staging-e2e-probe`, same network pattern as the
`proliferate-staging-litellm-dbinit` task def): the `user` row, its
`auth_identity` (provider=github), and a `provider_grant` row with
status=ready and scopes ["repo","user"] all exist. Because that account is
GitHub-OAuth-only, it has no usable password (`create_auth_user` sets
`hashed_password` to a random unusable placeholder,
server/proliferate/auth/identity/store.py), so the existing password-login
durable-user fixture
(`loginDurableUser` in tests/release/src/fixtures/identity.ts, which POSTs
`/auth/web/password/login`) cannot authenticate it, and there is no
self-serve way to re-run the GitHub OAuth browser dance headlessly.

What this reproduces instead: product sessions in this codebase are
stateless JWTs, not DB rows (see `mint_auth_session`,
server/proliferate/auth/identity/sessions.py:89) — an access token
(fastapi-users `JWTStrategy.write_token`) plus a refresh token
(`generate_jwt` keyed on `settings.jwt_secret`), both derived purely from the
user row (id + token_generation). So the seam here is narrower than the
GitHub App seed script's: mint a real session for the already-existing user
by calling the server's own `mint_auth_session` in-process — the exact
function every real login (password, GitHub, Google, Apple) funnels through
— once. `mint_auth_session` only *reads* state (an account-readiness lookup)
to build the response; it writes nothing, so this is non-mutating.

Why "once": the resulting refresh token is a real, working credential for
`POST /auth/mobile/session/refresh` (server/proliferate/auth/identity/api.py),
a public, browser-free, JSON-body endpoint that mints a *fresh* access token
+ refresh token from a valid refresh token, with no DB/VPC access needed —
the runner rotates its own session through that endpoint before every run
(see tests/release/src/fixtures/staging-session.ts), the same
bootstrap-once-then-self-rotate shape as the GitHub App seed's refresh-token
state file (tests/release/scripts/github_app_seed.py). This script only
needs to run again if the rotating refresh token is ever lost or the user's
`token_generation` gets bumped (logout-everywhere / password change) and
revokes it.

Why in-VPC: the staging DB is VPC-only. This script has no HTTP fallback by
design — it must run in-process against the DB via an ECS task, e.g.:

  aws ecs run-task --cluster proliferate-staging \
    --task-definition proliferate-staging-server:<latest> \
    --launch-type FARGATE \
    --overrides '{"containerOverrides":[{"name":"server","command":
      ["python","/app/scripts_bootstrap/staging_session_seed.py","mint",
       "proliferate-e2e-bot"]}]}' \
    --network-configuration 'awsvpcConfiguration={subnets=[...],
      securityGroups=[...],assignPublicIp=ENABLED}'

reusing the already-deployed server image (it already has every dependency
and `settings.jwt_secret`/`DATABASE_URL` wired via the real ECS secrets) —
this file itself is not baked into that image, so invoke it by piping this
script's source into `python -` via the container override (no image
rebuild, no product change):

  aws ecs run-task ... --overrides "$(python3 - <<'PY'
  import json, pathlib
  src = pathlib.Path("tests/release/scripts/staging_session_seed.py").read_text()
  print(json.dumps({"containerOverrides": [{"name": "server",
      "command": ["python3", "-c", src, "mint", "proliferate-e2e-bot"]}]}))
  PY
  )"

Usage:
  uv run python staging_session_seed.py mint <email-or-github-login>
  uv run python staging_session_seed.py status <email-or-github-login>

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Only meaningful when run as a file from a checkout (local/dev convenience,
# matching github_app_seed.py and prov1_fallback.py). When this source is
# piped into `python3 -c` instead — the real invocation shape for staging,
# since the staging DB is VPC-only and the already-deployed server image has
# no file path for this uncommitted-to-the-image script — `__file__` does not
# exist; that image already sets PYTHONPATH=/app (server/Dockerfile), which
# is sufficient on its own.
if "__file__" in globals():
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import or_, select  # noqa: E402

from proliferate.auth.identity.sessions import mint_auth_session  # noqa: E402
from proliferate.auth.identity.store import get_account_readiness  # noqa: E402
from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402


async def _resolve_user(db, identifier: str) -> User | None:
    result = await db.execute(
        select(User).where(or_(User.email == identifier, User.github_login == identifier))
    )
    return result.scalar_one_or_none()


async def cmd_mint(identifier: str) -> dict:
    async with async_session_factory() as db:
        user = await _resolve_user(db, identifier)
        if user is None:
            return {"error": f"no user found for identifier {identifier!r}"}
        # mint_auth_session only reads (an account-readiness lookup) to build
        # the response; it does not write any row, so there is nothing to
        # commit here and no teardown needed on the DB side.
        session = await mint_auth_session(db, user=user)
        return {
            "error": None,
            "userId": str(session.user_id),
            "email": session.email,
            "githubLogin": session.github_login,
            "accessToken": session.access_token,
            "refreshToken": session.refresh_token,
            "expiresIn": session.expires_in,
        }


async def cmd_status(identifier: str) -> dict:
    """Read-only diagnostic: resolves the user and reports account readiness
    without minting a session. Safe to run as often as needed."""
    async with async_session_factory() as db:
        user = await _resolve_user(db, identifier)
        if user is None:
            return {"error": f"no user found for identifier {identifier!r}"}
        readiness = await get_account_readiness(db, user_id=user.id)
        return {
            "error": None,
            "userId": str(user.id),
            "email": user.email,
            "githubLogin": user.github_login,
            "isActive": user.is_active,
            "isVerified": user.is_verified,
            "createdAt": str(user.created_at),
            "productReady": readiness.product_ready,
            "missingRequirements": list(readiness.missing_requirements),
            "githubGrantStatus": readiness.github_grant_status,
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["mint", "status"])
    parser.add_argument("identifier", help="Durable user's email or github_login")
    return parser


if __name__ == "__main__":
    args = _build_parser().parse_args()
    if args.command == "mint":
        out = asyncio.run(cmd_mint(args.identifier))
    else:
        out = asyncio.run(cmd_status(args.identifier))
    print(json.dumps(out))
