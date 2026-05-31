"""Provision or update a password-auth user.

This is for controlled accounts such as App Review credentials. It does not
link GitHub or mark the account product-ready.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import func, select

from proliferate.auth.passwords import hash_password, normalize_password_email
from proliferate.db.engine import async_session_factory
from proliferate.db.models.auth import User


async def provision_user(
    *,
    email: str,
    password: str,
    display_name: str | None,
) -> None:
    normalized_email = normalize_password_email(email)
    password_hash = hash_password(password)
    now = datetime.now(UTC)
    async with async_session_factory() as db:
        result = await db.execute(
            select(User).where(func.lower(User.email) == normalized_email).limit(1)
        )
        user = result.scalar_one_or_none()
        created = user is None
        if user is None:
            user = User(
                email=normalized_email,
                hashed_password=password_hash,
                password_set_at=now,
                is_active=True,
                is_superuser=False,
                is_verified=True,
                display_name=display_name,
            )
            db.add(user)
        else:
            user.hashed_password = password_hash
            user.password_set_at = now
            if display_name:
                user.display_name = display_name
            user.is_active = True
            user.is_verified = True
        await db.commit()
    action = "created" if created else "updated"
    print(f"{action} password user {normalized_email}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision a password-auth user.")
    parser.add_argument("--email", required=True)
    parser.add_argument(
        "--password",
        default=None,
        help="Password value. Prefer --password-env, --password-stdin, or interactive input.",
    )
    parser.add_argument(
        "--password-env",
        default=None,
        help="Read the password from this env var.",
    )
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read the password from stdin.",
    )
    parser.add_argument("--display-name", default=None)
    args = parser.parse_args()
    password = _resolve_password(args)
    asyncio.run(
        provision_user(
            email=args.email,
            password=password,
            display_name=args.display_name,
        )
    )


def _resolve_password(args: argparse.Namespace) -> str:
    sources = [
        args.password is not None,
        args.password_env is not None,
        args.password_stdin,
    ]
    if sum(1 for source in sources if source) > 1:
        raise SystemExit("Choose only one password source.")
    if args.password_env:
        password = os.environ.get(args.password_env)
        if password is None:
            raise SystemExit(f"Environment variable {args.password_env} is not set.")
        return password
    if args.password_stdin:
        password = sys.stdin.read().rstrip("\n")
        if not password:
            raise SystemExit("No password received on stdin.")
        return password
    if args.password is not None:
        return args.password
    return getpass.getpass("Password: ")


if __name__ == "__main__":
    main()
